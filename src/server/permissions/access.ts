import type { Workspace } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";

type WorkspaceAccessRecord = Pick<Workspace, "ownerUserId"> & Partial<Pick<Workspace, "archivedAt">>;

export function requireWorkspaceOwner<T extends WorkspaceAccessRecord>(userId: string, workspace: T | undefined): T {
  if (!workspace) throw new DomainError("NOT_FOUND", "Workspace not found.");
  if (workspace.archivedAt) throw new DomainError("NOT_FOUND", "Workspace not found.");
  if (workspace.ownerUserId !== userId) throw new DomainError("ACCESS_DENIED", "You do not have access to this workspace.");
  return workspace;
}

export function requireWorkspaceAccess<T extends WorkspaceAccessRecord>(userId: string, workspace: T | undefined): T {
  return requireWorkspaceOwner(userId, workspace);
}
