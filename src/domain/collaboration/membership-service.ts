import { DomainError } from "@/domain/shared/errors";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { projectIdSchema } from "@/domain/projects/schemas";
import { removeCollaboratorSchema } from "./schemas";
import { MembershipRepository } from "./membership-repository";
import { observe } from "@/server/observability/events";

export class MembershipService {
  constructor(
    private readonly memberships = new MembershipRepository(),
    private readonly access = new ProjectAccessService(),
  ) {}

  async list(userId: string, rawProjectId: unknown) {
    const projectId = projectIdSchema.parse(rawProjectId);
    const access = await this.access.requireProjectAccess(userId, projectId);
    const [owner, collaborators] = await Promise.all([this.memberships.owner(projectId), this.memberships.list(projectId)]);
    if (!owner) throw new DomainError("NOT_FOUND", "Project not found.");
    return { owner, collaborators, viewerRole: access.role };
  }

  async remove(userId: string, input: unknown) {
    const { projectId, userId: collaboratorUserId } = removeCollaboratorSchema.parse(input);
    const project = await this.access.requireProjectOwner(userId, projectId);
    if (project.ownerUserId === collaboratorUserId) throw new DomainError("ACCESS_DENIED", "The project owner cannot be removed.");
    const removed = await this.memberships.remove(projectId, collaboratorUserId, userId);
    if (!removed) throw new DomainError("NOT_FOUND", "Collaborator not found.");
    observe.permissionChanged("member_removed", { projectId: project.id, actorUserId: userId, subjectUserId: collaboratorUserId });
    return removed;
  }
}
