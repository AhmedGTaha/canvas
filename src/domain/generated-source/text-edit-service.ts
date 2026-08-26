import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Database } from "@/server/db/client";
import { auditEvents, buildingBlocks, buildingBlockVersions, mediaAssets, pageNodes, pageVersions } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { recordChangeSet } from "@/domain/history/change-set-service";
import { readStoredDocument, type GeneratedDocument } from "./document";
import { attributeValue, parseHtmlFragment, serializeHtml, type HtmlElement, type HtmlNode } from "./html/parser";
import { validateGeneratedPageDocument } from "@/domain/page-generation/validator";
import { validateGeneratedBlockDocument } from "@/domain/blocks/validation";

const inputSchema = z.object({ projectId: z.uuid(), targetId: z.uuid(), canvasId: z.string().min(1).max(120), textIndex: z.number().int().min(0).max(200), text: z.string().max(5_000) }).strict();

function replaceText(html: string, canvasId: string, textIndex: number, text: string) {
  const nodes = parseHtmlFragment(html);
  const find = (items: HtmlNode[]): HtmlElement | null => {
    for (const node of items) if (node.type === "element") {
      if (attributeValue(node, "data-canvas-id") === canvasId) return node;
      const found = find(node.children); if (found) return found;
    }
    return null;
  };
  const target = find(nodes);
  if (!target) throw new DomainError("NOT_FOUND", "That text is no longer available to edit.");
  const textNodes: Array<{ value: string }> = [];
  const collect = (items: HtmlNode[]) => items.forEach((node) => node.type === "text" ? textNodes.push(node) : collect(node.children));
  collect(target.children);
  const node = textNodes[textIndex];
  if (!node) throw new DomainError("NOT_FOUND", "That text is no longer available to edit.");
  node.value = text;
  return serializeHtml(nodes);
}

/** Saves an inline Preview text edit as an immutable, undoable version. */
export class TextEditService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  async savePage(userId: string, value: unknown) { return this.save(userId, value, "page"); }
  async saveBlock(userId: string, value: unknown) { return this.save(userId, value, "building_block"); }

  private async scope(transaction: Parameters<Parameters<Database["transaction"]>[0]>[0], projectId: string) {
    const [media, pages, blocks] = await Promise.all([
      transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt))),
      transaction.select({ routePath: pageNodes.routePath, type: pageNodes.type }).from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))),
      transaction.select({ id: buildingBlocks.id, currentVersionId: buildingBlocks.currentVersionId }).from(buildingBlocks).where(and(eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt))),
    ]);
    return { approvedMediaIds: new Set(media.map((item) => item.id)), activeRoutes: new Set(pages.filter((item) => item.type === "page" && item.routePath).map((item) => item.routePath!)), availableBlockIds: new Set(blocks.filter((item) => item.currentVersionId).map((item) => item.id)) };
  }

  private async save(userId: string, value: unknown, type: "page" | "building_block") {
    const input = inputSchema.parse(value);
    await this.access.requireProjectAccess(userId, input.projectId);
    return this.database.transaction(async (transaction) => {
      const entity = type === "page"
        ? (await transaction.select().from(pageNodes).where(and(eq(pageNodes.id, input.targetId), eq(pageNodes.projectId, input.projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).for("update"))[0]
        : (await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, input.targetId), eq(buildingBlocks.projectId, input.projectId), isNull(buildingBlocks.deletedAt))).for("update"))[0];
      if (!entity?.currentVersionId) throw new DomainError("NOT_FOUND", "This item has no editable content.");
      const versions = type === "page" ? pageVersions : buildingBlockVersions;
      const foreignKey = type === "page" ? pageVersions.pageId : buildingBlockVersions.buildingBlockId;
      const [current] = await transaction.select().from(versions).where(and(eq(versions.id, entity.currentVersionId), eq(versions.projectId, input.projectId), eq(foreignKey, input.targetId))).limit(1);
      const document = readStoredDocument(current?.document);
      if (!current || !document) throw new DomainError("VALIDATION", "This item uses an older format and cannot be edited inline.");
      const draft: GeneratedDocument = { ...document, html: replaceText(document.html, input.canvasId, input.textIndex, input.text) };
      const scope = await this.scope(transaction, input.projectId);
      let validated;
      try { validated = type === "page" ? validateGeneratedPageDocument({ document: draft, ...scope }) : validateGeneratedBlockDocument({ document: draft, approvedMediaIds: scope.approvedMediaIds, activeRoutes: scope.activeRoutes }); }
      catch { throw new DomainError("VALIDATION", "That text could not be saved."); }
      const [latest] = await transaction.select({ versionNumber: versions.versionNumber }).from(versions).where(and(eq(versions.projectId, input.projectId), eq(foreignKey, input.targetId))).orderBy(desc(versions.versionNumber)).limit(1);
      const id = randomUUID(); const summary = "Updated text";
      const changeSet = await recordChangeSet(transaction, { projectId: input.projectId, actorUserId: userId, operation: type === "page" ? "page_modify" : "block_modify", summary, items: [{ entityType: type === "page" ? "page" : "building_block", entityId: input.targetId, beforeVersionId: entity.currentVersionId, afterVersionId: id }] });
      const common = { id, changeSetId: changeSet.id, projectId: input.projectId, versionNumber: (latest?.versionNumber ?? 0) + 1, document: validated.document, sourceFormat: "static_html" as const, manifest: validated.manifest, changeSummary: { headline: summary, changes: [], limitations: [] }, sourceHash: validated.manifest.sourceHash, createdByUserId: userId };
      if (type === "page") { await transaction.insert(pageVersions).values({ ...common, pageId: input.targetId, seoMetadata: (current as typeof pageVersions.$inferSelect).seoMetadata }); await transaction.update(pageNodes).set({ currentVersionId: id, updatedAt: new Date() }).where(eq(pageNodes.id, input.targetId)); }
      else { await transaction.insert(buildingBlockVersions).values({ ...common, buildingBlockId: input.targetId }); await transaction.update(buildingBlocks).set({ currentVersionId: id, updatedAt: new Date() }).where(eq(buildingBlocks.id, input.targetId)); }
      await transaction.insert(auditEvents).values({ projectId: input.projectId, userId, action: `${type}.text_updated`, entityType: type === "page" ? "page_version" : "building_block_version", entityId: id, metadata: { canvasId: input.canvasId } });
      return { versionId: id };
    });
  }
}
