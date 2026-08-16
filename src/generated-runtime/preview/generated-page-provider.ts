import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { pageNodes, pageVersions } from "@/server/db/schema";
import { resolvePageBlockModules } from "@/domain/blocks/usages";
import { composeDocument, type ComposedBlockDocument, type MediaResolver } from "@/domain/generated-source/composition";
import { isLegacyVersion, versionDocument } from "@/domain/generated-source/stored-version";
import { observe } from "@/server/observability/events";
import { previewLegacyDocument, previewDocumentUnreadable } from "./errors";

/**
 * The content of one page, ready for the Preview frame.
 *
 * There is nothing to compile any more, so this composes rather than builds: the page's
 * validated document, the Building Block documents its hosts resolve to, and the Media
 * URLs for this Preview session are assembled into one markup string, one stylesheet, and
 * one script. Block resolution still comes from current project state, so a global Block
 * change is reflected without rewriting the page or adding a Page Version.
 */
export class GeneratedPageContentProvider {
  constructor(private readonly database: Database = db) {}

  async get(projectId: string, pageId: string, versionId: string, media: MediaResolver) {
    const [row] = await this.database.select({ version: pageVersions }).from(pageNodes)
      .innerJoin(pageVersions, and(eq(pageVersions.id, pageNodes.currentVersionId), eq(pageVersions.pageId, pageNodes.id), eq(pageVersions.projectId, pageNodes.projectId)))
      .where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.currentVersionId, versionId)))
      .limit(1);
    if (!row) return null;

    if (isLegacyVersion(row.version)) {
      observe.previewDocumentFailed({ projectId, pageId, versionId, reason: "legacy_react_version" });
      throw previewLegacyDocument();
    }
    const document = versionDocument(row.version);
    if (!document) {
      observe.previewDocumentFailed({ projectId, pageId, versionId, reason: "unreadable_document" });
      throw previewDocumentUnreadable();
    }

    const usages = await resolvePageBlockModules(this.database, projectId, pageId);
    const blocks = new Map<string, ComposedBlockDocument>();
    for (const usage of usages) {
      if (!usage.document) continue;
      blocks.set(`${usage.blockId}:${usage.usageKey}`, { blockId: usage.blockId, usageKey: usage.usageKey, document: usage.document });
    }

    try {
      const composed = composeDocument({ document, blocks, media, mode: "preview" });
      return { version: row.version, composed, blocks: usages.map(({ blockId, versionId: id, isGlobal }) => ({ blockId, versionId: id, isGlobal })) };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 160) : "unknown";
      observe.previewDocumentFailed({ projectId, pageId, versionId, reason });
      throw previewDocumentUnreadable(reason);
    }
  }
}
