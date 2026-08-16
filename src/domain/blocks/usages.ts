import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { buildingBlockUsages, buildingBlockVersions, buildingBlocks } from "@/server/db/schema";
import type { GeneratedBlockUsage } from "@/domain/generated-source/validator";
import { blockNotGenerated, blockReferenceInvalid } from "./errors";
import { versionDocument } from "@/domain/generated-source/stored-version";
import type { GeneratedDocument } from "@/domain/generated-source/document";

export type ReconciledBlockUsage = GeneratedBlockUsage & {
  /** Null for global usages: they resolve the block's current active version. */
  versionId: string | null;
  /** The Block Version this usage resolved to at activation time. */
  resolvedVersionId: string;
  isGlobal: boolean;
};

type TransactionLike = Pick<Database, "select" | "insert" | "delete">;

/**
 * Replaces the active Building Block usage rows for a page so page state and usage
 * state can never disagree. Must run inside the transaction that activates the Page
 * Version. Global usages stay unpinned; non-global usages pin the version that was
 * active when the page was activated.
 */
export async function reconcilePageBlockUsages(transaction: TransactionLike, input: { projectId: string; pageId: string; usages: GeneratedBlockUsage[]; restorePins?: Map<string, string> }) {
  const blockIds = [...new Set(input.usages.map((usage) => usage.blockId))];
  const blocks = blockIds.length
    ? await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.projectId, input.projectId), inArray(buildingBlocks.id, blockIds), isNull(buildingBlocks.deletedAt)))
    : [];
  const byId = new Map(blocks.map((block) => [block.id, block]));

  // A restore may carry the exact pins a historical Page Version rendered with; they are
  // honoured only when the pinned version still belongs to that non-global block.
  const pinnedIds = [...new Set([...(input.restorePins?.values() ?? [])])];
  const pinnedRows = pinnedIds.length
    ? await transaction.select({ id: buildingBlockVersions.id, buildingBlockId: buildingBlockVersions.buildingBlockId }).from(buildingBlockVersions)
        .where(and(eq(buildingBlockVersions.projectId, input.projectId), inArray(buildingBlockVersions.id, pinnedIds)))
    : [];
  const pinnedOwner = new Map(pinnedRows.map((row) => [row.id, row.buildingBlockId]));

  const resolved: ReconciledBlockUsage[] = input.usages.map((usage) => {
    const block = byId.get(usage.blockId);
    if (!block) throw blockReferenceInvalid();
    if (!block.currentVersionId) throw blockNotGenerated();
    if (block.isGlobal) return { ...usage, isGlobal: true, versionId: null, resolvedVersionId: block.currentVersionId };
    const requested = input.restorePins?.get(`${usage.blockId}:${usage.usageKey}`);
    const pinned = requested && pinnedOwner.get(requested) === block.id ? requested : block.currentVersionId;
    return { ...usage, isGlobal: false, versionId: pinned, resolvedVersionId: pinned };
  });

  await transaction.delete(buildingBlockUsages).where(and(eq(buildingBlockUsages.projectId, input.projectId), eq(buildingBlockUsages.pageId, input.pageId)));
  if (resolved.length) {
    await transaction.insert(buildingBlockUsages).values(resolved.map((usage) => ({
      projectId: input.projectId, pageId: input.pageId, buildingBlockId: usage.blockId,
      buildingBlockVersionId: usage.versionId, usageKey: usage.usageKey,
    })));
  }
  return resolved;
}

/**
 * Resolves the Building Block content a page renders right now, one entry per usage.
 *
 * Global usages follow the block's current active version, so a global change propagates
 * without touching page content or creating a Page Version. A usage whose Version predates
 * the static-document format resolves to no document and simply renders as nothing, which
 * is the same outcome as a deleted block: the page still works.
 */
export async function resolvePageBlockModules(database: Database, projectId: string, pageId: string) {
  const rows = await database.select({ usage: buildingBlockUsages, block: buildingBlocks, pinned: buildingBlockVersions })
    .from(buildingBlockUsages)
    .innerJoin(buildingBlocks, and(eq(buildingBlocks.id, buildingBlockUsages.buildingBlockId), eq(buildingBlocks.projectId, buildingBlockUsages.projectId)))
    .leftJoin(buildingBlockVersions, and(eq(buildingBlockVersions.id, buildingBlockUsages.buildingBlockVersionId), eq(buildingBlockVersions.buildingBlockId, buildingBlocks.id), eq(buildingBlockVersions.projectId, buildingBlocks.projectId)))
    .where(and(eq(buildingBlockUsages.projectId, projectId), eq(buildingBlockUsages.pageId, pageId)));

  const currentIds = [...new Set(rows.filter((row) => !row.usage.buildingBlockVersionId && row.block.currentVersionId).map((row) => row.block.currentVersionId!))];
  const currentVersions = currentIds.length
    ? await database.select().from(buildingBlockVersions).where(and(eq(buildingBlockVersions.projectId, projectId), inArray(buildingBlockVersions.id, currentIds)))
    : [];
  const currentById = new Map(currentVersions.map((version) => [version.id, version]));

  const modules: Array<{ blockId: string; usageKey: string; versionId: string; isGlobal: boolean; document: GeneratedDocument | null }> = [];
  for (const row of rows) {
    const version = row.usage.buildingBlockVersionId ? row.pinned : (row.block.currentVersionId ? currentById.get(row.block.currentVersionId) ?? null : null);
    if (!version || row.block.deletedAt) continue;
    modules.push({ blockId: row.block.id, usageKey: row.usage.usageKey, versionId: version.id, isGlobal: row.block.isGlobal, document: versionDocument(version) });
  }
  return modules;
}
