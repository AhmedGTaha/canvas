import { and, asc, desc, eq, getTableColumns, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { mediaAssets, mediaFolders, users } from "@/server/db/schema";

export class MediaRepository {
  constructor(private readonly database: Database = db) {}

  listFolders(projectId: string) {
    return this.database.select().from(mediaFolders).where(and(eq(mediaFolders.projectId, projectId), isNull(mediaFolders.deletedAt))).orderBy(asc(mediaFolders.position), asc(mediaFolders.createdAt));
  }

  listAssets(projectId: string) {
    return this.database.select({ ...getTableColumns(mediaAssets), uploadedByName: users.displayName }).from(mediaAssets).innerJoin(users, eq(users.id, mediaAssets.createdByUserId)).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt))).orderBy(desc(mediaAssets.createdAt));
  }

  async findActiveAsset(projectId: string, assetId: string) {
    const [asset] = await this.database.select().from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.id, assetId), isNull(mediaAssets.deletedAt))).limit(1);
    return asset;
  }

  async findActiveAssetById(assetId: string) {
    const [asset] = await this.database.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), isNull(mediaAssets.deletedAt))).limit(1);
    return asset;
  }
}
