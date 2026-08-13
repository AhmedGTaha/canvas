import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { pageNodes, pageVersions } from "@/server/db/schema";
import { compileGeneratedPage } from "@/domain/page-generation/validator";
import { resolvePageBlockModules } from "@/domain/blocks/usages";
import { observe } from "@/server/observability/events";
import { previewCompileFailed } from "./errors";

const cache = new Map<string, string>();
const CACHE_LIMIT = 50;

export class GeneratedPageContentProvider {
  constructor(private readonly database: Database = db) {}
  async get(projectId: string, pageId: string, versionId: string) {
    const [row] = await this.database.select({ version: pageVersions }).from(pageNodes).innerJoin(pageVersions, and(eq(pageVersions.id, pageNodes.currentVersionId), eq(pageVersions.pageId, pageNodes.id), eq(pageVersions.projectId, pageNodes.projectId))).where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.currentVersionId, versionId))).limit(1);
    if (!row) return null;
    // Block resolution comes from current project state, so a global Block Version
    // change is reflected without rewriting page source or adding a Page Version.
    const modules = await resolvePageBlockModules(this.database, projectId, pageId);
    const key = [row.version.id, ...modules.map((module) => `${module.blockId}@${module.versionId}`).sort()].join("|");
    let bundle = cache.get(key);
    if (!bundle) {
      try {
        bundle = await compileGeneratedPage(row.version.sourceCode, modules.map(({ blockId, sourceCode }) => ({ blockId, sourceCode })));
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 160) : "unknown";
        observe.previewCompileFailed({ projectId, pageId, versionId, reason });
        // Preview stays recoverable, but the reason travels with the failure.
        throw previewCompileFailed(reason);
      }
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(key, bundle);
    }
    return { version: row.version, bundle, blocks: modules.map(({ blockId, versionId, isGlobal }) => ({ blockId, versionId, isGlobal })) };
  }
}
