import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlockVersions, buildingBlocks } from "@/server/db/schema";
import { composeFragment, type MediaResolver } from "@/domain/generated-source/composition";
import { isLegacyVersion, versionDocument } from "@/domain/generated-source/stored-version";
import { observe } from "@/server/observability/events";
import { previewDocumentUnreadable, previewLegacyDocument } from "@/generated-runtime/preview/errors";

/**
 * Composes the active version of a Building Block for the sandboxed Preview. Resolution
 * always starts from the project's current state, so a block is never rendered from a
 * client-supplied version or from another project.
 */
export class BuildingBlockContentProvider {
  constructor(private readonly database: Database = db) {}

  async getActive(projectId: string, blockId: string, media: MediaResolver) {
    const [row] = await this.database.select({ block: buildingBlocks, version: buildingBlockVersions })
      .from(buildingBlocks)
      .innerJoin(buildingBlockVersions, and(eq(buildingBlockVersions.id, buildingBlocks.currentVersionId), eq(buildingBlockVersions.buildingBlockId, buildingBlocks.id), eq(buildingBlockVersions.projectId, buildingBlocks.projectId)))
      .where(and(eq(buildingBlocks.id, blockId), eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt)))
      .limit(1);
    if (!row) return null;

    if (isLegacyVersion(row.version)) {
      observe.previewDocumentFailed({ projectId, versionId: row.version.id, reason: "legacy_react_version" });
      throw previewLegacyDocument();
    }
    const document = versionDocument(row.version);
    if (!document) {
      observe.previewDocumentFailed({ projectId, versionId: row.version.id, reason: "unreadable_document" });
      throw previewDocumentUnreadable();
    }

    try {
      return { block: row.block, version: row.version, composed: composeFragment({ document, media, mode: "preview" }) };
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 160) : "unknown";
      observe.previewDocumentFailed({ projectId, versionId: row.version.id, reason });
      // Surfaced to the caller so Preview can explain itself instead of looking empty.
      throw previewDocumentUnreadable(reason);
    }
  }
}
