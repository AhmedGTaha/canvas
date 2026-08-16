import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { aiMessages, generationJobs, pageVersions, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import { setTelemetrySink } from "@/server/observability/telemetry";
import { ensureFixtureConnection } from "@/domain/ai/testing/provider-fixtures";

const API_KEY = "AIzaSyREALLOOKINGKEY000000000000000000000";
const environment = { ...process.env };

async function makeUser(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function setup() {
  const owner = await makeUser("owner");
  const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
  const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Site" });
  const home = await new PageTreeService().create(owner.id, { projectId: project.id, type: "page", name: "Home" });
  return { owner, project, home };
}

describe.sequential("AI provider configuration", () => {
  beforeEach(async () => { await sql`TRUNCATE TABLE ai_usage_events, ai_connection_models, user_ai_settings, ai_connections, export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterEach(() => { process.env = { ...environment }; setTelemetrySink(null); });
  afterAll(async () => { await sql.end(); });

  it("fails an AI job with a plain configuration error when the actor has no model selected", async () => {
    const { owner, project, home } = await setup();
    // Creating the job still works: only the provider call needs a configured model.
    const request = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Build the homepage", selectedMediaIds: [] });
    await claimGenerationJob("worker");
    const job = await new AIOrchestrationService().process(request.job.id);

    expect(job).toMatchObject({ status: "failed", errorCode: "AI_NOT_CONFIGURED", errorMessage: "Your account has no AI model selected. Choose a provider and model in AI settings." });
    // A configuration problem is never retried and never damages page state.
    expect(await db.select().from(pageVersions)).toHaveLength(0);
    const [node] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.job.id));
    expect(node?.attemptCount).toBe(1);
  });

  it("records only the provider, model, and connection id on job rows, never the key", async () => {
    const { owner, project, home } = await setup();
    const { connection } = await ensureFixtureConnection(owner.id, db, { provider: "gemini", modelId: "gemini-2.5-pro" });
    const request = await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Build the homepage", selectedMediaIds: [] });

    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, request.job.id));
    expect(job).toMatchObject({ provider: "gemini", providerModel: "gemini-2.5-pro", aiConnectionId: connection.id });
    // Nothing anywhere in the persisted job or its conversation contains the key.
    const persisted = JSON.stringify([job, await db.select().from(aiMessages)]);
    expect(persisted).not.toContain(API_KEY);
    expect(persisted).not.toMatch(/AIzaSy/);
  });

  it("keeps the key out of telemetry even when a caller passes it by mistake", async () => {
    const lines: string[] = [];
    setTelemetrySink((line) => lines.push(line));
    const { owner, project, home } = await setup();
    await new GenerationJobService().createPageJob(owner.id, { projectId: project.id, pageId: home.id, content: "Build the homepage", selectedMediaIds: [] });

    const { emit } = await import("@/server/observability/telemetry");
    emit("test.event", { apiKey: API_KEY, geminiApiKey: API_KEY, note: `configured with ${API_KEY}`, model: "gemini-2.5-flash" });

    expect(lines.length).toBeGreaterThan(0);
    const combined = lines.join("\n");
    expect(combined).not.toContain(API_KEY);
    expect(combined).toContain("gemini-2.5-flash");
    expect(combined).toContain("[redacted]");
  });
});
