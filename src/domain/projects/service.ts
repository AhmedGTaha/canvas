import { DomainError } from "@/domain/shared/errors";
import { WorkspaceRepository } from "@/domain/workspaces/repository";
import { requireWorkspaceOwner } from "@/server/permissions/access";
import { createProjectSchema, projectIdSchema, renameProjectSchema } from "./schemas";
import { ProjectRepository } from "./repository";
import { ProjectAccessService } from "@/server/permissions/project-access";

export class ProjectService {
  constructor(
    private readonly projects = new ProjectRepository(),
    private readonly workspaces = new WorkspaceRepository(),
    private readonly access = new ProjectAccessService(projects),
  ) {}

  async listInWorkspace(userId: string, workspaceId: string) {
    requireWorkspaceOwner(userId, await this.workspaces.findById(workspaceId));
    return this.projects.listActiveInWorkspace(workspaceId, userId);
  }

  listOwned(userId: string) {
    return this.projects.listActiveOwned(userId);
  }

  listArchived(userId: string) {
    return this.projects.listArchivedOwned(userId);
  }

  async listAccessible(userId: string) {
    const [owned, sharedRows] = await Promise.all([this.projects.listActiveOwned(userId), this.projects.listActiveShared(userId)]);
    return { owned, shared: sharedRows.map(({ project }) => project) };
  }

  async read(userId: string, rawId: string) {
    const id = projectIdSchema.parse(rawId);
    return (await this.access.requireProjectAccess(userId, id)).project;
  }

  async readWithRole(userId: string, rawId: string) {
    const id = projectIdSchema.parse(rawId);
    const access = await this.access.requireProjectAccess(userId, id);
    const owner = await this.projects.findOwnerProfile(id);
    const workspace = await this.workspaces.findById(access.project.workspaceId);
    if (!owner || !workspace) throw new DomainError("NOT_FOUND", "Project not found.");
    return { ...access, owner, workspace };
  }

  async create(userId: string, input: unknown) {
    const parsed = createProjectSchema.parse(input);
    requireWorkspaceOwner(userId, await this.workspaces.findById(parsed.workspaceId));
    return this.projects.create(parsed.workspaceId, userId, parsed.name, parsed.description);
  }

  async rename(userId: string, input: unknown) {
    const { id, name } = renameProjectSchema.parse(input);
    await this.access.requireProjectOwner(userId, id);
    const project = await this.projects.rename(id, userId, name);
    if (!project) throw new DomainError("ACCESS_DENIED", "You do not have access to this project.");
    return project;
  }

  async archive(userId: string, rawId: unknown) {
    const id = projectIdSchema.parse(rawId);
    await this.access.requireProjectOwner(userId, id);
    const project = await this.projects.archive(id, userId);
    if (!project) throw new DomainError("NOT_FOUND", "Project not found.");
    return project;
  }

  async restore(userId: string, rawId: unknown) {
    const id = projectIdSchema.parse(rawId);
    const archived = await this.projects.findById(id);
    if (!archived || archived.ownerUserId !== userId || archived.status !== "archived") throw new DomainError("NOT_FOUND", "Archived project not found.");
    requireWorkspaceOwner(userId, await this.workspaces.findById(archived.workspaceId));
    const project = await this.projects.restore(id, userId);
    if (!project) throw new DomainError("NOT_FOUND", "Archived project not found.");
    return project;
  }
}
