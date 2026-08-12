import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { pageNodes, pageVersions } from "@/server/db/schema";
import { compileGeneratedPage } from "@/domain/page-generation/validator";

const cache = new Map<string, string>();
const CACHE_LIMIT = 50;

export class GeneratedPageContentProvider {
  constructor(private readonly database: Database = db) {}
  async get(projectId: string, pageId: string, versionId: string) {
    const [row] = await this.database.select({ version: pageVersions }).from(pageNodes).innerJoin(pageVersions, and(eq(pageVersions.id, pageNodes.currentVersionId), eq(pageVersions.pageId, pageNodes.id), eq(pageVersions.projectId, pageNodes.projectId))).where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.currentVersionId, versionId))).limit(1);
    if (!row) return null;
    let bundle = cache.get(row.version.id);
    if (!bundle) { bundle = await compileGeneratedPage(row.version.sourceCode); if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!); cache.set(row.version.id, bundle); }
    return { version: row.version, bundle };
  }
}
