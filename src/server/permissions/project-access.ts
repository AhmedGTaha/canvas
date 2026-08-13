import { DomainError } from "@/domain/shared/errors";
import { MembershipRepository } from "@/domain/collaboration/membership-repository";
import { ProjectRepository } from "@/domain/projects/repository";
import { observe } from "@/server/observability/events";

export type EffectiveProjectRole = "owner" | "collaborator";

export class ProjectAccessService {
  constructor(
    private readonly projects = new ProjectRepository(),
    private readonly memberships = new MembershipRepository(),
  ) {}

  async getProjectRole(userId: string, projectId: string): Promise<EffectiveProjectRole | null> {
    const project = await this.projects.findById(projectId);
    if (!project || project.status === "deleted") return null;
    if (project.ownerUserId === userId) return "owner";
    return (await this.memberships.find(projectId, userId))?.role === "collaborator" ? "collaborator" : null;
  }

  async requireProjectAccess(userId: string, projectId: string) {
    const project = await this.projects.findById(projectId);
    if (!project || project.status === "deleted") throw new DomainError("NOT_FOUND", "Project not found.");
    if (project.ownerUserId === userId) return { project, role: "owner" as const };
    const membership = await this.memberships.find(projectId, userId);
    if (membership?.role === "collaborator") return { project, role: "collaborator" as const };
    observe.accessDenied({ userId, projectId, resource: "project", reason: "not_a_member" });
    throw new DomainError("ACCESS_DENIED", "You do not have access to this project.");
  }

  async requireProjectOwner(userId: string, projectId: string) {
    const access = await this.requireProjectAccess(userId, projectId);
    if (access.role !== "owner") {
      observe.accessDenied({ userId, projectId, resource: "project_ownership", reason: "not_owner" });
      throw new DomainError("ACCESS_DENIED", "Only the project owner can manage access.");
    }
    return access.project;
  }
}
