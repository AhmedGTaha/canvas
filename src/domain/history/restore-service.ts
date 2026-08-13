import { and, desc, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlockVersions, buildingBlocks, pageNodes, pageVersions, users } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { recordChangeSet } from "./change-set-service";
import { applyRestorePlan, validateRestorePlan } from "./restore-engine";
import { HistoryError, versionNotFound } from "./errors";
import { observe } from "@/server/observability/events";

function summaryHeadline(changeSummary: unknown) {
  if (!changeSummary || typeof changeSummary !== "object") return null;
  const headline = (changeSummary as { headline?: unknown }).headline;
  return typeof headline === "string" ? headline : null;
}
const alreadyActive = () => new HistoryError("RESTORE_INVALID", "CONFLICT", "That version is already the active one.");

/**
 * Version History and restore for Pages and Building Blocks. Restoring never deletes or
 * rewrites versions: it activates an existing immutable version and records the move as
 * an auditable, reversible Change Set.
 */
export class VersionRestoreService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  async listPageVersions(userId: string, projectId: string, pageId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [page] = await this.database.select().from(pageNodes).where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).limit(1);
    if (!page) throw new DomainError("NOT_FOUND", "Page not found.");
    const rows = await this.database.select({ version: pageVersions, actor: users.displayName }).from(pageVersions)
      .innerJoin(users, eq(users.id, pageVersions.createdByUserId))
      .where(and(eq(pageVersions.projectId, projectId), eq(pageVersions.pageId, pageId)))
      .orderBy(desc(pageVersions.versionNumber));
    return {
      currentVersionId: page.currentVersionId,
      versions: rows.map(({ version, actor }) => ({ id: version.id, versionNumber: version.versionNumber, createdAt: version.createdAt, actor, summary: summaryHeadline(version.changeSummary), isCurrent: version.id === page.currentVersionId })),
    };
  }

  async listBlockVersions(userId: string, projectId: string, blockId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [block] = await this.database.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, blockId), eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt))).limit(1);
    if (!block) throw new DomainError("NOT_FOUND", "Building Block not found.");
    const rows = await this.database.select({ version: buildingBlockVersions, actor: users.displayName }).from(buildingBlockVersions)
      .innerJoin(users, eq(users.id, buildingBlockVersions.createdByUserId))
      .where(and(eq(buildingBlockVersions.projectId, projectId), eq(buildingBlockVersions.buildingBlockId, blockId)))
      .orderBy(desc(buildingBlockVersions.versionNumber));
    return {
      currentVersionId: block.currentVersionId,
      versions: rows.map(({ version, actor }) => ({ id: version.id, versionNumber: version.versionNumber, createdAt: version.createdAt, actor, summary: summaryHeadline(version.changeSummary), isCurrent: version.id === block.currentVersionId })),
    };
  }

  async restorePageVersion(userId: string, projectId: string, pageId: string, versionId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const [page] = await transaction.select().from(pageNodes).where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).for("update");
      if (!page) throw new DomainError("NOT_FOUND", "Page not found.");
      // Project-scoped and page-scoped: a version ID from another page or project is unknown here.
      const [version] = await transaction.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId), eq(pageVersions.projectId, projectId))).limit(1);
      if (!version) throw versionNotFound();
      if (page.currentVersionId === version.id) throw alreadyActive();

      const plan = { pages: [{ pageId, versionId: version.id }], blocks: [] };
      await validateRestorePlan(transaction, projectId, plan);
      await applyRestorePlan(transaction, projectId, plan);
      const changeSet = await recordChangeSet(transaction, {
        projectId, actorUserId: userId, operation: "page_version_restore",
        summary: `Restored ${page.name} to version ${version.versionNumber}`,
        items: [{ entityType: "page", entityId: pageId, beforeVersionId: page.currentVersionId, afterVersionId: version.id }],
      });
      observe.historyAction("page_restore", { projectId, changeSetId: changeSet.id, entityId: pageId });
      return { changeSet, version };
    });
  }

  async restoreBlockVersion(userId: string, projectId: string, blockId: string, versionId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const [block] = await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, blockId), eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt))).for("update");
      if (!block) throw new DomainError("NOT_FOUND", "Building Block not found.");
      const [version] = await transaction.select().from(buildingBlockVersions).where(and(eq(buildingBlockVersions.id, versionId), eq(buildingBlockVersions.buildingBlockId, blockId), eq(buildingBlockVersions.projectId, projectId))).limit(1);
      if (!version) throw versionNotFound();
      if (block.currentVersionId === version.id) throw alreadyActive();

      // Global blocks propagate through the shared active pointer; non-global usages keep
      // their pins, so restoring a block never rewrites page source either way.
      const plan = { pages: [], blocks: [{ blockId, versionId: version.id }] };
      await validateRestorePlan(transaction, projectId, plan);
      await applyRestorePlan(transaction, projectId, plan);
      const changeSet = await recordChangeSet(transaction, {
        projectId, actorUserId: userId, operation: "block_version_restore",
        summary: `Restored ${block.name} to version ${version.versionNumber}`,
        items: [{ entityType: "building_block", entityId: blockId, beforeVersionId: block.currentVersionId, afterVersionId: version.id }],
      });
      observe.historyAction("block_restore", { projectId, changeSetId: changeSet.id, entityId: blockId });
      return { changeSet, version };
    });
  }
}
