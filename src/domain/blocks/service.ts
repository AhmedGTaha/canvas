import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { auditEvents, buildingBlockUsages, buildingBlockVersions, buildingBlocks, generationJobs, pageNodes } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { BuildingBlockRepository } from "./repository";
import { duplicateBlockManifest, duplicateBlockName } from "./duplication";
import { blockDeleted, blockGenerationActive, blockGlobalConversionFailed, blockInUse, blockNotFound, blockUsageNotFound } from "./errors";
import { createBlockSchema, blockReferenceSchema, listBlocksSchema, setBlockGlobalSchema, setUsageResolutionSchema, updateBlockSchema } from "./schemas";
import { recordChangeSet } from "@/domain/history/change-set-service";

const ACTIVE_JOB_STATUSES = ["queued", "preparing_context", "generating", "validating", "applying"] as const;

export class BuildingBlockService {
  constructor(
    private readonly database: Database = db,
    private readonly access = new ProjectAccessService(),
    private readonly repository = new BuildingBlockRepository(database),
  ) {}

  async list(userId: string, input: unknown) {
    const parsed = listBlocksSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const rows = await this.repository.listActive(parsed.projectId);
    const counts = await this.repository.usageCounts(parsed.projectId, rows.map(({ block }) => block.id));
    const search = parsed.search?.toLowerCase();
    return rows
      .filter(({ block }) => !search || block.name.toLowerCase().includes(search) || block.kind.includes(search))
      .map(({ block, version }) => ({
        ...block,
        contentStatus: block.currentVersionId ? "generated" as const : "unbuilt" as const,
        currentVersionNumber: version?.versionNumber ?? null,
        usageCount: counts.get(block.id) ?? 0,
      }));
  }

  /** Loads a block plus its active version after verifying project membership. */
  async read(userId: string, projectId: string, blockId: string) {
    const parsed = blockReferenceSchema.parse({ projectId, blockId });
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const row = await this.repository.find(parsed.projectId, parsed.blockId, { includeArchived: true });
    if (!row) throw blockNotFound();
    if (row.block.deletedAt) throw blockDeleted();
    return row;
  }

  async listUsages(userId: string, projectId: string, blockId: string) {
    const { block } = await this.read(userId, projectId, blockId);
    const rows = await this.repository.listUsages(projectId, block.id);
    return rows.map(({ usage, page }) => ({
      usageKey: usage.usageKey,
      pageId: page.id,
      pageName: page.name,
      route: page.routePath,
      pinnedVersionId: usage.buildingBlockVersionId,
      resolution: usage.buildingBlockVersionId ? "pinned" as const : "global" as const,
    }));
  }

  async create(userId: string, input: unknown) {
    const parsed = createBlockSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const [block] = await this.database.insert(buildingBlocks).values({
      projectId: parsed.projectId, name: parsed.name, kind: parsed.kind, isGlobal: parsed.isGlobal, createdByUserId: userId,
    }).returning();
    if (!block) throw new Error("Building Block insert did not return a record.");
    await this.database.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "block.created", entityType: "building_block", entityId: block.id, metadata: { kind: block.kind, isGlobal: block.isGlobal } });
    return block;
  }

  async update(userId: string, input: unknown) {
    const parsed = updateBlockSchema.parse(input);
    const { block } = await this.read(userId, parsed.projectId, parsed.blockId);
    if (parsed.name === undefined && parsed.kind === undefined) return block;
    const [updated] = await this.database.update(buildingBlocks)
      .set({ name: parsed.name ?? block.name, kind: parsed.kind ?? block.kind, updatedAt: new Date() })
      .where(and(eq(buildingBlocks.id, block.id), eq(buildingBlocks.projectId, parsed.projectId))).returning();
    if (!updated) throw blockNotFound();
    await this.database.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "block.updated", entityType: "building_block", entityId: block.id });
    return updated;
  }

  /**
   * Global status changes reference semantics, so existing usages are re-pinned in the
   * same transaction: global usages resolve the shared active version, and usages of a
   * block that stops being global keep rendering the version they render today.
   */
  async setGlobal(userId: string, input: unknown) {
    const parsed = setBlockGlobalSchema.parse(input);
    const { block } = await this.read(userId, parsed.projectId, parsed.blockId);
    if (block.isGlobal === parsed.isGlobal) return block;
    return this.database.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, block.id), eq(buildingBlocks.projectId, parsed.projectId), isNull(buildingBlocks.deletedAt))).for("update");
      if (!locked) throw blockNotFound();
      const usages = await transaction.select({ usage: buildingBlockUsages }).from(buildingBlockUsages)
        .innerJoin(pageNodes, and(eq(pageNodes.id, buildingBlockUsages.pageId), eq(pageNodes.projectId, buildingBlockUsages.projectId)))
        .where(and(eq(buildingBlockUsages.projectId, parsed.projectId), eq(buildingBlockUsages.buildingBlockId, locked.id), isNull(pageNodes.deletedAt)));
      if (parsed.isGlobal) {
        if (usages.length && !locked.currentVersionId) throw blockGlobalConversionFailed("Create this Building Block with Canvas before sharing it across pages.");
        await transaction.update(buildingBlockUsages).set({ buildingBlockVersionId: null })
          .where(and(eq(buildingBlockUsages.projectId, parsed.projectId), eq(buildingBlockUsages.buildingBlockId, locked.id)));
      } else {
        const unpinned = usages.filter(({ usage }) => !usage.buildingBlockVersionId);
        if (unpinned.length && !locked.currentVersionId) throw blockGlobalConversionFailed("This Building Block has no active version to keep its pages rendering.");
        if (unpinned.length) {
          await transaction.update(buildingBlockUsages).set({ buildingBlockVersionId: locked.currentVersionId })
            .where(and(eq(buildingBlockUsages.projectId, parsed.projectId), eq(buildingBlockUsages.buildingBlockId, locked.id), isNull(buildingBlockUsages.buildingBlockVersionId)));
        }
      }
      const [updated] = await transaction.update(buildingBlocks).set({ isGlobal: parsed.isGlobal, updatedAt: new Date() }).where(eq(buildingBlocks.id, locked.id)).returning();
      if (!updated) throw blockNotFound();
      await recordChangeSet(transaction, {
        projectId: parsed.projectId, actorUserId: userId, operation: "block_global_toggle",
        summary: `${locked.name}: ${parsed.isGlobal ? "shared across pages" : "no longer shared"}`,
        items: [{ entityType: "building_block", entityId: locked.id, beforeVersionId: locked.currentVersionId, afterVersionId: locked.currentVersionId, beforeState: { isGlobal: locked.isGlobal, archived: Boolean(locked.deletedAt) }, afterState: { isGlobal: parsed.isGlobal, archived: Boolean(locked.deletedAt) } }],
      });
      await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: parsed.isGlobal ? "block.made_global" : "block.made_local", entityType: "building_block", entityId: locked.id, metadata: { usageCount: usages.length } });
      return updated;
    });
  }

  /**
   * Attaches or detaches a single page's copy of a Building Block.
   *
   * The same mutation the global toggle performs in bulk, scoped to one usage
   * row: "global" clears the pin so the page follows the block's active version,
   * "pinned" freezes it at the version the block is on today. The guards match
   * the bulk toggle exactly — either direction needs an active version to point
   * at or resolve, or the page would render nothing where the section was.
   *
   * A page is identified by id and usage key together, because usage keys are
   * only unique within a page: updating by key alone would detach every page
   * using the block under the same key.
   */
  async setUsageResolution(userId: string, input: unknown) {
    const parsed = setUsageResolutionSchema.parse(input);
    const { block } = await this.read(userId, parsed.projectId, parsed.blockId);
    return this.database.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(buildingBlocks)
        .where(and(eq(buildingBlocks.id, block.id), eq(buildingBlocks.projectId, parsed.projectId), isNull(buildingBlocks.deletedAt))).for("update");
      if (!locked) throw blockNotFound();

      const [row] = await transaction.select({ usage: buildingBlockUsages, page: pageNodes })
        .from(buildingBlockUsages)
        .innerJoin(pageNodes, and(eq(pageNodes.id, buildingBlockUsages.pageId), eq(pageNodes.projectId, buildingBlockUsages.projectId)))
        .where(and(
          eq(buildingBlockUsages.projectId, parsed.projectId),
          eq(buildingBlockUsages.buildingBlockId, locked.id),
          eq(buildingBlockUsages.pageId, parsed.pageId),
          eq(buildingBlockUsages.usageKey, parsed.usageKey),
          isNull(pageNodes.deletedAt),
        ));
      if (!row) throw blockUsageNotFound();

      const before = row.usage.buildingBlockVersionId ? "pinned" as const : "global" as const;
      if (before === parsed.resolution) return { usageKey: row.usage.usageKey, pageId: row.page.id, resolution: before };
      if (!locked.currentVersionId) {
        throw blockGlobalConversionFailed(parsed.resolution === "global"
          ? "Create this Building Block with Canvas before a page can follow it."
          : "This Building Block has no active version to keep this page rendering.");
      }
      const versionId = parsed.resolution === "global" ? null : locked.currentVersionId;
      await transaction.update(buildingBlockUsages).set({ buildingBlockVersionId: versionId })
        .where(and(eq(buildingBlockUsages.id, row.usage.id), eq(buildingBlockUsages.projectId, parsed.projectId)));

      await recordChangeSet(transaction, {
        projectId: parsed.projectId, actorUserId: userId, operation: "block_usage_resolution",
        summary: `${locked.name} on ${row.page.name}: ${parsed.resolution === "global" ? "follows the shared section" : "frozen at the current version"}`,
        items: [{
          entityType: "building_block", entityId: locked.id,
          beforeVersionId: row.usage.buildingBlockVersionId, afterVersionId: versionId,
          beforeState: { pageId: row.page.id, usageKey: row.usage.usageKey, resolution: before },
          afterState: { pageId: row.page.id, usageKey: row.usage.usageKey, resolution: parsed.resolution },
        }],
      });
      await transaction.insert(auditEvents).values({
        projectId: parsed.projectId, userId,
        action: parsed.resolution === "global" ? "block.usage_attached" : "block.usage_detached",
        entityType: "building_block", entityId: locked.id,
        metadata: { pageId: row.page.id, usageKey: row.usage.usageKey },
      });
      return { usageKey: row.usage.usageKey, pageId: row.page.id, resolution: parsed.resolution };
    });
  }

  /**
   * Creates an independent block with its own initial immutable version. The copy never
   * points at the source block's version records and its history stays separate.
   */
  async duplicate(userId: string, input: unknown) {
    const parsed = blockReferenceSchema.parse(input);
    const { block, version } = await this.read(userId, parsed.projectId, parsed.blockId);
    return this.database.transaction(async (transaction) => {
      const existing = await transaction.select({ name: buildingBlocks.name }).from(buildingBlocks).where(and(eq(buildingBlocks.projectId, parsed.projectId), isNull(buildingBlocks.deletedAt)));
      const [copy] = await transaction.insert(buildingBlocks).values({
        projectId: parsed.projectId, name: duplicateBlockName(block.name, existing.map((item) => item.name)),
        kind: block.kind, isGlobal: block.isGlobal, createdByUserId: userId,
      }).returning();
      if (!copy) throw new Error("Building Block duplication did not return a record.");
      if (version) {
        const [copiedVersion] = await transaction.insert(buildingBlockVersions).values({
          projectId: parsed.projectId, buildingBlockId: copy.id, versionNumber: 1, sourceCode: version.sourceCode,
          manifest: duplicateBlockManifest({ ...(version.manifest as object), id: version.id }),
          changeSummary: { headline: `Duplicated from ${block.name}`, changes: [], limitations: [] },
          sourceHash: version.sourceHash, createdByUserId: userId,
        }).returning();
        if (!copiedVersion) throw new Error("Building Block version duplication did not return a record.");
        await transaction.update(buildingBlocks).set({ currentVersionId: copiedVersion.id, updatedAt: new Date() }).where(eq(buildingBlocks.id, copy.id));
        copy.currentVersionId = copiedVersion.id;
      }
      await recordChangeSet(transaction, {
        projectId: parsed.projectId, actorUserId: userId, operation: "block_duplicate", summary: `Duplicated ${block.name} as ${copy.name}`,
        items: [{ entityType: "building_block", entityId: copy.id, beforeVersionId: null, afterVersionId: copy.currentVersionId, afterState: { isGlobal: copy.isGlobal, archived: false } }],
      });
      await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "block.duplicated", entityType: "building_block", entityId: copy.id, metadata: { sourceBlockId: block.id } });
      return copy;
    });
  }

  /**
   * Soft deletion. Blocks still referenced by an active page are rejected so a
   * successful archive can never leave a page with a broken Block reference.
   */
  async archive(userId: string, input: unknown) {
    const parsed = blockReferenceSchema.parse(input);
    const { block } = await this.read(userId, parsed.projectId, parsed.blockId);
    return this.database.transaction(async (transaction) => {
      const [locked] = await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, block.id), eq(buildingBlocks.projectId, parsed.projectId), isNull(buildingBlocks.deletedAt))).for("update");
      if (!locked) throw blockNotFound();
      const [active] = await transaction.select({ id: generationJobs.id }).from(generationJobs)
        .where(and(eq(generationJobs.projectId, parsed.projectId), eq(generationJobs.targetId, locked.id), inArray(generationJobs.operation, ["block_generate", "block_modify"]), inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES]))).limit(1);
      if (active) throw blockGenerationActive();
      const usages = await transaction.select({ pageId: buildingBlockUsages.pageId }).from(buildingBlockUsages)
        .innerJoin(pageNodes, and(eq(pageNodes.id, buildingBlockUsages.pageId), eq(pageNodes.projectId, buildingBlockUsages.projectId)))
        .where(and(eq(buildingBlockUsages.projectId, parsed.projectId), eq(buildingBlockUsages.buildingBlockId, locked.id), isNull(pageNodes.deletedAt)));
      if (usages.length) throw blockInUse(new Set(usages.map((usage) => usage.pageId)).size);
      const now = new Date();
      const [archived] = await transaction.update(buildingBlocks).set({ deletedAt: now, updatedAt: now }).where(eq(buildingBlocks.id, locked.id)).returning();
      await recordChangeSet(transaction, {
        projectId: parsed.projectId, actorUserId: userId, operation: "block_archive", summary: `Archived ${locked.name}`,
        items: [{ entityType: "building_block", entityId: locked.id, beforeVersionId: locked.currentVersionId, afterVersionId: locked.currentVersionId, beforeState: { isGlobal: locked.isGlobal, archived: false }, afterState: { isGlobal: locked.isGlobal, archived: true } }],
      });
      await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "block.archived", entityType: "building_block", entityId: locked.id });
      return archived!;
    });
  }

  /** Active block/version state used by the AI context builder and Preview manifest. */
  async listForContext(projectId: string) {
    const rows = await this.repository.listActive(projectId);
    return rows.map(({ block, version }) => ({
      id: block.id, name: block.name, kind: block.kind, isGlobal: block.isGlobal,
      currentVersionId: block.currentVersionId, versionNumber: version?.versionNumber ?? null,
      manifest: version?.manifest ?? null, sourceCode: version?.sourceCode ?? null, updatedAt: block.updatedAt,
    }));
  }

  async latestJob(projectId: string, blockId: string) {
    const [job] = await this.database.select().from(generationJobs)
      .where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.targetId, blockId), inArray(generationJobs.operation, ["block_generate", "block_modify"])))
      .orderBy(desc(generationJobs.createdAt)).limit(1);
    return job ?? null;
  }
}
