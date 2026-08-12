import { DomainError } from "@/domain/shared/errors";
import { requireProjectAccess } from "@/server/permissions/access";
import { WorkspaceRepository } from "@/domain/workspaces/repository";
import { requireWorkspaceOwner } from "@/server/permissions/access";
import { createProjectSchema, projectIdSchema, renameProjectSchema } from "./schemas";
import { ProjectRepository } from "./repository";

export class ProjectService {
  constructor(
    private readonly projects = new ProjectRepository(),
    private readonly workspaces = new WorkspaceRepository(),
  ) {}

  async listInWorkspace(userId: string, workspaceId: string) {
    requireWorkspaceOwner(userId, await this.workspaces.findById(workspaceId));
    return this.projects.listActiveInWorkspace(workspaceId, userId);
  }

  listOwned(userId: string) {
    return this.projects.listActiveOwned(userId);
  }

  async read(userId: string, rawId: string) {
    const id = projectIdSchema.parse(rawId);
    return requireProjectAccess(userId, await this.projects.findById(id));
  }

  async create(userId: string, input: unknown) {
    const parsed = createProjectSchema.parse(input);
    requireWorkspaceOwner(userId, await this.workspaces.findById(parsed.workspaceId));
    return this.projects.create(parsed.workspaceId, userId, parsed.name, parsed.description);
  }

  async rename(userId: string, input: unknown) {
    const { id, name } = renameProjectSchema.parse(input);
    requireProjectAccess(userId, await this.projects.findById(id));
    const project = await this.projects.rename(id, userId, name);
    if (!project) throw new DomainError("ACCESS_DENIED", "You do not have access to this project.");
    return project;
  }
}
