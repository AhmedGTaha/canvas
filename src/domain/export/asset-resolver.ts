import { getObjectStorage, type ObjectStorage } from "@/server/storage";
import { assertSafeExportPath, fileStem, mediaExtension } from "./naming";
import type { MediaTarget } from "./source-transform";
import type { ExportProjectState } from "./project-state";
import type { ExportFile } from "./zip-packager";

/**
 * Copies only the Media a generated page or Building Block actually references into the
 * exported `public/assets` folder. Storage keys and signed Preview URLs never appear in
 * the output: files are renamed to deterministic, collision-safe local paths.
 */
export class AssetResolver {
  constructor(private readonly storage: ObjectStorage = getObjectStorage()) {}

  async resolve(state: ExportProjectState, mediaIds: Iterable<string>) {
    const targets = new Map<string, MediaTarget>();
    const files: ExportFile[] = [];
    for (const mediaId of new Set(mediaIds)) {
      const asset = state.media.get(mediaId);
      if (!asset) throw new Error(`Export could not resolve media ${mediaId}.`);
      const name = `${fileStem(asset.displayName || asset.originalFilename, asset.id, "image")}.${mediaExtension(asset.mimeType)}`;
      const path = assertSafeExportPath(`public/assets/${name}`);
      files.push({ path, contents: await this.storage.get(asset.storageKey) });
      targets.set(mediaId, { assetPath: `/assets/${name}`, width: asset.width, height: asset.height, altText: asset.altText });
    }
    return { targets, files };
  }
}
