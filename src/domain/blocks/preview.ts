import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlockVersions, buildingBlocks } from "@/server/db/schema";
import { compileGeneratedBlock } from "./validation";

const cache = new Map<string, string>();
const CACHE_LIMIT = 50;

/**
 * Compiles the active version of a Building Block for the sandboxed Preview. Resolution
 * always starts from the project's current state, so a block is never rendered from a
 * client-supplied version or from another project.
 */
export class BuildingBlockContentProvider {
  constructor(private readonly database: Database = db) {}

  async getActive(projectId: string, blockId: string) {
    const [row] = await this.database.select({ block: buildingBlocks, version: buildingBlockVersions })
      .from(buildingBlocks)
      .innerJoin(buildingBlockVersions, and(eq(buildingBlockVersions.id, buildingBlocks.currentVersionId), eq(buildingBlockVersions.buildingBlockId, buildingBlocks.id), eq(buildingBlockVersions.projectId, buildingBlocks.projectId)))
      .where(and(eq(buildingBlocks.id, blockId), eq(buildingBlocks.projectId, projectId), isNull(buildingBlocks.deletedAt)))
      .limit(1);
    if (!row) return null;
    let bundle = cache.get(row.version.id);
    if (!bundle) {
      bundle = await compileGeneratedBlock(row.version.sourceCode);
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
      cache.set(row.version.id, bundle);
    }
    return { block: row.block, version: row.version, bundle };
  }
}
