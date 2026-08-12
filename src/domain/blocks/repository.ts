import { and, asc, eq, inArray, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlockUsages, buildingBlockVersions, buildingBlocks, pageNodes } from "@/server/db/schema";

export type BlockWithVersion = { block: typeof buildingBlocks.$inferSelect; version: typeof buildingBlockVersions.$inferSelect | null };

export class BuildingBlockRepository {
  constructor(private readonly database: Database = db) {}

  listActive(projectId: string) {
    return this.database.select({ block: buildingBlocks, version: buildingBlockVersions })
      .from(buildingBlocks)
      .leftJoin(buildingBlockVersions, and(eq(buildingBlockVersions.id, buildingBlocks.currentVersionId), eq(buildingBlockVersions.buildingBlockId, buildingBlocks.id), eq(buildingBlockVersions.projectId, buildingBlocks.projectId)))
      .where(and(eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt)))
      .orderBy(asc(buildingBlocks.name));
  }

  async find(projectId: string, blockId: string, options: { includeArchived?: boolean } = {}) {
    const [row] = await this.database.select({ block: buildingBlocks, version: buildingBlockVersions })
      .from(buildingBlocks)
      .leftJoin(buildingBlockVersions, and(eq(buildingBlockVersions.id, buildingBlocks.currentVersionId), eq(buildingBlockVersions.buildingBlockId, buildingBlocks.id), eq(buildingBlockVersions.projectId, buildingBlocks.projectId)))
      .where(and(eq(buildingBlocks.id, blockId), eq(buildingBlocks.projectId, projectId), options.includeArchived ? undefined : isNull(buildingBlocks.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  /** Active usages of a Building Block, with the referencing page for the library UI. */
  listUsages(projectId: string, blockId: string) {
    return this.database.select({ usage: buildingBlockUsages, page: pageNodes })
      .from(buildingBlockUsages)
      .innerJoin(pageNodes, and(eq(pageNodes.id, buildingBlockUsages.pageId), eq(pageNodes.projectId, buildingBlockUsages.projectId)))
      .where(and(eq(buildingBlockUsages.projectId, projectId), eq(buildingBlockUsages.buildingBlockId, blockId), isNull(pageNodes.deletedAt)))
      .orderBy(asc(pageNodes.name));
  }

  async usageCounts(projectId: string, blockIds: string[]) {
    if (!blockIds.length) return new Map<string, number>();
    const rows = await this.database.select({ blockId: buildingBlockUsages.buildingBlockId, pageCount: drizzleSql<number>`count(distinct ${buildingBlockUsages.pageId})::int` })
      .from(buildingBlockUsages)
      .innerJoin(pageNodes, and(eq(pageNodes.id, buildingBlockUsages.pageId), eq(pageNodes.projectId, buildingBlockUsages.projectId)))
      .where(and(eq(buildingBlockUsages.projectId, projectId), inArray(buildingBlockUsages.buildingBlockId, blockIds), isNull(pageNodes.deletedAt)))
      .groupBy(buildingBlockUsages.buildingBlockId);
    return new Map(rows.map((row) => [row.blockId, row.pageCount]));
  }
}
