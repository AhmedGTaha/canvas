import { DomainError } from "@/domain/shared/errors";
import { createWorkspaceSchema, renameWorkspaceSchema, workspaceIdSchema } from "./schemas";
import { WorkspaceRepository } from "./repository";
import { requireWorkspaceAccess } from "@/server/permissions/access";

export class WorkspaceService {
  constructor(private readonly repository = new WorkspaceRepository()) {}

  list(userId: string) {
    return this.repository.listOwned(userId);
  }

  async read(userId: string, rawId: string) {
    const id = workspaceIdSchema.parse(rawId);
    return requireWorkspaceAccess(userId, await this.repository.findById(id));
  }

  create(userId: string, input: unknown) {
    const { name } = createWorkspaceSchema.parse(input);
    return this.repository.create(userId, name);
  }

  async rename(userId: string, input: unknown) {
    const { id, name } = renameWorkspaceSchema.parse(input);
    requireWorkspaceAccess(userId, await this.repository.findById(id));
    const workspace = await this.repository.rename(id, userId, name);
    if (!workspace) throw new DomainError("ACCESS_DENIED", "You do not have access to this workspace.");
    return workspace;
  }
}
