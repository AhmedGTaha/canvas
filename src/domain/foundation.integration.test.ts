import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DomainError } from "@/domain/shared/errors";
import { authenticate, createSession, readSession, register, revokeSession } from "@/domain/auth/service";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { db, sql } from "@/server/db/client";
import { pageNodes, projects, users } from "@/server/db/schema";
import { editingLeases, projectInvites, projectMembers } from "@/server/db/schema";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { sha256 } from "@/domain/shared/crypto";
import { PageTreeService } from "@/domain/pages/service";

async function createUser(label: string) {
  const id = randomUUID();
  const [user] = await db.insert(users).values({ id, email: `${label}-${id}@example.test`, normalizedEmail: `${label}-${id}@example.test`, displayName: label }).returning();
  if (!user) throw new Error("Test user was not created.");
  return user;
}

describe.sequential("Phase 1 persistence and tenant isolation", () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;
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
    const pages = new PageTreeService();
    const leasePage = await pages.create(owner.id, { projectId: project.id, type: "page", name: "Lease page" });
    const racePage = await pages.create(owner.id, { projectId: project.id, type: "page", name: "Race page" });
    const target = { projectId: project.id, targetType: "page" as const, targetId: leasePage.id };
    const otherProject = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Other" });
    const otherPage = await pages.create(owner.id, { projectId: otherProject.id, type: "page", name: "Other page" });

    const first = await leases.acquire(owner.id, target);
    await expect(leases.acquire(collaborator.id, target)).rejects.toThrowError(/currently editing/);
    const renewed = await leases.acquire(owner.id, target);
    expect(renewed.id).toBe(first.id);
    await expect(leases.renew(owner.id, target)).resolves.toMatchObject({ userId: owner.id });
    await expect(leases.acquire(stranger.id, target)).rejects.toThrowError(/do not have access/);
    await expect(leases.acquire(owner.id, { ...target, targetId: otherPage.id })).rejects.toThrowError(/target not found/i);

    await db.update(editingLeases).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(editingLeases.id, first.id));
    await expect(leases.acquire(collaborator.id, target)).resolves.toMatchObject({ userId: collaborator.id });
    await expect(leases.release(collaborator.id, target)).resolves.toMatchObject({ userId: collaborator.id });
    await expect(leases.getActiveLease(owner.id, target)).resolves.toBeNull();

    const raceTarget = { ...target, targetId: racePage.id };
    const results = await Promise.allSettled([leases.acquire(owner.id, raceTarget), leases.acquire(collaborator.id, raceTarget)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [storedLease] = await db.select().from(editingLeases).where(and(eq(editingLeases.projectId, project.id), eq(editingLeases.targetId, raceTarget.targetId)));
    expect(storedLease).toBeDefined();
  });

  it("lets owners and collaborators build nested page/folder routes with SEO", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const tree = new PageTreeService();
    const home = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const company = await tree.create(collaborator.id, { projectId: project.id, type: "folder", name: "Company" });
    const services = await tree.create(collaborator.id, { projectId: project.id, parentId: company.id, type: "page", name: "Services" });
    const web = await tree.create(owner.id, { projectId: project.id, parentId: services.id, type: "page", name: "Web Development" });

    expect(home).toMatchObject({ isHomepage: true, routePath: "/" });
    expect(company).toMatchObject({ slug: null, routePath: null, isHomepage: false });
    expect(services.routePath).toBe("/services");
    expect(web.routePath).toBe("/services/web-development");
    await tree.updateSeo(collaborator.id, { projectId: project.id, nodeId: web.id, pageTitle: "Web Development Services", metaDescription: "Custom websites for growing companies." });
    const nodes = await tree.listTree(collaborator.id, project.id);
    expect(nodes.find((node) => node.id === web.id)).toMatchObject({ pageTitle: "Web Development Services", metaDescription: "Custom websites for growing companies." });
  });

  it("rejects root, nested, slug-edit, and move route collisions atomically", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    const tree = new PageTreeService();
    await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const contact = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Contact" });
    await expect(tree.create(owner.id, { projectId: project.id, type: "page", name: "Contact Again", slug: "contact" })).rejects.toThrowError(/already used/);
    const products = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Products" });
    await tree.create(owner.id, { projectId: project.id, parentId: products.id, type: "page", name: "Details" });
    const services = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Services" });
    const serviceDetails = await tree.create(owner.id, { projectId: project.id, parentId: services.id, type: "page", name: "Details" });
    await expect(tree.create(owner.id, { projectId: project.id, parentId: products.id, type: "page", name: "Other details", slug: "details" })).rejects.toThrowError(/already used/);
    await expect(tree.updateSlug(owner.id, { projectId: project.id, nodeId: contact.id, slug: "products" })).rejects.toThrowError(/already used/);
    await expect(tree.move(owner.id, { projectId: project.id, nodeId: serviceDetails.id, newParentId: products.id, newPosition: 0 })).rejects.toThrowError(/already used/);
    await expect(tree.listTree(owner.id, project.id)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: serviceDetails.id, parentId: services.id, routePath: "/services/details" })]));
    const concurrent = await Promise.allSettled([
      tree.create(owner.id, { projectId: project.id, type: "page", name: "Race one", slug: "race-route" }),
      tree.create(owner.id, { projectId: project.id, type: "page", name: "Race two", slug: "race-route" }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("prevents cycles, self-parenting, cross-project parents, and deleted parents", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const projectA = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "A" });
    const projectB = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "B" });
    const tree = new PageTreeService();
    const a = await tree.create(owner.id, { projectId: projectA.id, type: "folder", name: "A" });
    const b = await tree.create(owner.id, { projectId: projectA.id, parentId: a.id, type: "folder", name: "B" });
    const c = await tree.create(owner.id, { projectId: projectA.id, parentId: b.id, type: "folder", name: "C" });
    const foreign = await tree.create(owner.id, { projectId: projectB.id, type: "folder", name: "Foreign" });
    await expect(tree.move(owner.id, { projectId: projectA.id, nodeId: a.id, newParentId: c.id, newPosition: 0 })).rejects.toThrowError(/children/);
    await expect(tree.move(owner.id, { projectId: projectA.id, nodeId: b.id, newParentId: b.id, newPosition: 0 })).rejects.toThrowError(/inside itself/);
    await expect(tree.move(owner.id, { projectId: projectA.id, nodeId: a.id, newParentId: foreign.id, newPosition: 0 })).rejects.toThrowError(/not found/);
    await expect(tree.duplicatePage(owner.id, { projectId: projectA.id, nodeId: foreign.id })).rejects.toThrowError(/not found/);
    await expect(tree.setHomepage(owner.id, { projectId: projectA.id, nodeId: foreign.id })).rejects.toThrowError(/not found/);
    await tree.deleteSubtree(owner.id, { projectId: projectB.id, nodeId: foreign.id });
    await expect(tree.create(owner.id, { projectId: projectA.id, parentId: foreign.id, type: "page", name: "Injected" })).rejects.toThrowError(/not found/);
  });

  it("manages the homepage atomically and protects it from subtree deletion", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    const tree = new PageTreeService();
    const first = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const second = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Landing" });
    const folder = await tree.create(owner.id, { projectId: project.id, type: "folder", name: "Folder" });
    expect(second.isHomepage).toBe(false);
    await expect(tree.setHomepage(owner.id, { projectId: project.id, nodeId: folder.id })).rejects.toThrowError(/folder/);
    await tree.setHomepage(owner.id, { projectId: project.id, nodeId: second.id });
    const nodes = await tree.listTree(owner.id, project.id);
    expect(nodes.find((node) => node.id === first.id)).toMatchObject({ isHomepage: false, routePath: "/home" });
    expect(nodes.find((node) => node.id === second.id)).toMatchObject({ isHomepage: true, routePath: "/" });
    expect(nodes.filter((node) => node.isHomepage)).toHaveLength(1);
    await expect(tree.deleteSubtree(owner.id, { projectId: project.id, nodeId: second.id })).rejects.toThrowError(/another homepage/);
    await db.update(pageNodes).set({ deletedAt: new Date() }).where(eq(pageNodes.id, first.id));
    await expect(tree.setHomepage(owner.id, { projectId: project.id, nodeId: first.id })).rejects.toThrowError(/not found/);
  });

  it("duplicates pages with SEO, stable identity, parent, route, and position", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    const tree = new PageTreeService();
    await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const folder = await tree.create(owner.id, { projectId: project.id, type: "folder", name: "Offers" });
    const services = await tree.create(owner.id, { projectId: project.id, parentId: folder.id, type: "page", name: "Services" });
    await tree.updateSeo(owner.id, { projectId: project.id, nodeId: services.id, pageTitle: "Our Services", metaDescription: "Everything we offer." });
    const firstCopy = await tree.duplicatePage(owner.id, { projectId: project.id, nodeId: services.id });
    const secondCopy = await tree.duplicatePage(owner.id, { projectId: project.id, nodeId: services.id });
    expect(firstCopy).toMatchObject({ name: "Services Copy", slug: "services-copy", routePath: "/services-copy", parentId: folder.id, pageTitle: "Our Services", metaDescription: "Everything we offer." });
    expect(secondCopy).toMatchObject({ name: "Services Copy 2", slug: "services-copy-2", routePath: "/services-copy-2", parentId: folder.id });
    expect(new Set([services.id, firstCopy.id, secondCopy.id]).size).toBe(3);
  });

  it("reorders, moves, and soft-deletes complete subtrees with compact positions", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    const tree = new PageTreeService();
    const home = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const folder = await tree.create(owner.id, { projectId: project.id, type: "folder", name: "Folder" });
    const about = await tree.create(owner.id, { projectId: project.id, type: "page", name: "About" });
    const child = await tree.create(owner.id, { projectId: project.id, parentId: folder.id, type: "page", name: "Child" });
    await tree.reorder(owner.id, { projectId: project.id, nodeId: about.id, direction: "up" });
    await tree.move(owner.id, { projectId: project.id, nodeId: about.id, newParentId: folder.id, newPosition: 0 });
    const moved = await tree.listTree(owner.id, project.id);
    expect(moved.filter((node) => node.parentId === folder.id).sort((a, b) => a.position - b.position).map((node) => node.id)).toEqual([about.id, child.id]);
    await tree.deleteSubtree(owner.id, { projectId: project.id, nodeId: folder.id });
    const visible = await tree.listTree(owner.id, project.id);
    expect(visible.map((node) => node.id)).toEqual([home.id]);
    const deleted = await db.select().from(pageNodes).where(and(eq(pageNodes.projectId, project.id), eq(pageNodes.id, child.id)));
    expect(deleted[0]?.deletedAt).toBeInstanceOf(Date);
  });

  it("enforces page-tree authorization and revocation for every mutation boundary", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const tree = new PageTreeService();
    const home = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const page = await tree.create(collaborator.id, { projectId: project.id, type: "page", name: "Page" });
    await expect(tree.listTree(stranger.id, project.id)).rejects.toThrowError(/do not have access/);
    await expect(tree.create(stranger.id, { projectId: project.id, type: "page", name: "No" })).rejects.toThrowError(/do not have access/);
    await expect(tree.rename(stranger.id, { projectId: project.id, nodeId: page.id, name: "No" })).rejects.toThrowError(/do not have access/);
    await expect(tree.move(stranger.id, { projectId: project.id, nodeId: page.id, newParentId: null, newPosition: 0 })).rejects.toThrowError(/do not have access/);
    await expect(tree.deleteSubtree(stranger.id, { projectId: project.id, nodeId: page.id })).rejects.toThrowError(/do not have access/);
    await expect(tree.updateSlug(stranger.id, { projectId: project.id, nodeId: page.id, slug: "no" })).rejects.toThrowError(/do not have access/);
    await expect(tree.setHomepage(stranger.id, { projectId: project.id, nodeId: page.id })).rejects.toThrowError(/do not have access/);
    await expect(tree.updateSeo(stranger.id, { projectId: project.id, nodeId: page.id, pageTitle: "No", metaDescription: "" })).rejects.toThrowError(/do not have access/);
    await expect(tree.duplicatePage(stranger.id, { projectId: project.id, nodeId: page.id })).rejects.toThrowError(/do not have access/);
    await new MembershipService().remove(owner.id, { projectId: project.id, userId: collaborator.id });
    await expect(tree.rename(collaborator.id, { projectId: project.id, nodeId: home.id, name: "No access" })).rejects.toThrowError(/do not have access/);
  });

  it("allows collaborators to perform the complete normal tree-editing workflow", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const tree = new PageTreeService();
    await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const folder = await tree.create(collaborator.id, { projectId: project.id, type: "folder", name: "Folder" });
    const page = await tree.create(collaborator.id, { projectId: project.id, type: "page", name: "Draft" });
    await tree.rename(collaborator.id, { projectId: project.id, nodeId: page.id, name: "About" });
    await tree.updateSlug(collaborator.id, { projectId: project.id, nodeId: page.id, slug: "about-us" });
    await tree.updateSeo(collaborator.id, { projectId: project.id, nodeId: page.id, pageTitle: "About us", metaDescription: "Meet our team." });
    await tree.move(collaborator.id, { projectId: project.id, nodeId: page.id, newParentId: folder.id, newPosition: 0 });
    await tree.reorder(collaborator.id, { projectId: project.id, nodeId: folder.id, direction: "up" });
    const duplicate = await tree.duplicatePage(collaborator.id, { projectId: project.id, nodeId: page.id });
    await tree.setHomepage(collaborator.id, { projectId: project.id, nodeId: page.id });
    await tree.deleteSubtree(collaborator.id, { projectId: project.id, nodeId: duplicate.id });
    await expect(tree.listTree(collaborator.id, project.id)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: page.id, name: "About", slug: "about-us", routePath: "/", isHomepage: true })]));
  });
});
