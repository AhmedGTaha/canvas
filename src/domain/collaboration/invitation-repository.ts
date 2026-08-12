import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { auditEvents, projectInvites, projectMembers, projects } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";

export class InvitationRepository {
  constructor(private readonly database: Database = db) {}

  async findByTokenHash(tokenHash: string) {
    const [record] = await this.database.select({ invite: projectInvites, project: projects })
      .from(projectInvites)
      .innerJoin(projects, eq(projects.id, projectInvites.projectId))
      .where(eq(projectInvites.tokenHash, tokenHash))
      .limit(1);
    return record;
  }

  async findCurrent(projectId: string) {
    const [invite] = await this.database.select().from(projectInvites).where(and(
      eq(projectInvites.projectId, projectId),
      isNull(projectInvites.revokedAt),
      gt(projectInvites.expiresAt, new Date()),
    )).orderBy(desc(projectInvites.createdAt)).limit(1);
    return invite;
  }

  createReplacingActive(projectId: string, userId: string, tokenHash: string, expiresAt: Date) {
    return this.database.transaction(async (transaction) => {
      await transaction.update(projectInvites).set({ revokedAt: new Date() }).where(and(eq(projectInvites.projectId, projectId), isNull(projectInvites.revokedAt)));
      const [invite] = await transaction.insert(projectInvites).values({ projectId, createdByUserId: userId, tokenHash, expiresAt }).returning();
      if (!invite) throw new Error("Invitation insert did not return a record.");
      await transaction.insert(auditEvents).values({ projectId, userId, action: "project.invite_created", entityType: "project_invite", entityId: invite.id });
      return invite;
    });
  }

  revoke(projectId: string, inviteId: string, userId: string) {
    return this.database.transaction(async (transaction) => {
      const [invite] = await transaction.update(projectInvites).set({ revokedAt: new Date() }).where(and(
        eq(projectInvites.id, inviteId),
        eq(projectInvites.projectId, projectId),
        isNull(projectInvites.revokedAt),
      )).returning();
      if (!invite) throw new DomainError("NOT_FOUND", "Active invitation not found.");
      await transaction.insert(auditEvents).values({ projectId, userId, action: "project.invite_revoked", entityType: "project_invite", entityId: invite.id });
      return invite;
    });
  }

  accept(tokenHash: string, userId: string) {
    return this.database.transaction(async (transaction) => {
      const [record] = await transaction.select({ invite: projectInvites, project: projects })
        .from(projectInvites)
        .innerJoin(projects, eq(projects.id, projectInvites.projectId))
        .where(eq(projectInvites.tokenHash, tokenHash))
        .limit(1)
        .for("update");

      if (!record) throw new DomainError("NOT_FOUND", "Invitation is invalid or no longer available.");
      if (record.invite.revokedAt) throw new DomainError("ACCESS_DENIED", "This invitation has been revoked.");
      if (record.invite.expiresAt <= new Date()) throw new DomainError("ACCESS_DENIED", "This invitation has expired.");
      if (record.project.status !== "active") throw new DomainError("ACCESS_DENIED", "This project is not accepting collaborators.");

      if (record.project.ownerUserId !== userId) {
        const inserted = await transaction.insert(projectMembers).values({ projectId: record.project.id, userId, role: "collaborator" }).onConflictDoNothing().returning();
        if (inserted.length > 0) {
          await transaction.insert(auditEvents).values({ projectId: record.project.id, userId, action: "project.invite_accepted", entityType: "project_invite", entityId: record.invite.id });
        }
      }
      return record.project;
    });
  }
}
