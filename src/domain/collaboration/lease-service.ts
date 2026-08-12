import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { DomainError } from "@/domain/shared/errors";
import { editingLeases, pageNodes } from "@/server/db/schema";
import { collaborationConfig } from "@/server/config/collaboration";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { leaseTargetSchema } from "./schemas";

export class EditingLeaseService {
  constructor(
    private readonly database: Database = db,
    private readonly access = new ProjectAccessService(),
  ) {}

  private expiration() {
    return new Date(Date.now() + collaborationConfig.leaseDurationSeconds * 1000);
  }

  private async validateTarget(projectId: string, targetType: "page" | "building_block", targetId: string) {
    if (targetType === "building_block") return; // Building-block ownership is added when that domain exists.
    const [page] = await this.database.select({ id: pageNodes.id }).from(pageNodes).where(and(eq(pageNodes.id, targetId), eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).limit(1);
    if (!page) throw new DomainError("NOT_FOUND", "Lease target not found.");
  }

  async acquire(userId: string, input: unknown) {
    const target = leaseTargetSchema.parse(input);
    await this.access.requireProjectAccess(userId, target.projectId);
    await this.validateTarget(target.projectId, target.targetType, target.targetId);

    // The unique target key plus conditional upsert makes concurrent acquisition atomic.
    // Phase 3/9 will add entity ownership checks once page/block tables exist.
    const [lease] = await this.database.insert(editingLeases).values({ ...target, userId, expiresAt: this.expiration() })
      .onConflictDoUpdate({
        target: [editingLeases.projectId, editingLeases.targetType, editingLeases.targetId],
        set: { userId, expiresAt: this.expiration(), updatedAt: new Date() },
        setWhere: or(lte(editingLeases.expiresAt, new Date()), eq(editingLeases.userId, userId)),
      }).returning();
    if (!lease) throw new DomainError("CONFLICT", "Someone else is currently editing this item.");
    return lease;
  }

  async renew(userId: string, input: unknown) {
    const target = leaseTargetSchema.parse(input);
    await this.access.requireProjectAccess(userId, target.projectId);
    await this.validateTarget(target.projectId, target.targetType, target.targetId);
    const [lease] = await this.database.update(editingLeases).set({ expiresAt: this.expiration(), updatedAt: new Date() }).where(and(
      eq(editingLeases.projectId, target.projectId),
      eq(editingLeases.targetType, target.targetType),
      eq(editingLeases.targetId, target.targetId),
      eq(editingLeases.userId, userId),
      gt(editingLeases.expiresAt, new Date()),
    )).returning();
    if (!lease) throw new DomainError("CONFLICT", "This editing lease is no longer active.");
    return lease;
  }

  async release(userId: string, input: unknown) {
    const target = leaseTargetSchema.parse(input);
    await this.access.requireProjectAccess(userId, target.projectId);
    await this.validateTarget(target.projectId, target.targetType, target.targetId);
    const [lease] = await this.database.delete(editingLeases).where(and(
      eq(editingLeases.projectId, target.projectId),
      eq(editingLeases.targetType, target.targetType),
      eq(editingLeases.targetId, target.targetId),
      eq(editingLeases.userId, userId),
    )).returning();
    return lease ?? null;
  }

  async getActiveLease(userId: string, input: unknown) {
    const target = leaseTargetSchema.parse(input);
    await this.access.requireProjectAccess(userId, target.projectId);
    await this.validateTarget(target.projectId, target.targetType, target.targetId);
    const [lease] = await this.database.select().from(editingLeases).where(and(
      eq(editingLeases.projectId, target.projectId),
      eq(editingLeases.targetType, target.targetType),
      eq(editingLeases.targetId, target.targetId),
      gt(editingLeases.expiresAt, new Date()),
    )).limit(1);
    return lease ?? null;
  }
}
