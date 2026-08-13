import { computePageRoutes } from "@/domain/pages/routes";
import { validateGeneratedPageSource } from "@/domain/page-generation/validator";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { AIError } from "@/domain/ai/provider";
import { getObjectStorage, type ObjectStorage } from "@/server/storage";
import { mediaExtension, routeDirectory } from "./naming";
import { manifestList, type ExportProjectState } from "./project-state";

export type ExportFailure = { code: string; message: string; entity?: string };
export type ExportValidationReport = { ok: boolean; checks: Array<{ name: string; passed: boolean }>; failures: ExportFailure[]; pageCount: number; blockCount: number; mediaCount: number };

/**
 * Validates that the project's *active* state can become a standalone site. Generated
 * source is re-checked with the same validators Canvas uses when the version was
 * created, so no unsafe import, network call, or backend behaviour can reach the ZIP.
 */
export class ExportValidator {
  constructor(private readonly storage: ObjectStorage = getObjectStorage()) {}

  async validate(state: ExportProjectState): Promise<ExportValidationReport> {
    const failures: ExportFailure[] = [];
    const checks: Array<{ name: string; passed: boolean }> = [];
    const record = (name: string, before: number) => checks.push({ name, passed: failures.length === before });

    // Routes: unique, derivable, and expressible as safe Next.js directories.
    let routes = new Set<string>();
    let mark = failures.length;
    try {
      const computed = computePageRoutes(state.nodes.map((node) => ({ id: node.id, parentId: node.parentId, type: node.type, slug: node.slug, isHomepage: node.isHomepage })));
      for (const page of state.pages) {
        const expected = computed.get(page.node.id);
        if (!expected || expected !== page.route) failures.push({ code: "ROUTE_INVALID", message: `The URL for “${page.node.name}” is out of date. Open Pages and re-save it.`, entity: page.node.name });
        else routeDirectory(page.route);
      }
      routes = new Set(state.pages.map((page) => page.route));
      if (routes.size !== state.pages.length) failures.push({ code: "ROUTE_COLLISION", message: "Two pages share the same website URL." });
      if (!state.pages.some((page) => page.route === "/")) failures.push({ code: "ROUTE_NO_HOMEPAGE", message: "Choose a homepage before exporting." });
    } catch (error) {
      failures.push({ code: "ROUTE_INVALID", message: error instanceof Error ? error.message : "The page structure cannot be exported." });
    }
    record("Website URLs", mark);

    mark = failures.length;
    const unbuilt = state.pages.filter((page) => !page.version);
    for (const page of unbuilt) failures.push({ code: "PAGE_UNBUILT", message: `“${page.node.name}” has not been created with Canvas yet.`, entity: page.node.name });
    record("Page content", mark);

    // Building Blocks: every usage resolves to a live, non-archived version.
    mark = failures.length;
    const blockVersionIds = new Set<string>();
    for (const page of state.pages) {
      for (const usage of page.usages) {
        const block = state.blockById.get(usage.blockId);
        const version = state.blockVersionById.get(usage.versionId);
        if (!block || block.deletedAt) { failures.push({ code: "BLOCK_MISSING", message: `“${page.node.name}” uses a Building Block that is no longer available.`, entity: page.node.name }); continue; }
        if (!version || version.buildingBlockId !== block.id) { failures.push({ code: "BLOCK_VERSION_MISSING", message: `A Building Block version used by “${page.node.name}” is no longer available.`, entity: page.node.name }); continue; }
        blockVersionIds.add(version.id);
      }
      // Every block reference declared by the active page version must have a usage row.
      const declared = manifestList(page.version?.manifest, "referencedMediaIds").length >= 0 ? blockUsageKeys(page.version?.manifest) : [];
      for (const key of declared) {
        if (!page.usages.some((usage) => `${usage.blockId}:${usage.usageKey}` === key)) failures.push({ code: "BLOCK_MISSING", message: `“${page.node.name}” references a Building Block that is no longer linked to it.`, entity: page.node.name });
      }
    }
    record("Building Blocks", mark);

    // Media: referenced assets exist, are supported, and are present in storage.
    mark = failures.length;
    const pageVersionIds = state.pages.flatMap((page) => (page.version ? [page.version.id] : []));
    const mediaIds = new Set<string>([...state.referencedMediaIds([...pageVersionIds, ...blockVersionIds])]);
    for (const mediaId of mediaIds) {
      const asset = state.media.get(mediaId);
      if (!asset) { failures.push({ code: "MEDIA_MISSING", message: "A page or Building Block uses an image that is no longer in the Media library.", entity: mediaId }); continue; }
      try { mediaExtension(asset.mimeType); } catch { failures.push({ code: "MEDIA_UNSUPPORTED", message: `“${asset.displayName}” uses an image format that cannot be exported.`, entity: asset.displayName }); continue; }
      if (!(await this.storage.exists(asset.storageKey))) failures.push({ code: "MEDIA_MISSING", message: `The file for “${asset.displayName}” is missing from storage.`, entity: asset.displayName });
    }
    record("Images", mark);

    // Internal links must point at routes that still exist.
    mark = failures.length;
    for (const route of state.internalRoutes([...pageVersionIds, ...blockVersionIds])) {
      if (!routes.has(route)) failures.push({ code: "LINK_BROKEN", message: `A link points to ${route}, which is not a page in this website.`, entity: route });
    }
    record("Internal links", mark);

    // Security/import/backend validation, re-run exactly as Canvas runs it on write.
    mark = failures.length;
    const approvedMediaIds = new Set([...state.media.keys()]);
    const availableBlockIds = new Set<string>(); const blockSources = new Map<string, string>();
    for (const versionId of blockVersionIds) {
      const version = state.blockVersionById.get(versionId)!;
      availableBlockIds.add(version.buildingBlockId); blockSources.set(version.buildingBlockId, version.sourceCode);
    }
    for (const versionId of blockVersionIds) {
      const version = state.blockVersionById.get(versionId)!;
      const block = state.blockById.get(version.buildingBlockId);
      try {
        await validateGeneratedBlockSource({ sourceCode: version.sourceCode, approvedMediaIds, activeRoutes: routes, declaredMediaIds: manifestList(version.manifest, "referencedMediaIds") });
      } catch (error) {
        failures.push({ code: "SOURCE_INVALID", message: `“${block?.name ?? "A Building Block"}” contains content that cannot be exported safely.`, entity: error instanceof AIError ? error.diagnostic : undefined });
      }
    }
    for (const page of state.pages) {
      if (!page.version) continue;
      try {
        await validateGeneratedPageSource({
          sourceCode: page.version.sourceCode, approvedMediaIds, activeRoutes: routes,
          declaredMediaIds: manifestList(page.version.manifest, "referencedMediaIds"),
          availableBlockIds, declaredBlockUsages: blockUsages(page.version.manifest), blockSources,
        });
      } catch (error) {
        failures.push({ code: "SOURCE_INVALID", message: `“${page.node.name}” contains content that cannot be exported safely.`, entity: error instanceof AIError ? error.diagnostic : undefined });
      }
    }
    record("Website code", mark);

    return { ok: failures.length === 0, checks, failures, pageCount: state.pages.length, blockCount: blockVersionIds.size, mediaCount: mediaIds.size };
  }
}

function blockUsages(manifest: unknown) {
  if (!manifest || typeof manifest !== "object") return [];
  const entries = (manifest as { blockUsages?: unknown }).blockUsages;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const usage = entry as { blockId?: unknown; usageKey?: unknown };
    return typeof usage.blockId === "string" && typeof usage.usageKey === "string" ? [{ blockId: usage.blockId, usageKey: usage.usageKey }] : [];
  });
}
function blockUsageKeys(manifest: unknown) {
  return blockUsages(manifest).map((usage) => `${usage.blockId}:${usage.usageKey}`);
}
