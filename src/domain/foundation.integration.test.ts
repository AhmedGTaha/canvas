import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DomainError } from "@/domain/shared/errors";
import { authenticate, createSession, readSession, register, revokeSession } from "@/domain/auth/service";
import { ProjectService } from "@/domain/projects/service";
import { WorkspaceService } from "@/domain/workspaces/service";
import { db, sql } from "@/server/db/client";
import { mediaAssets, pageNodes, projectBrandSettings, projects, projectThemeSettings, users } from "@/server/db/schema";
import { editingLeases, projectInvites, projectMembers } from "@/server/db/schema";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { sha256 } from "@/domain/shared/crypto";
import { PageTreeService } from "@/domain/pages/service";
import { BrandService, ThemeService, getProjectDesignSystem } from "@/domain/theme/services";
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS, DEFAULT_THEME } from "@/domain/theme/defaults";
import { MediaService, getProjectMediaContext } from "@/domain/media/service";
import type { ObjectStorage } from "@/server/storage";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { PreviewTokenService } from "@/generated-runtime/security/preview-token";

async function createUser(label: string) {
  const id = randomUUID();
  const [user] = await db.insert(users).values({ id, email: `${label}-${id}@example.test`, normalizedEmail: `${label}-${id}@example.test`, displayName: label }).returning();
  if (!user) throw new Error("Test user was not created.");
  return user;
}

describe.sequential("Phase 1 persistence and tenant isolation", () => {
  beforeEach(async () => {
    await sql`TRUNCATE TABLE media_assets, media_folders, page_nodes, audit_events, editing_leases, project_invites, project_members, auth_rate_limits, sessions, auth_credentials, projects, workspaces, users RESTART IDENTITY CASCADE`;
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

  it("archives workspaces and websites until their owner restores them", async () => {
    const owner = await createUser("owner");
    const workspaces = new WorkspaceService();
    const projects = new ProjectService();
    const workspace = await workspaces.create(owner.id, { name: "Archive me" });
    const project = await projects.create(owner.id, { workspaceId: workspace.id, name: "Archive site" });

    await projects.archive(owner.id, project.id);
    await expect(projects.listAccessible(owner.id)).resolves.toMatchObject({ owned: [] });
    await expect(projects.read(owner.id, project.id)).rejects.toThrowError(/not found/i);
    await expect(projects.listArchived(owner.id)).resolves.toMatchObject([{ id: project.id, status: "archived" }]);
    await projects.restore(owner.id, project.id);
    await expect(projects.read(owner.id, project.id)).resolves.toMatchObject({ id: project.id, status: "active" });

    await workspaces.archive(owner.id, workspace.id);
    await expect(workspaces.list(owner.id)).resolves.toEqual([]);
    await expect(workspaces.read(owner.id, workspace.id)).rejects.toThrowError(/not found/i);
    await expect(projects.listAccessible(owner.id)).resolves.toMatchObject({ owned: [] });
    await expect(projects.read(owner.id, project.id)).rejects.toThrowError(/not found/i);
    await expect(workspaces.listArchived(owner.id)).resolves.toMatchObject([{ id: workspace.id }]);
    await workspaces.restore(owner.id, workspace.id);
    await expect(projects.read(owner.id, project.id)).resolves.toMatchObject({ id: project.id, status: "active" });
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

  it("transactionally initializes default brand and theme settings for new projects", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Acme Website" });
    const [brand] = await db.select().from(projectBrandSettings).where(eq(projectBrandSettings.projectId, project.id));
    const [theme] = await db.select().from(projectThemeSettings).where(eq(projectThemeSettings.projectId, project.id));
    expect(brand).toMatchObject({ companyName: "Acme Website", companyDescription: null, brandNotes: null, primaryLogoMediaId: null, alternateLogoMediaId: null, revision: 1 });
    expect(theme).toMatchObject({ lightTokens: DEFAULT_LIGHT_TOKENS, darkTokens: DEFAULT_DARK_TOKENS, radiusScale: 50, spacingScale: 50, shadowScale: 50, fontScale: 50, borderScale: 50, revision: 1 });
  });

  it("lets owners and collaborators edit identity and independent light/dark themes", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const brands = new BrandService(); const themes = new ThemeService();
    const brand = await brands.read(owner.id, project.id);
    await brands.update(owner.id, { projectId: project.id, expectedRevision: brand.revision, brand: { companyName: "Acme", companyDescription: "Useful products.", brandNotes: "Minimal and precise." } });
    const initial = await themes.read(collaborator.id, project.id);
    const lightUpdate = await themes.update(collaborator.id, { projectId: project.id, expectedRevision: initial.revision, theme: { ...DEFAULT_THEME, lightTokens: { ...DEFAULT_LIGHT_TOKENS, primary: "#123456" } } });
    expect(lightUpdate.lightTokens.primary).toBe("#123456");
    expect(lightUpdate.darkTokens.primary).toBe(DEFAULT_DARK_TOKENS.primary);
    const darkUpdate = await themes.update(owner.id, { projectId: project.id, expectedRevision: lightUpdate.revision, theme: { ...DEFAULT_THEME, lightTokens: lightUpdate.lightTokens, darkTokens: { ...lightUpdate.darkTokens, primary: "#ABCDEF" } } });
    expect(darkUpdate.lightTokens.primary).toBe("#123456");
    expect(darkUpdate.darkTokens.primary).toBe("#ABCDEF");
    await expect(getProjectDesignSystem(collaborator.id, project.id)).resolves.toMatchObject({ brand: { companyName: "Acme" }, theme: { darkTokens: { primary: "#ABCDEF" } } });
  });

  it("resets visual settings without changing company identity", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    const brands = new BrandService(); const themes = new ThemeService();
    const brand = await brands.read(owner.id, project.id);
    await brands.update(owner.id, { projectId: project.id, expectedRevision: brand.revision, brand: { companyName: "Kept Company", companyDescription: "Keep this.", brandNotes: "Keep notes." } });
    const theme = await themes.read(owner.id, project.id);
    const changed = await themes.update(owner.id, { projectId: project.id, expectedRevision: theme.revision, theme: { ...DEFAULT_THEME, radiusScale: 100, lightTokens: { ...DEFAULT_LIGHT_TOKENS, accent: "#FF0000" } } });
    const reset = await themes.reset(owner.id, { projectId: project.id, expectedRevision: changed.revision });
    expect(reset).toMatchObject(DEFAULT_THEME);
    await expect(brands.read(owner.id, project.id)).resolves.toMatchObject({ companyName: "Kept Company", companyDescription: "Keep this.", brandNotes: "Keep notes." });
  });

  it("prevents stale autosaves from overwriting newer theme state", async () => {
    const owner = await createUser("owner");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    const themes = new ThemeService();
    const original = await themes.read(owner.id, project.id);
    const newer = await themes.update(owner.id, { projectId: project.id, expectedRevision: original.revision, theme: { ...DEFAULT_THEME, radiusScale: 80 } });
    await expect(themes.update(owner.id, { projectId: project.id, expectedRevision: original.revision, theme: { ...DEFAULT_THEME, radiusScale: 40 } })).rejects.toThrowError(/changed elsewhere/);
    await expect(themes.read(owner.id, project.id)).resolves.toMatchObject({ radiusScale: 80, revision: newer.revision });
  });

  it("enforces theme isolation for unrelated and removed collaborators", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const unrelated = await createUser("unrelated");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const projectA = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "A" });
    const unrelatedWorkspace = await new WorkspaceService().create(unrelated.id, { name: "Other workspace" });
    const projectB = await new ProjectService().create(unrelated.id, { workspaceId: unrelatedWorkspace.id, name: "B" });
    await db.insert(projectMembers).values({ projectId: projectA.id, userId: collaborator.id });
    const brands = new BrandService(); const themes = new ThemeService();
    await expect(themes.read(owner.id, projectB.id)).rejects.toThrowError(/do not have access/);
    await expect(brands.read(owner.id, projectB.id)).rejects.toThrowError(/do not have access/);
    await expect(themes.update(owner.id, { projectId: projectB.id, expectedRevision: 1, theme: DEFAULT_THEME })).rejects.toThrowError(/do not have access/);
    await expect(brands.update(owner.id, { projectId: projectB.id, expectedRevision: 1, brand: { companyName: "Injected", companyDescription: "", brandNotes: "" } })).rejects.toThrowError(/do not have access/);
    await expect(themes.reset(owner.id, { projectId: projectB.id, expectedRevision: 1 })).rejects.toThrowError(/do not have access/);
    await new MembershipService().remove(owner.id, { projectId: projectA.id, userId: collaborator.id });
    await expect(themes.read(collaborator.id, projectA.id)).rejects.toThrowError(/do not have access/);
    await expect(brands.update(collaborator.id, { projectId: projectA.id, expectedRevision: 1, brand: { companyName: "No", companyDescription: "", brandNotes: "" } })).rejects.toThrowError(/do not have access/);
  });

  it("uploads, organizes, edits, references, and soft-deletes media", async () => {
    const owner = await createUser("owner");
    const collaborator = await createUser("collaborator");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Website" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const objects = new Map<string, Uint8Array>();
    const storage: ObjectStorage = { put: async (key, value) => { objects.set(key, value); }, get: async (key) => { const value = objects.get(key); if (!value) throw new Error("missing"); return value; }, exists: async (key) => objects.has(key), delete: async (key) => { objects.delete(key); } };
    const media = new MediaService(undefined, undefined, storage);
    const parent = await media.createFolder(owner.id, { projectId: project.id, name: "Brand" });
    const child = await media.createFolder(collaborator.id, { projectId: project.id, parentId: parent?.id, name: "Logos" });
    const png = new Uint8Array(45); png.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(png.buffer); view.setUint32(8, 13); png.set(new TextEncoder().encode("IHDR"), 12); view.setUint32(16, 640); view.setUint32(20, 320); png.set(new TextEncoder().encode("IEND"), 37);
    const previousLimit = process.env.MEDIA_MAX_BYTES; process.env.MEDIA_MAX_BYTES = "10";
    await expect(media.upload(collaborator.id, { projectId: project.id, folderId: child?.id, filename: "large.png", bytes: png })).rejects.toThrowError(/0 MB or smaller/);
    if (previousLimit === undefined) delete process.env.MEDIA_MAX_BYTES; else process.env.MEDIA_MAX_BYTES = previousLimit;
    const asset = await media.upload(collaborator.id, { projectId: project.id, folderId: child?.id, filename: "acme/logo.png", bytes: png });
    expect(asset).toMatchObject({ originalFilename: "acme-logo.png", displayName: "acme-logo", width: 640, height: 320, mimeType: "image/png" });
    expect(objects.get(asset.storageKey)).toEqual(png);
    await media.updateAsset(owner.id, { projectId: project.id, assetId: asset.id, displayName: "Acme primary", altText: "Acme wordmark" });
    await media.setBrandLogo(owner.id, { projectId: project.id, kind: "primary", assetId: asset.id });
    await expect(getProjectMediaContext(owner.id, project.id)).resolves.toEqual([expect.objectContaining({ id: asset.id, folderPath: "Brand/Logos", altText: "Acme wordmark" })]);
    await expect(media.readBinary(collaborator.id, asset.id)).resolves.toMatchObject({ asset: { id: asset.id }, bytes: png });
    await media.deleteFolder(owner.id, { projectId: project.id, folderId: parent?.id });
    expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id)))[0]?.deletedAt).toBeInstanceOf(Date);
    expect((await db.select().from(projectBrandSettings).where(eq(projectBrandSettings.projectId, project.id)))[0]?.primaryLogoMediaId).toBeNull();
    expect(objects.has(asset.storageKey)).toBe(true);
    await expect(media.readBinary(owner.id, asset.id)).rejects.toThrowError(/not found/);
  });

  it("enforces media tenant boundaries, revocation, cycles, and database project constraints", async () => {
    const owner = await createUser("owner"); const collaborator = await createUser("collaborator"); const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const a = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "A" });
    const b = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "B" });
    await db.insert(projectMembers).values({ projectId: a.id, userId: collaborator.id });
    const storage: ObjectStorage = { put: async () => {}, get: async () => new Uint8Array([1]), exists: async () => true, delete: async () => {} };
    const media = new MediaService(undefined, undefined, storage);
    const root = await media.createFolder(owner.id, { projectId: a.id, name: "Root" });
    const child = await media.createFolder(owner.id, { projectId: a.id, parentId: root?.id, name: "Child" });
    const foreign = await media.createFolder(owner.id, { projectId: b.id, name: "Foreign" });
    const png = new Uint8Array(45); png.set([137, 80, 78, 71, 13, 10, 26, 10]); const imageView = new DataView(png.buffer); imageView.setUint32(8, 13); png.set(new TextEncoder().encode("IHDR"), 12); imageView.setUint32(16, 10); imageView.setUint32(20, 10); png.set(new TextEncoder().encode("IEND"), 37);
    const foreignAsset = await media.upload(owner.id, { projectId: b.id, filename: "foreign.png", bytes: png });
    await expect(media.moveFolder(owner.id, { projectId: a.id, folderId: root?.id, parentId: child?.id })).rejects.toThrowError(/children/);
    await expect(media.moveFolder(owner.id, { projectId: a.id, folderId: root?.id, parentId: foreign?.id })).rejects.toThrowError(/not found/);
    await expect(media.list(stranger.id, { projectId: a.id })).rejects.toThrowError(/do not have access/);
    await expect(media.setBrandLogo(owner.id, { projectId: a.id, kind: "primary", assetId: foreignAsset.id })).rejects.toThrowError(/not found/);
    await expect(db.update(projectBrandSettings).set({ primaryLogoMediaId: foreignAsset.id }).where(eq(projectBrandSettings.projectId, a.id))).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(db.insert(mediaAssets).values({ projectId: a.id, folderId: foreign?.id, originalFilename: "x.png", displayName: "x", storageKey: "unique/x.png", mimeType: "image/png", sizeBytes: 1, width: 1, height: 1, createdByUserId: owner.id })).rejects.toMatchObject({ cause: { code: "23503" } });
    await new MembershipService().remove(owner.id, { projectId: a.id, userId: collaborator.id });
    await expect(media.createFolder(collaborator.id, { projectId: a.id, name: "Revoked" })).rejects.toThrowError(/do not have access/);
  });

  it("builds safe versioned preview manifests for owners and collaborators and revokes access", async () => {
    const owner = await createUser("owner"); const collaborator = await createUser("collaborator"); const stranger = await createUser("stranger");
    const workspace = await new WorkspaceService().create(owner.id, { name: "Workspace" });
    const project = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Preview Site" });
    const other = await new ProjectService().create(owner.id, { workspaceId: workspace.id, name: "Other" });
    await db.insert(projectMembers).values({ projectId: project.id, userId: collaborator.id });
    const tree = new PageTreeService(); const home = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Home" });
    const folder = await tree.create(owner.id, { projectId: project.id, type: "folder", name: "Company" });
    const about = await tree.create(owner.id, { projectId: project.id, parentId: folder.id, type: "page", name: "About" });
    const services = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Services" });
    const web = await tree.create(owner.id, { projectId: project.id, parentId: services.id, type: "page", name: "Web" });
    const removed = await tree.create(owner.id, { projectId: project.id, type: "page", name: "Removed" }); await tree.deleteSubtree(owner.id, { projectId: project.id, nodeId: removed.id });
    const themes = new ThemeService(); const currentTheme = await themes.read(owner.id, project.id); await themes.update(owner.id, { projectId: project.id, expectedRevision: currentTheme.revision, theme: { ...DEFAULT_THEME, lightTokens: { ...DEFAULT_LIGHT_TOKENS, accent: "#123456" }, radiusScale: 80, spacingScale: 70, shadowScale: 60, fontScale: 55, borderScale: 65 } });
    const [logo] = await db.insert(mediaAssets).values({ projectId: project.id, originalFilename: "logo.png", displayName: "Logo", storageKey: `projects/${project.id}/safe-logo`, mimeType: "image/png", sizeBytes: 100, width: 200, height: 80, altText: "Preview Site logo", createdByUserId: owner.id }).returning();
    await db.insert(mediaAssets).values({ projectId: other.id, originalFilename: "foreign.png", displayName: "Foreign", storageKey: `projects/${other.id}/foreign`, mimeType: "image/png", sizeBytes: 100, width: 20, height: 20, createdByUserId: owner.id });
    if (!logo) throw new Error("Logo was not created.");
    await db.update(projectBrandSettings).set({ primaryLogoMediaId: logo.id, alternateLogoMediaId: logo.id }).where(eq(projectBrandSettings.projectId, project.id));
    const tokens = new PreviewTokenService("integration-preview-secret-that-is-definitely-long-enough"); const previews = new PreviewManifestService(undefined, tokens);
    const ownerSession = await previews.createSession(owner.id, project.id); const manifest = ownerSession.manifest; const serializedManifest = JSON.stringify(manifest);
    expect(manifest).toMatchObject({ manifestVersion: 1, projectId: project.id, homepage: home.id, routes: { "/": { pageId: home.id }, "/about": { pageId: about.id }, "/services": { pageId: services.id }, "/services/web": { pageId: web.id } }, brand: { logoMediaIds: { light: logo.id, dark: logo.id } }, theme: { colors: { light: { accent: "#123456" } } } });
    expect(manifest.pages.some((page) => page.pageId === removed.id)).toBe(false); expect(Object.values(manifest.routes).some((route) => route.name === "Company")).toBe(false);
    expect(manifest.media[logo.id]).toMatchObject({ id: logo.id, previewUrl: expect.stringContaining(`/api/preview/media/${logo.id}?token=`) });
    expect(Object.values(manifest.media)).toHaveLength(1); expect(serializedManifest).not.toContain("storageKey"); expect(serializedManifest).not.toContain("safe-logo"); expect(serializedManifest).not.toContain("DATABASE_URL");
    await expect(previews.createSession(collaborator.id, project.id)).resolves.toMatchObject({ manifest: { projectId: project.id } });
    await expect(previews.createSession(stranger.id, project.id)).rejects.toThrowError(/do not have access/);
    const collaboratorSession = await previews.createSession(collaborator.id, project.id); await new MembershipService().remove(owner.id, { projectId: project.id, userId: collaborator.id });
    await expect(previews.fromToken(collaboratorSession.token)).rejects.toThrowError(/do not have access/);
  });
});
