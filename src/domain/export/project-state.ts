import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlockUsages, buildingBlockVersions, buildingBlocks, mediaAssets, pageNodes, pageVersions, projectBrandSettings, projectThemeSettings, projects } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";
import { DEFAULT_THEME } from "@/domain/theme/defaults";
import { themeSettingsSchema } from "@/domain/theme/schemas";
import { resolveProjectDesignTokens } from "@/domain/theme/resolver";

export type ResolvedUsage = { blockId: string; usageKey: string; versionId: string; isGlobal: boolean };
export type ExportPage = { node: typeof pageNodes.$inferSelect; route: string; version: typeof pageVersions.$inferSelect | null; usages: ResolvedUsage[] };
export type ExportProjectState = Awaited<ReturnType<typeof loadExportState>>;

function manifestList(manifest: unknown, key: "referencedMediaIds" | "internalRoutes") {
  if (!manifest || typeof manifest !== "object") return [] as string[];
  const value = (manifest as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Snapshot of the project's active state used by both export validation and assembly:
 * active page versions, the Block Version each usage actually resolves to, media, and
 * theme tokens. Global usages follow the block's current version; non-global usages
 * keep the version the active Page Version was built against.
 */
export async function loadExportState(projectId: string, database: Database = db) {
  const [projectRows, nodes, blocks, usageRows, media, themeRows, brandRows] = await Promise.all([
    database.select().from(projects).where(eq(projects.id, projectId)).limit(1),
    database.select().from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))).orderBy(pageNodes.position),
    database.select().from(buildingBlocks).where(eq(buildingBlocks.projectId, projectId)),
    database.select().from(buildingBlockUsages).where(eq(buildingBlockUsages.projectId, projectId)),
    database.select().from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt))),
    database.select().from(projectThemeSettings).where(eq(projectThemeSettings.projectId, projectId)).limit(1),
    database.select().from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1),
  ]);
  const project = projectRows[0];
  if (!project) throw new DomainError("NOT_FOUND", "Project not found.");

  const pageVersionRows = await database.select().from(pageVersions).where(eq(pageVersions.projectId, projectId));
  const blockVersionRows = await database.select().from(buildingBlockVersions).where(eq(buildingBlockVersions.projectId, projectId));
  const pageVersionById = new Map(pageVersionRows.map((version) => [version.id, version]));
  const blockVersionById = new Map(blockVersionRows.map((version) => [version.id, version]));
  const blockById = new Map(blocks.map((block) => [block.id, block]));

  const usagesByPage = new Map<string, ResolvedUsage[]>();
  for (const usage of usageRows) {
    const block = blockById.get(usage.buildingBlockId);
    if (!block) continue;
    const versionId = block.isGlobal ? block.currentVersionId : usage.buildingBlockVersionId ?? block.currentVersionId;
    if (!versionId) continue;
    const list = usagesByPage.get(usage.pageId) ?? [];
    list.push({ blockId: block.id, usageKey: usage.usageKey, versionId, isGlobal: block.isGlobal });
    usagesByPage.set(usage.pageId, list);
  }

  const pages: ExportPage[] = nodes
    .filter((node) => node.type === "page" && node.routePath)
    .map((node) => ({ node, route: node.routePath!, version: node.currentVersionId ? pageVersionById.get(node.currentVersionId) ?? null : null, usages: usagesByPage.get(node.id) ?? [] }));

  const parsedTheme = themeRows[0] ? themeSettingsSchema.safeParse(themeRows[0]) : null;
  const theme = resolveProjectDesignTokens(parsedTheme?.success ? parsedTheme.data : DEFAULT_THEME);

  return {
    project, nodes, pages, blocks, blockById, blockVersionById, usageRows,
    media: new Map(media.map((asset) => [asset.id, asset])),
    brand: brandRows[0] ?? null,
    theme,
    /** Media and internal routes referenced by everything the export will contain. */
    referencedMediaIds: (versionIds: string[]) => new Set(versionIds.flatMap((id) => manifestList(pageVersionById.get(id)?.manifest ?? blockVersionById.get(id)?.manifest, "referencedMediaIds"))),
    internalRoutes: (versionIds: string[]) => new Set(versionIds.flatMap((id) => manifestList(pageVersionById.get(id)?.manifest ?? blockVersionById.get(id)?.manifest, "internalRoutes"))),
  };
}

export { manifestList };
