import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { buildingBlockUsages, buildingBlockVersions, buildingBlocks } from "@/server/db/schema";
import type { GeneratedBlockUsage } from "@/domain/generated-source/validator";
import { blockNotGenerated, blockReferenceInvalid } from "./errors";

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
export async function reconcilePageBlockUsages(transaction: TransactionLike, input: { projectId: string; pageId: string; usages: GeneratedBlockUsage[] }) {
  const blockIds = [...new Set(input.usages.map((usage) => usage.blockId))];
  const blocks = blockIds.length
    ? await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.projectId, input.projectId), inArray(buildingBlocks.id, blockIds), isNull(buildingBlocks.deletedAt)))
    : [];
  const byId = new Map(blocks.map((block) => [block.id, block]));

  const resolved: ReconciledBlockUsage[] = input.usages.map((usage) => {
    const block = byId.get(usage.blockId);
    if (!block) throw blockReferenceInvalid();
    if (!block.currentVersionId) throw blockNotGenerated();
    return { ...usage, isGlobal: block.isGlobal, versionId: block.isGlobal ? null : block.currentVersionId, resolvedVersionId: block.currentVersionId };
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
 * Resolves the Block Versions a page renders right now. Global usages follow the
 * block's current active version, so a global change propagates without touching
 * page source or creating a Page Version.
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

  const modules = new Map<string, { blockId: string; versionId: string; sourceCode: string; isGlobal: boolean }>();
  for (const row of rows) {
    const version = row.usage.buildingBlockVersionId ? row.pinned : (row.block.currentVersionId ? currentById.get(row.block.currentVersionId) ?? null : null);
    if (!version || row.block.deletedAt) continue;
    modules.set(row.block.id, { blockId: row.block.id, versionId: version.id, sourceCode: version.sourceCode, isGlobal: row.block.isGlobal });
  }
  return [...modules.values()];
}

/** Active source of the given project's blocks, used to compile a page that reuses them. */
export async function loadActiveBlockSources(database: Database, projectId: string, blockIds: string[]) {
  if (!blockIds.length) return new Map<string, string>();
  const rows = await database.select({ blockId: buildingBlocks.id, sourceCode: buildingBlockVersions.sourceCode })
    .from(buildingBlocks)
    .innerJoin(buildingBlockVersions, and(eq(buildingBlockVersions.id, buildingBlocks.currentVersionId), eq(buildingBlockVersions.buildingBlockId, buildingBlocks.id), eq(buildingBlockVersions.projectId, buildingBlocks.projectId)))
    .where(and(eq(buildingBlocks.projectId, projectId), inArray(buildingBlocks.id, blockIds), isNull(buildingBlocks.deletedAt)));
  return new Map(rows.map((row) => [row.blockId, row.sourceCode]));
}
