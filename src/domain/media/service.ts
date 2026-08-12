import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { DomainError } from "@/domain/shared/errors";
import { db } from "@/server/db/client";
import { mediaAssets, mediaFolders, projectBrandSettings, type MediaFolder } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { getObjectStorage, type ObjectStorage } from "@/server/storage";
import { inspectImage } from "./image-metadata";
import { MediaRepository } from "./repository";
import { assetMutationSchema, createMediaFolderSchema, listMediaSchema, mediaFolderMutationSchema, moveMediaAssetSchema, moveMediaFolderSchema, renameMediaFolderSchema, reorderMediaFolderSchema, setBrandLogoSchema, updateMediaAssetSchema } from "./schemas";

function folderDescendants(folders: MediaFolder[], folderId: string) {
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; }
  }
  return ids;
}

function uploadName(value: string) {
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "-").trim().slice(0, 255);
  if (!name) throw new DomainError("VALIDATION", "The uploaded file needs a name.");
  return name;
}

export class MediaService {
  constructor(private readonly repository = new MediaRepository(), private readonly access = new ProjectAccessService(), private readonly storage: ObjectStorage = getObjectStorage()) {}

  async list(userId: string, input: unknown) {
    const parsed = listMediaSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const [folders, assets] = await Promise.all([this.repository.listFolders(parsed.projectId), this.repository.listAssets(parsed.projectId)]);
    const needle = parsed.search.toLocaleLowerCase();
    return { folders, assets: needle ? assets.filter((asset) => `${asset.displayName} ${asset.originalFilename} ${asset.altText ?? ""}`.toLocaleLowerCase().includes(needle)) : assets };
  }

  private async lockedFolders<T>(userId: string, projectId: string, operation: (folders: MediaFolder[], transaction: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
    await this.access.requireProjectAccess(userId, projectId);
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`media:${projectId}`}))`);
      const folders = await transaction.select().from(mediaFolders).where(and(eq(mediaFolders.projectId, projectId), isNull(mediaFolders.deletedAt))).orderBy(asc(mediaFolders.position)).for("update");
      return operation(folders, transaction);
    });
  }

  async createFolder(userId: string, input: unknown) {
    const parsed = createMediaFolderSchema.parse(input);
    return this.lockedFolders(userId, parsed.projectId, async (folders, transaction) => {
      if (parsed.parentId && !folders.some((folder) => folder.id === parsed.parentId)) throw new DomainError("NOT_FOUND", "Destination folder not found.");
      const siblings = folders.filter((folder) => folder.parentId === parsed.parentId);
      try {
        const [created] = await transaction.insert(mediaFolders).values({ projectId: parsed.projectId, parentId: parsed.parentId, name: parsed.name, position: siblings.length, createdByUserId: userId }).returning();
        return created;
      } catch (error: unknown) { if (error && typeof error === "object" && "cause" in error && (error.cause as { code?: string })?.code === "23505") throw new DomainError("CONFLICT", "A folder with this name already exists here."); throw error; }
    });
  }

  async renameFolder(userId: string, input: unknown) {
    const parsed = renameMediaFolderSchema.parse(input);
    return this.lockedFolders(userId, parsed.projectId, async (folders, transaction) => {
      if (!folders.some((folder) => folder.id === parsed.folderId)) throw new DomainError("NOT_FOUND", "Folder not found.");
      try { const [updated] = await transaction.update(mediaFolders).set({ name: parsed.name, updatedAt: new Date() }).where(eq(mediaFolders.id, parsed.folderId)).returning(); return updated; }
      catch (error: unknown) { if (error && typeof error === "object" && "cause" in error && (error.cause as { code?: string })?.code === "23505") throw new DomainError("CONFLICT", "A folder with this name already exists here."); throw error; }
    });
  }

  async moveFolder(userId: string, input: unknown) {
    const parsed = moveMediaFolderSchema.parse(input);
    return this.lockedFolders(userId, parsed.projectId, async (folders, transaction) => {
      const folder = folders.find((item) => item.id === parsed.folderId);
      if (!folder) throw new DomainError("NOT_FOUND", "Folder not found.");
      if (parsed.parentId && !folders.some((item) => item.id === parsed.parentId)) throw new DomainError("NOT_FOUND", "Destination folder not found.");
      if (parsed.parentId && folderDescendants(folders, folder.id).has(parsed.parentId)) throw new DomainError("VALIDATION", parsed.parentId === folder.id ? "A folder cannot be moved inside itself." : "A folder cannot be moved inside one of its children.");
      const oldParentId = folder.parentId;
      const oldSiblings = folders.filter((item) => item.parentId === oldParentId && item.id !== folder.id).sort((a, b) => a.position - b.position);
      const newSiblings = oldParentId === parsed.parentId ? oldSiblings : folders.filter((item) => item.parentId === parsed.parentId && item.id !== folder.id).sort((a, b) => a.position - b.position);
      newSiblings.push(folder); folder.parentId = parsed.parentId;
      const affected = new Map([...oldSiblings, ...newSiblings].map((item) => [item.id, item]));
      oldSiblings.forEach((item, position) => { item.position = position; }); newSiblings.forEach((item, position) => { item.position = position; });
      for (const item of affected.values()) await transaction.update(mediaFolders).set({ parentId: item.parentId, position: item.position, updatedAt: new Date() }).where(eq(mediaFolders.id, item.id));
      const updated = folder;
      return updated;
    });
  }

  async reorderFolder(userId: string, input: unknown) {
    const parsed = reorderMediaFolderSchema.parse(input);
    return this.lockedFolders(userId, parsed.projectId, async (folders, transaction) => {
      const folder = folders.find((item) => item.id === parsed.folderId);
      if (!folder) throw new DomainError("NOT_FOUND", "Folder not found.");
      const siblings = folders.filter((item) => item.parentId === folder.parentId).sort((a, b) => a.position - b.position);
      const current = siblings.findIndex((item) => item.id === folder.id); const target = parsed.direction === "up" ? current - 1 : current + 1;
      if (target < 0 || target >= siblings.length) return folder;
      [siblings[current], siblings[target]] = [siblings[target]!, siblings[current]!];
      for (const [position, item] of siblings.entries()) { item.position = position; await transaction.update(mediaFolders).set({ position, updatedAt: new Date() }).where(eq(mediaFolders.id, item.id)); }
      return folder;
    });
  }

  async deleteFolder(userId: string, input: unknown) {
    const parsed = mediaFolderMutationSchema.parse(input);
    return this.lockedFolders(userId, parsed.projectId, async (folders, transaction) => {
      if (!folders.some((folder) => folder.id === parsed.folderId)) throw new DomainError("NOT_FOUND", "Folder not found.");
      const ids = [...folderDescendants(folders, parsed.folderId)];
      const affectedAssets = await transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, parsed.projectId), inArray(mediaAssets.folderId, ids), isNull(mediaAssets.deletedAt)));
      const assetIds = affectedAssets.map((asset) => asset.id);
      const now = new Date();
      if (assetIds.length) {
        await transaction.update(projectBrandSettings).set({ primaryLogoMediaId: sql`CASE WHEN ${inArray(projectBrandSettings.primaryLogoMediaId, assetIds)} THEN NULL ELSE ${projectBrandSettings.primaryLogoMediaId} END`, alternateLogoMediaId: sql`CASE WHEN ${inArray(projectBrandSettings.alternateLogoMediaId, assetIds)} THEN NULL ELSE ${projectBrandSettings.alternateLogoMediaId} END`, revision: sql`${projectBrandSettings.revision} + 1`, updatedAt: now }).where(eq(projectBrandSettings.projectId, parsed.projectId));
        await transaction.update(mediaAssets).set({ deletedAt: now, updatedAt: now }).where(inArray(mediaAssets.id, assetIds));
      }
      await transaction.update(mediaFolders).set({ deletedAt: now, updatedAt: now }).where(inArray(mediaFolders.id, ids));
      const affectedParents = new Set(folders.filter((folder) => ids.includes(folder.id)).map((folder) => folder.parentId));
      for (const parentId of affectedParents) {
        const survivors = folders.filter((folder) => folder.parentId === parentId && !ids.includes(folder.id)).sort((a, b) => a.position - b.position);
        for (const [position, folder] of survivors.entries()) await transaction.update(mediaFolders).set({ position, updatedAt: now }).where(eq(mediaFolders.id, folder.id));
      }
      return { deletedFolders: ids.length, deletedAssets: assetIds.length };
    });
  }

  async upload(userId: string, input: { projectId: string; folderId?: string | null; filename: string; bytes: Uint8Array }) {
    const { projectId, folderId = null } = input;
    await this.access.requireProjectAccess(userId, projectId);
    const maxBytes = Number(process.env.MEDIA_MAX_BYTES || 10 * 1024 * 1024);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("MEDIA_MAX_BYTES must be a positive integer.");
    if (input.bytes.byteLength > maxBytes) throw new DomainError("VALIDATION", `Images must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`);
    const metadata = inspectImage(input.bytes);
    const id = crypto.randomUUID();
    const filename = uploadName(input.filename);
    const displayName = filename.replace(/\.(png|jpe?g|webp)$/i, "").trim().slice(0, 160) || "Untitled image";
    const storageKey = `projects/${projectId}/media/${id}/original.${metadata.extension}`;
    await this.storage.put(storageKey, input.bytes);
    try {
      const asset = await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`media:${projectId}`}))`);
        if (folderId) { const [folder] = await transaction.select({ id: mediaFolders.id }).from(mediaFolders).where(and(eq(mediaFolders.id, folderId), eq(mediaFolders.projectId, projectId), isNull(mediaFolders.deletedAt))).limit(1); if (!folder) throw new DomainError("NOT_FOUND", "Destination folder not found."); }
        const [created] = await transaction.insert(mediaAssets).values({ id, projectId, folderId, originalFilename: filename, displayName, storageKey, mimeType: metadata.mimeType, sizeBytes: input.bytes.byteLength, width: metadata.width, height: metadata.height, createdByUserId: userId }).returning();
        return created;
      });
      if (!asset) throw new Error("Media upload did not return a record.");
      return asset;
    } catch (error) { await this.storage.delete(storageKey); throw error; }
  }

  async updateAsset(userId: string, input: unknown) {
    const parsed = updateMediaAssetSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const [updated] = await db.update(mediaAssets).set({ displayName: parsed.displayName, altText: parsed.altText, updatedAt: new Date() }).where(and(eq(mediaAssets.id, parsed.assetId), eq(mediaAssets.projectId, parsed.projectId), isNull(mediaAssets.deletedAt))).returning();
    if (!updated) throw new DomainError("NOT_FOUND", "Media item not found.");
    return updated;
  }

  async moveAsset(userId: string, input: unknown) {
    const parsed = moveMediaAssetSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`media:${parsed.projectId}`}))`);
      if (parsed.folderId) { const [folder] = await transaction.select({ id: mediaFolders.id }).from(mediaFolders).where(and(eq(mediaFolders.id, parsed.folderId), eq(mediaFolders.projectId, parsed.projectId), isNull(mediaFolders.deletedAt))).limit(1); if (!folder) throw new DomainError("NOT_FOUND", "Destination folder not found."); }
      const [updated] = await transaction.update(mediaAssets).set({ folderId: parsed.folderId, updatedAt: new Date() }).where(and(eq(mediaAssets.id, parsed.assetId), eq(mediaAssets.projectId, parsed.projectId), isNull(mediaAssets.deletedAt))).returning();
      if (!updated) throw new DomainError("NOT_FOUND", "Media item not found.");
      return updated;
    });
  }

  async deleteAsset(userId: string, input: unknown) {
    const parsed = assetMutationSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`media:${parsed.projectId}`}))`);
      const [asset] = await transaction.select().from(mediaAssets).where(and(eq(mediaAssets.id, parsed.assetId), eq(mediaAssets.projectId, parsed.projectId), isNull(mediaAssets.deletedAt))).for("update");
      if (!asset) throw new DomainError("NOT_FOUND", "Media item not found.");
      const now = new Date();
      await transaction.update(projectBrandSettings).set({ primaryLogoMediaId: sql`CASE WHEN ${projectBrandSettings.primaryLogoMediaId} = ${asset.id} THEN NULL ELSE ${projectBrandSettings.primaryLogoMediaId} END`, alternateLogoMediaId: sql`CASE WHEN ${projectBrandSettings.alternateLogoMediaId} = ${asset.id} THEN NULL ELSE ${projectBrandSettings.alternateLogoMediaId} END`, revision: sql`${projectBrandSettings.revision} + 1`, updatedAt: now }).where(and(eq(projectBrandSettings.projectId, parsed.projectId), or(eq(projectBrandSettings.primaryLogoMediaId, asset.id), eq(projectBrandSettings.alternateLogoMediaId, asset.id))));
      await transaction.update(mediaAssets).set({ deletedAt: now, updatedAt: now }).where(eq(mediaAssets.id, asset.id));
      return asset;
    });
  }

  async setBrandLogo(userId: string, input: unknown) {
    const parsed = setBrandLogoSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`media:${parsed.projectId}`}))`);
      if (parsed.assetId) { const [asset] = await transaction.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, parsed.projectId), eq(mediaAssets.id, parsed.assetId), isNull(mediaAssets.deletedAt))).limit(1); if (!asset) throw new DomainError("NOT_FOUND", "Media item not found in this project."); }
      const patch = parsed.kind === "primary" ? { primaryLogoMediaId: parsed.assetId } : { alternateLogoMediaId: parsed.assetId };
      const [brand] = await transaction.update(projectBrandSettings).set({ ...patch, revision: sql`${projectBrandSettings.revision} + 1`, updatedAt: new Date() }).where(eq(projectBrandSettings.projectId, parsed.projectId)).returning();
      if (!brand) throw new DomainError("NOT_FOUND", "Brand settings not found.");
      return brand;
    });
  }

  async readBinary(userId: string, assetId: string) {
    const asset = await this.repository.findActiveAssetById(assetId);
    if (!asset) throw new DomainError("NOT_FOUND", "Media item not found.");
    await this.access.requireProjectAccess(userId, asset.projectId);
    return { asset, bytes: await this.storage.get(asset.storageKey) };
  }
}

export async function getProjectMediaContext(userId: string, projectId: string) {
  const { folders, assets } = await new MediaService().list(userId, { projectId });
  const paths = new Map<string, string>();
  const pathFor = (id: string): string => { const cached = paths.get(id); if (cached) return cached; const folder = folders.find((item) => item.id === id); if (!folder) return ""; const value = folder.parentId ? `${pathFor(folder.parentId)}/${folder.name}` : folder.name; paths.set(id, value); return value; };
  return assets.map((asset) => ({ id: asset.id, name: asset.displayName, originalFilename: asset.originalFilename, folderPath: asset.folderId ? pathFor(asset.folderId) : "", mimeType: asset.mimeType, width: asset.width, height: asset.height, altText: asset.altText }));
}

export async function getMediaAssetReference(userId: string, projectId: string, assetId: string) {
  const service = new MediaService();
  await service.list(userId, { projectId });
  const asset = await new MediaRepository().findActiveAsset(projectId, assetId);
  if (!asset) throw new DomainError("NOT_FOUND", "Media item not found.");
  return { id: asset.id, name: asset.displayName, mimeType: asset.mimeType, width: asset.width, height: asset.height, altText: asset.altText };
}
