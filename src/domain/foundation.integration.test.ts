import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DomainError } from "@/domain/shared/errors";
import { authenticate, createSession, readSession, register, revokeSession } from "@/domain/auth/service";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { db, sql } from "@/server/db/client";
import { projects, users } from "@/server/db/schema";

async function createUser(label: string) {
  const id = randomUUID();
  const [user] = await db.insert(users).values({ id, email: `${label}-${id}@example.test`, normalizedEmail: `${label}-${id}@example.test`, displayName: label }).returning();
  if (!user) throw new Error("Test user was not created.");
  return user;
}

describe.sequential("Phase 1 persistence and tenant isolation", () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => { await sql.end(); });

  it("creates a workspace owned by the authenticated user", async () => {
    const user = await createUser("owner");
    const workspace = await new WorkspaceService().create(user.id, { name: "  My workspace  " });
    expect(workspace).toMatchObject({ ownerUserId: user.id, name: "My workspace" });
  });

  it("registers, authenticates, and restores a database-backed session", async () => {
    const user = await register({ displayName: "  Casey  ", email: "  CASEY@Example.test ", password: "a-strong-password" });
    expect(user).toMatchObject({ displayName: "Casey", normalizedEmail: "casey@example.test" });
    await expect(authenticate({ email: "casey@example.test", password: "wrong-password" })).rejects.toThrowError(/incorrect/);
    await expect(authenticate({ email: "casey@example.test", password: "a-strong-password" })).resolves.toMatchObject({ id: user.id });

    const session = await createSession(user.id);
    await expect(readSession(session.token)).resolves.toMatchObject({ id: user.id, displayName: "Casey" });
    await revokeSession(session.token);
    await expect(readSession(session.token)).resolves.toBeNull();
  });

  it("creates a project only under an owned workspace", async () => {
    const owner = await createUser("owner");
    const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Owner workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website", description: "  Launch site  " });
    expect(project).toMatchObject({ workspaceId: workspace.id, ownerUserId: owner.id, description: "Launch site", status: "active" });
    await expect(new ProjectService().create(stranger.id, { workspaceId: workspace.id, name: "Intrusion" })).rejects.toThrowError(DomainError);
  });

  it("prevents another user from reading or renaming workspace and project UUIDs", async () => {
    const owner = await createUser("owner");
    const stranger = await createUser("stranger");
    const workspaceService = new WorkspaceService();
    const projectService = new ProjectService();
    const workspace = await workspaceService.create(owner.id, { name: "Private" });
    const project = await projectService.create(owner.id, { workspaceId: workspace.id, name: "Private project" });

    await expect(workspaceService.read(stranger.id, workspace.id)).rejects.toThrowError(/do not have access/);
    await expect(projectService.read(stranger.id, project.id)).rejects.toThrowError(/do not have access/);
    await expect(workspaceService.rename(stranger.id, { id: workspace.id, name: "Taken" })).rejects.toThrowError(/do not have access/);
    await expect(projectService.rename(stranger.id, { id: project.id, name: "Taken" })).rejects.toThrowError(/do not have access/);
  });

  it("excludes soft-deleted projects from reads and active listings", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Removed" });
    await db.update(projects).set({ status: "deleted", deletedAt: new Date() }).where(eq(projects.id, project.id));

    await expect(new ProjectService().read(owner.id, project.id)).rejects.toThrowError(/not found/i);
    await expect(new ProjectService().listInWorkspace(owner.id, workspace.id)).resolves.toEqual([]);
  });
});
