import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DomainError } from "@/domain/shared/errors";
import { authenticate, createSession, readSession, register, revokeSession } from "@/domain/auth/service";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { db, sql } from "@/server/db/client";
import { projects, users } from "@/server/db/schema";
import { editingLeases, projectInvites, projectMembers } from "@/server/db/schema";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { sha256 } from "@/domain/shared/crypto";

async function createUser(label: string) {
  const id = randomUUID();
  const [user] = await db.insert(users).values({ id, email: `${label}-${id}@example.test`, normalizedEmail: `${label}-${id}@example.test`, displayName: label }).returning();
  if (!user) throw new Error("Test user was not created.");
  return user;
}

describe.sequential("Phase 1 persistence and tenant isolation", () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;
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

  it("distinguishes owner, collaborator, and unrelated project access", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const shared = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Shared" });
    const privateProject = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Private" });
    await db.insert(projectMembers).values({ projectId: shared.id, userId: collaborator.id });
    const access = new ProjectAccessService();

    await expect(access.getProjectRole(owner.id, shared.id)).resolves.toBe("owner");
    await expect(access.getProjectRole(collaborator.id, shared.id)).resolves.toBe("collaborator");
    await expect(access.requireProjectAccess(stranger.id, shared.id)).rejects.toThrowError(/do not have access/);
    await expect(access.requireProjectAccess(collaborator.id, privateProject.id)).rejects.toThrowError(/do not have access/);
    await expect(new WorkspaceService().read(collaborator.id, workspace.id)).rejects.toThrowError(/do not have access/);
    await expect(new ProjectService().listAccessible(collaborator.id)).resolves.toMatchObject({ owned: [], shared: [{ id: shared.id }] });
    await expect(db.insert(projectMembers).values({ projectId: shared.id, userId: collaborator.id })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("creates only hashed replacement invitations and enforces owner-only administration", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Shared" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const invitations = new InvitationService();
    const first = await invitations.create(owner.id, { projectId: project.id });
    const [stored] = await db.select().from(projectInvites).where(eq(projectInvites.id, first.invite.id));
    expect(first.token).toHaveLength(43);
    expect(stored?.tokenHash).toBe(sha256(first.token));
    expect(stored?.tokenHash).not.toContain(first.token);
    expect(first.invite.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    await expect(invitations.create(collaborator.id, { projectId: project.id })).rejects.toThrowError(/Only the project owner/);
    await expect(invitations.create(stranger.id, { projectId: project.id })).rejects.toThrowError(/do not have access/);
    await expect(invitations.revoke(collaborator.id, { projectId: project.id, inviteId: first.invite.id })).rejects.toThrowError(/Only the project owner/);
    const replacement = await invitations.create(owner.id, { projectId: project.id });
    const [oldInvite] = await db.select().from(projectInvites).where(eq(projectInvites.id, first.invite.id));
    expect(oldInvite?.revokedAt).toBeInstanceOf(Date);
    expect(replacement.token).not.toBe(first.token);
    await expect(invitations.preview(first.token)).rejects.toThrowError(/no longer available/);
  });

  it("accepts a valid invite idempotently and handles the owner edge case", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Shared" });
    const invitations = new InvitationService();
    const invitation = await invitations.create(owner.id, { projectId: project.id });

    await expect(invitations.accept(collaborator.id, { token: invitation.token })).resolves.toMatchObject({ id: project.id });
    await expect(invitations.accept(collaborator.id, { token: invitation.token })).resolves.toMatchObject({ id: project.id });
    await expect(invitations.accept(owner.id, { token: invitation.token })).resolves.toMatchObject({ id: project.id });
    const members = await db.select().from(projectMembers).where(eq(projectMembers.projectId, project.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(collaborator.id);
  });

  it("rejects expired and revoked invitations", async () => {
    const owner = await createUser("owner");
    const joiner = await createUser("joiner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Shared" });
    const invitations = new InvitationService();
    const expired = await invitations.create(owner.id, { projectId: project.id });
    await db.update(projectInvites).set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }).where(eq(projectInvites.id, expired.invite.id));
    await expect(invitations.accept(joiner.id, { token: expired.token })).rejects.toThrowError(/expired/);

    const revoked = await invitations.create(owner.id, { projectId: project.id });
    await invitations.revoke(owner.id, { projectId: project.id, inviteId: revoked.invite.id });
    await expect(invitations.accept(joiner.id, { token: revoked.token })).rejects.toThrowError(/revoked/);
  });

  it("removes collaborators immediately and keeps access management owner-only", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const other = await createUser("other");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Shared" });
    await db.insert(projectMembers).values([{ projectId: project.id, userId: collaborator.id }, { projectId: project.id, userId: other.id }]);
    const memberships = new MembershipService();

    await expect(memberships.remove(collaborator.id, { projectId: project.id, userId: other.id })).rejects.toThrowError(/Only the project owner/);
    await expect(memberships.remove(owner.id, { projectId: project.id, userId: owner.id })).rejects.toThrowError(/cannot be removed/);
    await memberships.remove(owner.id, { projectId: project.id, userId: collaborator.id });
    await expect(new ProjectService().read(collaborator.id, project.id)).rejects.toThrowError(/do not have access/);
    await expect(new EditingLeaseService().acquire(collaborator.id, { projectId: project.id, targetType: "page", targetId: randomUUID() })).rejects.toThrowError(/do not have access/);
  });

  it("acquires, renews, expires, releases, and race-protects editing leases", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Shared" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const leases = new EditingLeaseService();
    const target = { projectId: project.id, targetType: "page" as const, targetId: randomUUID() };

    const first = await leases.acquire(owner.id, target);
    await expect(leases.acquire(collaborator.id, target)).rejects.toThrowError(/currently editing/);
    const renewed = await leases.acquire(owner.id, target);
    expect(renewed.id).toBe(first.id);
    await expect(leases.renew(owner.id, target)).resolves.toMatchObject({ userId: owner.id });
    await expect(leases.acquire(stranger.id, target)).rejects.toThrowError(/do not have access/);

    await db.update(editingLeases).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(editingLeases.id, first.id));
    await expect(leases.acquire(collaborator.id, target)).resolves.toMatchObject({ userId: collaborator.id });
    await expect(leases.release(collaborator.id, target)).resolves.toMatchObject({ userId: collaborator.id });
    await expect(leases.getActiveLease(owner.id, target)).resolves.toBeNull();

    const raceTarget = { ...target, targetId: randomUUID() };
    const results = await Promise.allSettled([leases.acquire(owner.id, raceTarget), leases.acquire(collaborator.id, raceTarget)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [storedLease] = await db.select().from(editingLeases).where(and(eq(editingLeases.projectId, project.id), eq(editingLeases.targetId, raceTarget.targetId)));
    expect(storedLease).toBeDefined();
  });
});
