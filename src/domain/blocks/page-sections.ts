import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Database } from "@/server/db/client";
import { auditEvents, buildingBlocks, buildingBlockVersions, mediaAssets, pageNodes, pageVersions } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { EditingLeaseService } from "@/domain/collaboration/lease-service";
import { DomainError } from "@/domain/shared/errors";
import { recordChangeSet } from "@/domain/history/change-set-service";
import { projectIdSchema } from "@/domain/projects/schemas";
import { validateGeneratedPageDocument } from "@/domain/page-generation/validator";
import { emptyDocument, type GeneratedDocument } from "@/domain/generated-source/document";
import { requireVersionDocument, versionDocument } from "@/domain/generated-source/stored-version";
import { reconcilePageBlockUsages } from "./usages";
import { existingUsageKeys, insertBlockUsageIntoSource, PageSourceEditError, removeBlockUsageFromSource, usageKeyFor } from "./page-sections-source";
import { blockNotFound, blockNotGenerated } from "./errors";
import { StarterSectionService } from "./starter-library/service";

const placementSchema = z.discriminatedUnion("position", [
  z.object({ position: z.literal("top") }),
  z.object({ position: z.literal("bottom") }),
  z.object({ position: z.literal("before"), anchor: z.string().min(1).max(80) }),
  z.object({ position: z.literal("after"), anchor: z.string().min(1).max(80) }),
]);

/**
 * Either an existing project section by id, or a built-in starter by catalog id — in
 * which case the block is created and attached in the same transaction, so a failure to
 * attach can never leave an unasked-for block behind in the library.
 */
export const addSectionSchema = z.object({
  projectId: projectIdSchema,
  pageId: z.uuid(),
  blockId: z.uuid().optional(),
  starterId: z.string().trim().min(1).max(80).optional(),
  placement: placementSchema.default({ position: "bottom" }),
}).strict().refine((value) => Boolean(value.blockId) !== Boolean(value.starterId), {
  message: "Choose either an existing section or one from the Canvas library.",
});

export const removeSectionSchema = z.object({
  projectId: projectIdSchema,
  pageId: z.uuid(),
  usageKey: z.string().min(1).max(80),
}).strict();

/**
 * The document a page that has never been built starts from.
 *
 * Deliberately the smallest thing the validator accepts: one `c-page` wrapper carrying a
 * Canvas element id and nothing else, so the first section someone adds is the first
 * thing on the page rather than competing with placeholder content.
 */
const EMPTY_PAGE_DOCUMENT: GeneratedDocument = {
  ...emptyDocument(),
  html: `<div class="c-page" data-canvas-id="page-root" data-canvas-label="Page"></div>`,
  metadata: { title: null, description: null },
};

/**
 * Composing a page out of reusable sections.
 *
 * Adding or removing a section is an ordinary page edit, so it takes the ordinary page
 * edit path: a new immutable Page Version, activated in one transaction with the usage
 * rows it implies and the Change Set that makes it undoable. Nothing here mutates a
 * historical version, and nothing here deletes a Building Block — removing a section
 * removes the page's *reference* to it, which is why the block stays in the library and
 * every other page that uses it is unaffected.
 *
 * The edited markup goes through the same validator as generated output, so a
 * composition edit can never store something the Preview or the export would reject.
 */
export class PageSectionService {
  constructor(
    private readonly database: Database = db,
    private readonly access = new ProjectAccessService(),
    private readonly leases = new EditingLeaseService(),
    private readonly starters = new StarterSectionService(database),
  ) {}

  async addSection(userId: string, input: unknown) {
    const parsed = addSectionSchema.parse(input);
    return this.edit(userId, parsed.projectId, parsed.pageId, async (page, document, transaction) => {
      const block = parsed.starterId
        ? await this.starters.createWithin(transaction, userId, { projectId: parsed.projectId, starterId: parsed.starterId })
        : (await transaction.select().from(buildingBlocks)
            .where(and(eq(buildingBlocks.id, parsed.blockId!), eq(buildingBlocks.projectId, parsed.projectId), isNull(buildingBlocks.deletedAt))).limit(1))[0];
      if (!block) throw blockNotFound();
      if (!block.currentVersionId) throw blockNotGenerated();
      const usageKey = usageKeyFor(block.name, existingUsageKeys(document.html));
      const html = insertBlockUsageIntoSource(document.html, { blockId: block.id, usageKey, placement: parsed.placement });
      return {
        document: { ...document, html },
        operation: "page_section_add" as const,
        summary: `${page.name}: added ${block.name}`,
        audit: { action: "page.section_added", metadata: { pageId: page.id, blockId: block.id, usageKey, placement: parsed.placement.position } },
        result: { usageKey, blockId: block.id },
      };
    });
  }

  async removeSection(userId: string, input: unknown) {
    const parsed = removeSectionSchema.parse(input);
    return this.edit(userId, parsed.projectId, parsed.pageId, async (page, document) => {
      const usages = existingUsageKeys(document.html);
      if (!usages.includes(parsed.usageKey)) throw new DomainError("NOT_FOUND", "That section is not on this page.");
      const html = removeBlockUsageFromSource(document.html, parsed.usageKey);
      return {
        document: { ...document, html },
        operation: "page_section_remove" as const,
        summary: `${page.name}: removed the ${parsed.usageKey} section`,
        audit: { action: "page.section_removed", metadata: { pageId: page.id, usageKey: parsed.usageKey } },
        result: { usageKey: parsed.usageKey },
      };
    });
  }

  /**
   * The shared commit path.
   *
   * An editing lease is taken for the duration so a composition edit and an AI
   * generation cannot both activate a version on the same page, and the base version is
   * re-checked under a row lock inside the transaction so a concurrent commit is a
   * conflict rather than a lost edit.
   */
  private async edit<R extends Record<string, unknown>>(
    userId: string,
    projectId: string,
    pageId: string,
    plan: (page: typeof pageNodes.$inferSelect, document: GeneratedDocument, transaction: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<{
      document: GeneratedDocument;
      operation: "page_section_add" | "page_section_remove";
      summary: string;
      audit: { action: string; metadata: Record<string, unknown> };
      result: R;
    }>,
  ): Promise<R & { pageId: string; pageVersionId: string; versionNumber: number; changeSetId: string }> {
    await this.access.requireProjectAccess(userId, projectId);
    const leaseTarget = { projectId, targetType: "page" as const, targetId: pageId };
    try { await this.leases.acquire(userId, leaseTarget); }
    catch (error) {
      if (error instanceof DomainError && error.code === "CONFLICT") throw new DomainError("CONFLICT", "This page is currently being updated by another collaborator.");
      throw error;
    }
    try {
      return await this.database.transaction(async (transaction) => {
        const [page] = await transaction.select().from(pageNodes)
          .where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).for("update");
        if (!page) throw new DomainError("NOT_FOUND", "Page not found.");
        /*
         * A page nobody has built yet still has a shape: an empty document. Starting
         * from that shell is what lets someone begin a page with a navbar and a footer
         * before asking the agent for anything, which is the normal way to compose a
         * site out of shared sections. It is not a special case downstream — the shell
         * goes through the same validator, the same usage reconciliation, and the same
         * Change Set as any other version, and Undo returns the page to unbuilt.
         */
        let document = EMPTY_PAGE_DOCUMENT;
        if (page.currentVersionId) {
          const [active] = await transaction.select().from(pageVersions)
            .where(and(eq(pageVersions.id, page.currentVersionId), eq(pageVersions.projectId, projectId), eq(pageVersions.pageId, page.id))).limit(1);
          if (!active) throw new DomainError("NOT_FOUND", "This page has no active version.");
          // A Version from before the static-document format has no markup to edit, so
          // composition is refused with the same explanation the Preview gives.
          document = requireVersionDocument(active);
        }

        const planned = await plan(page, document, transaction).catch((error: unknown) => {
          if (error instanceof PageSourceEditError) throw new DomainError(error.reason === "usage-not-found" || error.reason === "anchor-not-found" ? "NOT_FOUND" : "VALIDATION", error.message);
          throw error;
        });

        const scope = await this.validationScope(transaction, projectId);
        // Read through the transaction: a starter created a moment ago in this same
        // transaction is not visible through the pool.
        let validated;
        try {
          validated = validateGeneratedPageDocument({
            document: planned.document,
            approvedMediaIds: scope.approvedMediaIds,
            activeRoutes: scope.activeRoutes,
            availableBlockIds: scope.availableBlockIds,
          });
        } catch (error: unknown) {
          // The shared validator speaks to the agent ("try a simpler request"), which is
          // the wrong advice here: nobody wrote this markup by hand. Report what actually
          // failed, which for a composition edit is always something concrete.
          const detail = (error as { diagnostic?: string }).diagnostic;
          throw new DomainError("VALIDATION", detail ? `The page could not be rebuilt with that change: ${detail}` : "The page could not be rebuilt with that change.");
        }
        const { manifest } = validated;

        // Usage rows and the activated version are written together, exactly as a
        // generation commit does, so page state and usage state cannot disagree.
        const resolved = await reconcilePageBlockUsages(transaction, { projectId, pageId: page.id, usages: manifest.blockUsages });
        const [latest] = await transaction.select({ versionNumber: pageVersions.versionNumber }).from(pageVersions)
          .where(and(eq(pageVersions.projectId, projectId), eq(pageVersions.pageId, page.id))).orderBy(desc(pageVersions.versionNumber)).limit(1);
        const versionId = randomUUID();
        const changeSet = await recordChangeSet(transaction, {
          projectId, actorUserId: userId, operation: planned.operation, summary: planned.summary,
          items: [{ entityType: "page", entityId: page.id, beforeVersionId: page.currentVersionId, afterVersionId: versionId }],
        });
        const changeSummary = { headline: planned.summary.slice(0, 120), changes: [], limitations: [] };
        const [created] = await transaction.insert(pageVersions).values({
          id: versionId, changeSetId: changeSet.id, projectId, pageId: page.id,
          versionNumber: (latest?.versionNumber ?? 0) + 1, document: validated.document, sourceFormat: "static_html",
          manifest: { ...manifest, blockUsages: resolved }, seoMetadata: { title: page.pageTitle, description: page.metaDescription },
          changeSummary, sourceHash: manifest.sourceHash, createdByUserId: userId,
        }).returning();
        if (!created) throw new DomainError("VALIDATION", "The new page version could not be created.");
        await transaction.update(pageNodes).set({ currentVersionId: created.id, updatedAt: new Date() }).where(eq(pageNodes.id, page.id));
        await transaction.insert(auditEvents).values({ projectId, userId, action: planned.audit.action, entityType: "page_version", entityId: created.id, metadata: planned.audit.metadata });
        return { ...planned.result, pageId: page.id, pageVersionId: created.id, versionNumber: created.versionNumber, changeSetId: changeSet.id };
      });
    } finally {
      await this.leases.release(userId, leaseTarget).catch(() => undefined);
    }
  }

  /** What the shared generated-document validator is allowed to accept for this project. */
  private async validationScope(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], projectId: string) {
    const [media, pages, blocks] = await Promise.all([
      transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt))),
      transaction.select({ routePath: pageNodes.routePath, type: pageNodes.type }).from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))),
      transaction.select({ id: buildingBlocks.id, currentVersionId: buildingBlocks.currentVersionId }).from(buildingBlocks).where(and(eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt))),
    ]);
    return {
      approvedMediaIds: new Set(media.map(({ id }) => id)),
      activeRoutes: new Set(pages.filter((page) => page.type === "page" && page.routePath).map((page) => page.routePath!)),
      availableBlockIds: new Set(blocks.filter((block) => block.currentVersionId).map(({ id }) => id)),
    };
  }
}

/** Sections a page currently uses, in source order, for the "Add section" surface. */
export async function listPageSectionUsages(database: Database, projectId: string, pageId: string) {
  const [page] = await database.select().from(pageNodes)
    .where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))).limit(1);
  if (!page?.currentVersionId) return [];
  const [version] = await database.select().from(pageVersions).where(eq(pageVersions.id, page.currentVersionId)).limit(1);
  if (!version) return [];
  const document = versionDocument(version);
  if (!document) return [];
  const keys = existingUsageKeys(document.html);
  const rows = await database.select({ block: buildingBlocks, version: buildingBlockVersions })
    .from(buildingBlocks)
    .leftJoin(buildingBlockVersions, eq(buildingBlockVersions.id, buildingBlocks.currentVersionId))
    .where(and(eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt)));
  const manifestUsages = Array.isArray((version.manifest as { blockUsages?: unknown }).blockUsages)
    ? (version.manifest as { blockUsages: Array<{ blockId: string; usageKey: string }> }).blockUsages
    : [];
  return keys.map((usageKey) => {
    const blockId = manifestUsages.find((usage) => usage.usageKey === usageKey)?.blockId ?? null;
    const block = rows.find((row) => row.block.id === blockId)?.block ?? null;
    return { usageKey, blockId, name: block?.name ?? "Reusable section", kind: block?.kind ?? null, isGlobal: block?.isGlobal ?? false };
  });
}
