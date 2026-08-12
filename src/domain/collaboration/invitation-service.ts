import { createSecureToken, sha256 } from "@/domain/shared/crypto";
import { DomainError } from "@/domain/shared/errors";
import { collaborationConfig } from "@/server/config/collaboration";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { consumeRateLimit } from "@/server/rate-limit/service";
import { acceptInviteSchema, createInviteSchema, inviteTokenSchema, revokeInviteSchema } from "./schemas";
import { InvitationRepository } from "./invitation-repository";

export class InvitationService {
  constructor(
    private readonly invitations = new InvitationRepository(),
    private readonly access = new ProjectAccessService(),
  ) {}

  async preview(rawToken: unknown) {
    const token = inviteTokenSchema.parse(rawToken);
    await consumeRateLimit("invite-preview", token, { attempts: 60, windowMinutes: 15 });
    const record = await this.invitations.findByTokenHash(sha256(token));
    if (!record || record.invite.revokedAt || record.invite.expiresAt <= new Date() || record.project.status !== "active") {
      throw new DomainError("NOT_FOUND", "Invitation is invalid or no longer available.");
    }
    return { projectId: record.project.id, projectName: record.project.name, expiresAt: record.invite.expiresAt };
  }

  async current(userId: string, rawProjectId: unknown) {
    const { projectId } = createInviteSchema.parse({ projectId: rawProjectId });
    await this.access.requireProjectOwner(userId, projectId);
    return this.invitations.findCurrent(projectId);
  }

  async create(userId: string, input: unknown) {
    const { projectId } = createInviteSchema.parse(input);
    await this.access.requireProjectOwner(userId, projectId);
    await consumeRateLimit("invite-create", userId, { attempts: 20, windowMinutes: 60 });
    const token = createSecureToken();
    const expiresAt = new Date(Date.now() + collaborationConfig.inviteLifetimeDays * 24 * 60 * 60 * 1000);
    const invite = await this.invitations.createReplacingActive(projectId, userId, sha256(token), expiresAt);
    return { invite, token };
  }

  async revoke(userId: string, input: unknown) {
    const { projectId, inviteId } = revokeInviteSchema.parse(input);
    await this.access.requireProjectOwner(userId, projectId);
    return this.invitations.revoke(projectId, inviteId, userId);
  }

  async accept(userId: string, input: unknown) {
    const { token } = acceptInviteSchema.parse(input);
    await consumeRateLimit("invite-accept", userId, { attempts: 20, windowMinutes: 15 });
    return this.invitations.accept(sha256(token), userId);
  }
}
