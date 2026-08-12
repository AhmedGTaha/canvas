import { and, asc, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { auditEvents, projectMembers, projects, users } from "@/server/db/schema";

export class MembershipRepository {
  constructor(private readonly database: Database = db) {}

  async find(projectId: string, userId: string) {
    const [membership] = await this.database.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))).limit(1);
    return membership;
  }

  list(projectId: string) {
    return this.database.select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    }).from(projectMembers).innerJoin(users, eq(users.id, projectMembers.userId)).where(eq(projectMembers.projectId, projectId)).orderBy(asc(projectMembers.createdAt));
  }

  async owner(projectId: string) {
    const [owner] = await this.database.select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
    }).from(projects).innerJoin(users, eq(users.id, projects.ownerUserId)).where(eq(projects.id, projectId)).limit(1);
    if (!owner) return undefined;
    return { ...owner, role: "owner" as const };
  }

  async remove(projectId: string, collaboratorUserId: string, actorUserId: string) {
    return this.database.transaction(async (transaction) => {
      const [removed] = await transaction.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, collaboratorUserId))).returning();
      if (removed) await transaction.insert(auditEvents).values({ projectId, userId: actorUserId, action: "project.collaborator_removed", entityType: "project_member", entityId: collaboratorUserId });
      return removed;
    });
  }
}
