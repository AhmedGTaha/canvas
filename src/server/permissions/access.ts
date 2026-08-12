import type { Workspace } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";

export function requireWorkspaceOwner<T extends Pick<Workspace, "ownerUserId">>(userId: string, workspace: T | undefined): T {
  if (!workspace) throw new DomainError("NOT_FOUND", "Workspace not found.");
  if (workspace.ownerUserId !== userId) throw new DomainError("ACCESS_DENIED", "You do not have access to this workspace.");
  return workspace;
}

export function requireWorkspaceAccess<T extends Pick<Workspace, "ownerUserId">>(userId: string, workspace: T | undefined): T {
  return requireWorkspaceOwner(userId, workspace);
}
