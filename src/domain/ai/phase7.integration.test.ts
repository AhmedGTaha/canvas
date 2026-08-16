import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { aiMessages, generationJobs, mediaAssets, projectBrandSettings, projectInstructions, projectMembers, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { ProjectInstructionService } from "./instruction-service";
import { AIConversationService } from "./conversation-service";
import { ProjectContextBuilder } from "./context";
import { GenerationJobLifecycle, GenerationJobService, claimGenerationJob } from "./job-service";
import { AIOrchestrationService } from "./orchestration-service";
import type { AIProvider } from "./provider";
import { fixtureProviderResolver } from "@/domain/ai/testing/provider-fixtures";

async function user(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function project(ownerId: string, name: string) { const workspace = await new WorkspaceService().create(ownerId, { name: `${name} workspace` }); return new ProjectService().create(ownerId, { workspaceId: workspace.id, name, description: `${name} description` }); }

describe.sequential("Phase 7 AI context infrastructure", () => {
  beforeEach(async () => { await sql`TRUNCATE TABLE ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); });

  it("keeps immutable instructions with collaborator access, no-op saves, and stale-write protection", async () => {
    const owner = await user("owner"); const collaborator = await user("collaborator"); const stranger = await user("stranger"); const site = await project(owner.id, "Site");
    await db.insert(projectMembers).values({ projectId: site.id, userId: collaborator.id });
    const service = new ProjectInstructionService();
    const first = await service.update(owner.id, { projectId: site.id, expectedRevision: 0, content: "Professional and minimal." });
    const same = await service.update(collaborator.id, { projectId: site.id, expectedRevision: 1, content: "Professional and minimal." });
    const second = await service.update(collaborator.id, { projectId: site.id, expectedRevision: 1, content: "Professional, minimal, and no gradients." });
    expect([first.revisionNumber, same.revisionNumber, second.revisionNumber]).toEqual([1, 1, 2]);
    expect(await service.history(owner.id, site.id)).toHaveLength(2);
    await expect(service.update(owner.id, { projectId: site.id, expectedRevision: 1, content: "stale" })).rejects.toThrow(/changed elsewhere/);
    await expect(service.read(stranger.id, site.id)).rejects.toThrow(/do not have access/);
    await db.delete(projectMembers).where(eq(projectMembers.userId, collaborator.id));
    await expect(service.read(collaborator.id, site.id)).rejects.toThrow(/do not have access/);
    expect((await db.select().from(projectInstructions)).map((row) => row.content)).toEqual(expect.arrayContaining(["Professional and minimal.", "Professional, minimal, and no gradients."]));
  });

  it("builds bounded complete context and rejects cross-project page, media, and conversation injection", async () => {
    const owner = await user("owner"); const a = await project(owner.id, "Alpha"); const b = await project(owner.id, "Beta"); const pages = new PageTreeService();
    const home = await pages.create(owner.id, { projectId: a.id, type: "page", name: "Home" });
    const foreignPage = await pages.create(owner.id, { projectId: b.id, type: "page", name: "Foreign" });
    await new ProjectInstructionService().update(owner.id, { projectId: a.id, expectedRevision: 0, content: "Use our Bahrain voice." });
    await db.update(projectBrandSettings).set({ companyDescription: "Alpha company", brandNotes: "Calm" }).where(eq(projectBrandSettings.projectId, a.id));
    const [asset] = await db.insert(mediaAssets).values({ projectId: a.id, originalFilename: "logo.png", displayName: "Logo", storageKey: `tests/${randomUUID()}`, mimeType: "image/png", sizeBytes: 100, width: 20, height: 10, altText: "Alpha logo", createdByUserId: owner.id }).returning();
    const [foreignAsset] = await db.insert(mediaAssets).values({ projectId: b.id, originalFilename: "foreign.png", displayName: "Foreign", storageKey: `tests/${randomUUID()}`, mimeType: "image/png", sizeBytes: 100, width: 20, height: 10, createdByUserId: owner.id }).returning();
    const conversations = new AIConversationService(); const conversation = await conversations.create(owner.id, { projectId: a.id, pageId: home.id }); const foreignConversation = await conversations.create(owner.id, { projectId: b.id });
    await db.insert(aiMessages).values(Array.from({ length: 25 }, (_, index) => ({ conversationId: conversation.id, role: index % 2 ? "assistant" as const : "user" as const, userId: index % 2 ? null : owner.id, content: `message ${index}` })));
    const builder = new ProjectContextBuilder();
    const context = await builder.build({ projectId: a.id, actorUserId: owner.id, target: { type: "page", id: home.id }, selectedMediaIds: [asset!.id], conversationId: conversation.id });
    expect(context).toMatchObject({ project: { id: a.id, name: "Alpha" }, brand: { companyDescription: "Alpha company" }, instructions: { content: "Use our Bahrain voice." }, target: { id: home.id }, composition: { mediaCount: 1, conversationMessageCount: 20 } });
    expect(context.theme.resolved).toBeDefined(); expect(context.structure.homepage).toBe(home.id); expect(context.constraints.frontendOnly).toBe(true); expect(JSON.stringify(context)).not.toContain("storageKey");
    await expect(builder.build({ projectId: a.id, actorUserId: owner.id, target: { type: "page", id: foreignPage.id } })).rejects.toThrow(/not found in this project/i);
    await expect(builder.build({ projectId: a.id, actorUserId: owner.id, target: { type: "project" }, selectedMediaIds: [foreignAsset!.id] })).rejects.toThrow(/not active in this project/i);
    await expect(builder.build({ projectId: a.id, actorUserId: owner.id, target: { type: "project" }, conversationId: foreignConversation.id })).rejects.toThrow(/not found in this project/i);
  });

  it("scopes conversations and jobs, enforces lifecycle timestamps, claiming, idempotent completion, and cancellation", async () => {
    const owner = await user("owner"); const collaborator = await user("collaborator"); const stranger = await user("stranger"); const site = await project(owner.id, "Site");
    await db.insert(projectMembers).values({ projectId: site.id, userId: collaborator.id });
    const conversations = new AIConversationService(); const conversation = await conversations.create(collaborator.id, { projectId: site.id });
    const jobs = new GenerationJobService(); const created = await jobs.createAssistantJob(collaborator.id, { projectId: site.id, conversationId: conversation.id, content: "Summarize this website." });
    await expect(jobs.get(owner.id, site.id, created.job.id)).resolves.toMatchObject({ status: "queued" });
    await expect(jobs.get(stranger.id, site.id, created.job.id)).rejects.toThrow(/do not have access/);
    const [claimOne, claimTwo] = await Promise.all([claimGenerationJob("worker-one"), claimGenerationJob("worker-two")]);
    expect([claimOne, claimTwo].filter(Boolean)).toHaveLength(1);
    const lifecycle = new GenerationJobLifecycle();
    await lifecycle.transition(created.job.id, "generating", "Contacting AI");
    const completed = await lifecycle.transition(created.job.id, "completed", "Completed");
    expect(completed.startedAt).toBeInstanceOf(Date); expect(completed.finishedAt).toBeInstanceOf(Date);
    await expect(lifecycle.transition(created.job.id, "generating", "bad")).rejects.toThrow(/Invalid generation job transition/);
    const cancellable = await jobs.createAssistantJob(owner.id, { projectId: site.id, conversationId: conversation.id, content: "Another summary." });
    const cancelled = await jobs.requestCancellation(owner.id, site.id, cancellable.job.id);
    expect(cancelled).toMatchObject({ status: "cancelled" }); expect(cancelled.finishedAt).toBeInstanceOf(Date);
  });

  it("persists a normalized provider result and usage exactly once", async () => {
    const owner = await user("owner"); const site = await project(owner.id, "Site"); const conversation = await new AIConversationService().create(owner.id, { projectId: site.id });
    const created = await new GenerationJobService().createAssistantJob(owner.id, { projectId: site.id, conversationId: conversation.id, content: "Summarize." });
    await claimGenerationJob("worker");
    const fake: AIProvider = { name: "fake", model: "fake-1", capabilities: { structuredOutput: true, vision: true }, generateText: async () => ({ text: "A concise project summary.", provider: "fake", model: "fake-1", providerRequestId: "safe-id", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }), generateStructured: async () => { throw new Error("unused"); } };
    const orchestration = new AIOrchestrationService(db, new ProjectContextBuilder(), new GenerationJobLifecycle(db), fixtureProviderResolver(() => fake));
    const completed = await orchestration.process(created.job.id);
    expect(completed).toMatchObject({ status: "completed", provider: "fake", providerModel: "fake-1", usageMetadata: { totalTokens: 15 } });
    await orchestration.process(created.job.id);
    const messages = await db.select().from(aiMessages).where(eq(aiMessages.conversationId, conversation.id));
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    const [stored] = await db.select().from(generationJobs).where(eq(generationJobs.id, created.job.id)); expect(stored?.contextFingerprint).toHaveLength(64);
  });
});
