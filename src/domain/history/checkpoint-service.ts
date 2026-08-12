import { z } from "zod";
import { and, desc, eq, isNull, sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlocks, pageNodes, projectBrandSettings, projectCheckpointItems, projectCheckpoints, projectThemeSettings, projects, users } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { projectIdSchema } from "@/domain/projects/schemas";
import { recordChangeSet, type TransactionLike } from "./change-set-service";
import { applyRestorePlan, validateRestorePlan, type RestorePlan } from "./restore-engine";
import { checkpointNotFound } from "./errors";

export const createCheckpointSchema = z.object({
  projectId: projectIdSchema,
  name: z.string().trim().min(1, "Name this checkpoint.").max(120, "Name must be 120 characters or fewer."),
});

const THEME_FIELDS = ["lightTokens", "darkTokens", "radiusScale", "spacingScale", "shadowScale", "fontScale", "borderScale"] as const;
const BRAND_FIELDS = ["companyName", "companyDescription", "brandNotes", "primaryLogoMediaId", "alternateLogoMediaId"] as const;
function pick<T extends object, K extends readonly (keyof T)[]>(source: T, keys: K) {
  return Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K[number]>;
}
function settingsOf(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : null; }

/**
 * Named, immutable snapshots of the project's active state. A checkpoint stores version
 * references and settings values, never copies of generated source.
 */
export class CheckpointService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  private async capture(transaction: TransactionLike, projectId: string) {
    const [pages, blocks, themeRows, brandRows, projectRows] = await Promise.all([
      transaction.select().from(pageNodes).where(eq(pageNodes.projectId, projectId)).orderBy(pageNodes.position),
      transaction.select().from(buildingBlocks).where(eq(buildingBlocks.projectId, projectId)).orderBy(buildingBlocks.name),
      transaction.select().from(projectThemeSettings).where(eq(projectThemeSettings.projectId, projectId)).limit(1),
      transaction.select().from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1),
      transaction.select().from(projects).where(eq(projects.id, projectId)).limit(1),
    ]);
    const theme = themeRows[0] ? { ...pick(themeRows[0], THEME_FIELDS), revision: themeRows[0].revision } : null;
    const brand = brandRows[0] ? { ...pick(brandRows[0], BRAND_FIELDS), revision: brandRows[0].revision } : null;
    return {
      pages, blocks, theme, brand,
      currentInstructionId: projectRows[0]?.currentInstructionId ?? null,
      // The page tree is captured for deterministic auditing of what the project looked like.
      pageTree: pages.map((node) => ({ id: node.id, parentId: node.parentId, type: node.type, name: node.name, slug: node.slug, routePath: node.routePath, position: node.position, isHomepage: node.isHomepage, pageTitle: node.pageTitle, metaDescription: node.metaDescription, archived: Boolean(node.deletedAt) })),
    };
  }

  async create(userId: string, input: unknown) {
    const parsed = createCheckpointSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${parsed.projectId}))`);
      const captured = await this.capture(transaction, parsed.projectId);
      const [checkpoint] = await transaction.insert(projectCheckpoints).values({
        projectId: parsed.projectId, name: parsed.name, createdByUserId: userId,
        projectState: { schemaVersion: 1, capturedAt: new Date().toISOString(), currentInstructionId: captured.currentInstructionId, theme: captured.theme, brand: captured.brand, pageTree: captured.pageTree, pageCount: captured.pages.length, blockCount: captured.blocks.length },
      }).returning();
      if (!checkpoint) throw new Error("Checkpoint insert did not return a record.");
      const items = [
        ...captured.pages.map((node) => ({ entityType: "page" as const, entityId: node.id, versionId: node.currentVersionId, entityState: { name: node.name, routePath: node.routePath, archived: Boolean(node.deletedAt) } })),
        ...captured.blocks.map((block) => ({ entityType: "building_block" as const, entityId: block.id, versionId: block.currentVersionId, entityState: { name: block.name, isGlobal: block.isGlobal, archived: Boolean(block.deletedAt) } })),
        { entityType: "project" as const, entityId: null, versionId: null, entityState: { currentInstructionId: captured.currentInstructionId, theme: captured.theme, brand: captured.brand } },
      ];
      await transaction.insert(projectCheckpointItems).values(items.map((item, position) => ({ ...item, checkpointId: checkpoint.id, projectId: parsed.projectId, position })));
      console.info(JSON.stringify({ event: "history.checkpoint_created", projectId: parsed.projectId, checkpointId: checkpoint.id, itemCount: items.length }));
      return checkpoint;
    });
  }

  async list(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const rows = await this.database.select({ checkpoint: projectCheckpoints, actor: users.displayName })
      .from(projectCheckpoints).innerJoin(users, eq(users.id, projectCheckpoints.createdByUserId))
      .where(eq(projectCheckpoints.projectId, projectId))
      .orderBy(desc(projectCheckpoints.createdAt)).limit(50);
    return rows.map(({ checkpoint, actor }) => {
      const state = settingsOf(checkpoint.projectState);
      return { id: checkpoint.id, name: checkpoint.name, actor, createdAt: checkpoint.createdAt, pageCount: Number(state?.pageCount ?? 0), blockCount: Number(state?.blockCount ?? 0) };
    });
  }

  /**
   * Moves the project's active references back to the snapshot. Entities created after
   * the checkpoint are left untouched, and every version ever created is preserved.
   */
  async restore(userId: string, projectId: string, checkpointId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const [checkpoint] = await transaction.select().from(projectCheckpoints).where(and(eq(projectCheckpoints.id, checkpointId), eq(projectCheckpoints.projectId, projectId))).limit(1);
      if (!checkpoint) throw checkpointNotFound();
      const items = await transaction.select().from(projectCheckpointItems).where(and(eq(projectCheckpointItems.checkpointId, checkpointId), eq(projectCheckpointItems.projectId, projectId))).orderBy(projectCheckpointItems.position);

      const [pages, blocks, themeRows, brandRows, projectRows] = await Promise.all([
        transaction.select().from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))),
        transaction.select().from(buildingBlocks).where(eq(buildingBlocks.projectId, projectId)),
        transaction.select().from(projectThemeSettings).where(eq(projectThemeSettings.projectId, projectId)).limit(1),
        transaction.select().from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1),
        transaction.select().from(projects).where(eq(projects.id, projectId)).limit(1),
      ]);
      const pageById = new Map(pages.map((node) => [node.id, node]));
      const blockById = new Map(blocks.map((block) => [block.id, block]));

      const plan: RestorePlan = { pages: [], blocks: [] };
      const changeItems: Array<{ entityType: "page" | "building_block" | "project"; entityId: string | null; beforeVersionId?: string | null; afterVersionId?: string | null; beforeState?: unknown; afterState?: unknown }> = [];
      const skipped: string[] = [];

      for (const item of items) {
        if (item.entityType === "page" && item.entityId) {
          const page = pageById.get(item.entityId);
          // Pages deleted or created after the checkpoint are left exactly as they are.
          if (!page) { skipped.push(settingsOf(item.entityState)?.name as string ?? "A page"); continue; }
          if (page.currentVersionId === item.versionId) continue;
          plan.pages.push({ pageId: page.id, versionId: item.versionId });
          changeItems.push({ entityType: "page", entityId: page.id, beforeVersionId: page.currentVersionId, afterVersionId: item.versionId });
        } else if (item.entityType === "building_block" && item.entityId) {
          const block = blockById.get(item.entityId);
          if (!block) { skipped.push(settingsOf(item.entityState)?.name as string ?? "A Building Block"); continue; }
          const state = settingsOf(item.entityState);
          const isGlobal = typeof state?.isGlobal === "boolean" ? state.isGlobal : block.isGlobal;
          const archived = typeof state?.archived === "boolean" ? state.archived : Boolean(block.deletedAt);
          if (block.currentVersionId === item.versionId && block.isGlobal === isGlobal && Boolean(block.deletedAt) === archived) continue;
          plan.blocks.push({ blockId: block.id, versionId: item.versionId, isGlobal, archived });
          changeItems.push({ entityType: "building_block", entityId: block.id, beforeVersionId: block.currentVersionId, afterVersionId: item.versionId, beforeState: { isGlobal: block.isGlobal, archived: Boolean(block.deletedAt) }, afterState: { isGlobal, archived } });
        } else if (item.entityType === "project") {
          const state = settingsOf(item.entityState);
          if (!state) continue;
          const theme = settingsOf(state.theme); const brand = settingsOf(state.brand);
          plan.project = {
            currentInstructionId: (state.currentInstructionId ?? null) as string | null,
            ...(theme ? { theme: pick(theme as Record<string, unknown> & Record<typeof THEME_FIELDS[number], unknown>, THEME_FIELDS) } : {}),
            ...(brand ? { brand: pick(brand as Record<string, unknown> & Record<typeof BRAND_FIELDS[number], unknown>, BRAND_FIELDS) } : {}),
          };
          const currentTheme = themeRows[0]; const currentBrand = brandRows[0];
          changeItems.push({
            entityType: "project", entityId: null,
            beforeState: {
              currentInstructionId: projectRows[0]?.currentInstructionId ?? null,
              ...(currentTheme ? { theme: { ...pick(currentTheme, THEME_FIELDS), revision: currentTheme.revision } } : {}),
              ...(currentBrand ? { brand: { ...pick(currentBrand, BRAND_FIELDS), revision: currentBrand.revision } } : {}),
            },
            // Applying a settings snapshot bumps the revision, so the recorded `after`
            // matches what an Undo will expect to find.
            afterState: {
              currentInstructionId: (state.currentInstructionId ?? null) as string | null,
              ...(theme && currentTheme ? { theme: { ...pick(theme as never, THEME_FIELDS), revision: currentTheme.revision + 1 } } : {}),
              ...(brand && currentBrand ? { brand: { ...pick(brand as never, BRAND_FIELDS), revision: currentBrand.revision + 1 } } : {}),
            },
          });
        }
      }

      await validateRestorePlan(transaction, projectId, plan);
      await applyRestorePlan(transaction, projectId, plan);
      const changeSet = await recordChangeSet(transaction, {
        projectId, actorUserId: userId, operation: "checkpoint_restore",
        summary: `Restored checkpoint “${checkpoint.name}”`, items: changeItems,
      });
      console.info(JSON.stringify({ event: "history.checkpoint_restored", projectId, checkpointId, changeSetId: changeSet.id, pages: plan.pages.length, blocks: plan.blocks.length, skipped: skipped.length }));
      return { changeSet, checkpoint, restored: { pages: plan.pages.length, blocks: plan.blocks.length }, skipped };
    });
  }
}
