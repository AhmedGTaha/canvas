import { and, eq, inArray, isNull } from "drizzle-orm";
import { buildingBlockVersions, buildingBlocks, mediaAssets, pageNodes, pageVersions, projectBrandSettings, projectThemeSettings, projects } from "@/server/db/schema";
import { AIError } from "@/domain/ai/provider";
import { reconcilePageBlockUsages } from "@/domain/blocks/usages";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { validateGeneratedPageSource } from "@/domain/page-generation/validator";
import type { GeneratedBlockUsage } from "@/domain/generated-source/validator";
import { restoreInvalid } from "./errors";
import type { TransactionLike } from "./change-set-service";

export type PageTarget = { pageId: string; versionId: string | null };
export type BlockTarget = { blockId: string; versionId: string | null; isGlobal?: boolean; archived?: boolean };
export type ProjectTarget = { currentInstructionId?: string | null; theme?: Record<string, unknown>; brand?: Record<string, unknown> };
/** A fully-resolved target state to activate transactionally. */
export type RestorePlan = { pages: PageTarget[]; blocks: BlockTarget[]; project?: ProjectTarget };

function manifestUsages(manifest: unknown): GeneratedBlockUsage[] {
  if (!manifest || typeof manifest !== "object") return [];
  const entries = (manifest as { blockUsages?: unknown }).blockUsages;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const usage = entry as { blockId?: unknown; usageKey?: unknown };
    return typeof usage.blockId === "string" && typeof usage.usageKey === "string" ? [{ blockId: usage.blockId, usageKey: usage.usageKey }] : [];
  });
}
function manifestMediaIds(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const entries = (manifest as { referencedMediaIds?: unknown }).referencedMediaIds;
  return Array.isArray(entries) ? entries.filter((id): id is string => typeof id === "string") : [];
}
/** Historical pins so a restored page renders the Block Versions it was built against. */
function manifestPins(manifest: unknown) {
  if (!manifest || typeof manifest !== "object") return new Map<string, string>();
  const entries = (manifest as { blockUsages?: unknown }).blockUsages;
  if (!Array.isArray(entries)) return new Map<string, string>();
  const pins = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const usage = entry as { blockId?: unknown; usageKey?: unknown; versionId?: unknown };
    if (typeof usage.blockId === "string" && typeof usage.usageKey === "string" && typeof usage.versionId === "string") pins.set(`${usage.blockId}:${usage.usageKey}`, usage.versionId);
  }
  return pins;
}

/**
 * Re-validates every version a restore would activate against the state the project
 * will have *after* the restore. A historical version whose Media, routes, or Block
 * references no longer resolve is rejected before anything is written.
 */
export async function validateRestorePlan(transaction: TransactionLike, projectId: string, plan: RestorePlan) {
  const [pageRows, blockRows, mediaRows] = await Promise.all([
    transaction.select().from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))),
    transaction.select().from(buildingBlocks).where(eq(buildingBlocks.projectId, projectId)),
    transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt))),
  ]);
  const activeRoutes = new Set(pageRows.filter((node) => node.type === "page" && node.routePath).map((node) => node.routePath!));
  const approvedMediaIds = new Set(mediaRows.map(({ id }) => id));

  // Project the Building Block state the restore will produce.
  const projectedBlocks = new Map(blockRows.map((block) => [block.id, { versionId: block.currentVersionId, archived: Boolean(block.deletedAt) }]));
  for (const target of plan.blocks) {
    const current = projectedBlocks.get(target.blockId);
    if (!current) throw restoreInvalid("A Building Block in this restore no longer exists.", `missing block ${target.blockId}`);
    projectedBlocks.set(target.blockId, { versionId: target.versionId, archived: target.archived ?? current.archived });
  }
  const projectedVersionIds = [...projectedBlocks.values()].map(({ versionId }) => versionId).filter((id): id is string => Boolean(id));
  const blockVersionRows = projectedVersionIds.length
    ? await transaction.select().from(buildingBlockVersions).where(and(eq(buildingBlockVersions.projectId, projectId), inArray(buildingBlockVersions.id, projectedVersionIds)))
    : [];
  const blockVersionById = new Map(blockVersionRows.map((version) => [version.id, version]));
  const availableBlockIds = new Set<string>(); const blockSources = new Map<string, string>();
  for (const [blockId, projected] of projectedBlocks) {
    if (projected.archived || !projected.versionId) continue;
    const version = blockVersionById.get(projected.versionId);
    if (!version || version.buildingBlockId !== blockId) throw restoreInvalid("A Building Block version in this restore is no longer available.", `block ${blockId}`);
    availableBlockIds.add(blockId); blockSources.set(blockId, version.sourceCode);
  }

  for (const target of plan.blocks) {
    if (!target.versionId) continue;
    const version = blockVersionById.get(target.versionId);
    if (!version) throw restoreInvalid("A Building Block version in this restore is no longer available.", `version ${target.versionId}`);
    try {
      await validateGeneratedBlockSource({ sourceCode: version.sourceCode, approvedMediaIds, activeRoutes, declaredMediaIds: manifestMediaIds(version.manifest) });
    } catch (error) {
      throw restoreInvalid("This Building Block version can no longer be restored: it uses media or links that are no longer available.", error instanceof AIError ? error.diagnostic : undefined);
    }
  }

  const pageVersionIds = plan.pages.map(({ versionId }) => versionId).filter((id): id is string => Boolean(id));
  const pageVersionRows = pageVersionIds.length
    ? await transaction.select().from(pageVersions).where(and(eq(pageVersions.projectId, projectId), inArray(pageVersions.id, pageVersionIds)))
    : [];
  const pageVersionById = new Map(pageVersionRows.map((version) => [version.id, version]));
  for (const target of plan.pages) {
    if (!target.versionId) continue;
    const version = pageVersionById.get(target.versionId);
    if (!version || version.pageId !== target.pageId) throw restoreInvalid("A page version in this restore is no longer available.", `version ${target.versionId}`);
    try {
      await validateGeneratedPageSource({
        sourceCode: version.sourceCode, approvedMediaIds, activeRoutes,
        declaredMediaIds: manifestMediaIds(version.manifest), availableBlockIds,
        declaredBlockUsages: manifestUsages(version.manifest), blockSources,
      });
    } catch (error) {
      throw restoreInvalid("This page version can no longer be restored: it uses media, links, or Building Blocks that are no longer available.", error instanceof AIError ? error.diagnostic : undefined);
    }
  }
  return { pageVersionById, blockVersionById };
}

/**
 * Applies a validated plan. Blocks move first so pages reconcile their usages against
 * the Block Versions this restore activates.
 */
export async function applyRestorePlan(transaction: TransactionLike, projectId: string, plan: RestorePlan) {
  for (const target of plan.blocks) {
    const patch: Record<string, unknown> = { currentVersionId: target.versionId, updatedAt: new Date() };
    if (target.isGlobal !== undefined) patch.isGlobal = target.isGlobal;
    if (target.archived !== undefined) patch.deletedAt = target.archived ? new Date() : null;
    await transaction.update(buildingBlocks).set(patch).where(and(eq(buildingBlocks.id, target.blockId), eq(buildingBlocks.projectId, projectId)));
  }
  if (plan.project) {
    if (plan.project.currentInstructionId !== undefined) await transaction.update(projects).set({ currentInstructionId: plan.project.currentInstructionId, updatedAt: new Date() }).where(eq(projects.id, projectId));
    if (plan.project.theme) await transaction.update(projectThemeSettings).set({ ...plan.project.theme, revision: (await bumpedRevision(transaction, projectId, "theme")), updatedAt: new Date() }).where(eq(projectThemeSettings.projectId, projectId));
    if (plan.project.brand) await transaction.update(projectBrandSettings).set({ ...plan.project.brand, revision: (await bumpedRevision(transaction, projectId, "brand")), updatedAt: new Date() }).where(eq(projectBrandSettings.projectId, projectId));
  }
  for (const target of plan.pages) {
    await transaction.update(pageNodes).set({ currentVersionId: target.versionId, updatedAt: new Date() }).where(and(eq(pageNodes.id, target.pageId), eq(pageNodes.projectId, projectId)));
    const [version] = target.versionId ? await transaction.select().from(pageVersions).where(eq(pageVersions.id, target.versionId)).limit(1) : [];
    await reconcilePageBlockUsages(transaction, { projectId, pageId: target.pageId, usages: version ? manifestUsages(version.manifest) : [], restorePins: version ? manifestPins(version.manifest) : undefined });
  }
}

/** Settings rows are mutable, so a restore writes the snapshot forward with a new revision. */
async function bumpedRevision(transaction: TransactionLike, projectId: string, kind: "theme" | "brand") {
  if (kind === "theme") {
    const [row] = await transaction.select({ revision: projectThemeSettings.revision }).from(projectThemeSettings).where(eq(projectThemeSettings.projectId, projectId)).limit(1);
    return (row?.revision ?? 0) + 1;
  }
  const [row] = await transaction.select({ revision: projectBrandSettings.revision }).from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1);
  return (row?.revision ?? 0) + 1;
}
