import type { Project, Workspace } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";

export function requireWorkspaceOwner<T extends Pick<Workspace, "ownerUserId">>(userId: string, workspace: T | undefined): T {
  if (!workspace) throw new DomainError("NOT_FOUND", "Workspace not found.");
  if (workspace.ownerUserId !== userId) throw new DomainError("ACCESS_DENIED", "You do not have access to this workspace.");
  return workspace;
}

export function requireWorkspaceAccess<T extends Pick<Workspace, "ownerUserId">>(userId: string, workspace: T | undefined): T {
  return requireWorkspaceOwner(userId, workspace);
}

export function requireProjectOwner<T extends Pick<Project, "ownerUserId" | "status">>(userId: string, project: T | undefined): T {
  if (!project || project.status === "deleted") throw new DomainError("NOT_FOUND", "Project not found.");
  if (project.ownerUserId !== userId) throw new DomainError("ACCESS_DENIED", "You do not have access to this project.");
  return project;
}

export function requireProjectAccess<T extends Pick<Project, "ownerUserId" | "status">>(userId: string, project: T | undefined): T {
  return requireProjectOwner(userId, project);
}
