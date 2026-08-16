import { createHash } from "node:crypto";

/** Short, stable disambiguator derived from an internal UUID without exposing it. */
export function shortHash(value: string, length = 8) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function words(value: string) {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

/**
 * Deterministic PascalCase component name. Display names are editable, so the stable
 * entity ID always contributes the suffix that guarantees uniqueness.
 */
export function componentName(displayName: string, stableId: string, prefix = "Block") {
  const base = words(displayName).map((word) => word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join("").slice(0, 40);
  const safe = /^[A-Za-z]/.test(base) ? base : `${prefix}${base}`;
  return `${safe || prefix}${shortHash(stableId, 6).toUpperCase()}`;
}

/** Deterministic lowercase file stem, collision-safe via the stable ID. */
export function fileStem(displayName: string, stableId: string, fallback = "asset") {
  const base = words(displayName).map((word) => word.toLowerCase()).join("-").slice(0, 48).replace(/^-|-$/g, "");
  return `${base || fallback}-${shortHash(stableId, 8)}`;
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export function mediaExtension(mimeType: string) {
  const extension = EXTENSIONS[mimeType];
  if (!extension) throw new Error(`Unsupported media type for export: ${mimeType}`);
  return extension;
}

/**
 * Maps a site route to the HTML file that serves it.
 *
 * `/` is `index.html` and `/about` is `about.html`, which is the layout every static host
 * serves without configuration and the only one that also works when the folder is opened
 * straight from disk. A nested route keeps its shape as a directory. Every segment is
 * re-derived from a strict slug pattern, so no route can escape the archive root.
 */
export function pageFilePath(route: string) {
  if (route === "/") return "index.html";
  const segments = route.replace(/^\//, "").split("/");
  for (const segment of segments) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment)) throw new Error(`Unsafe route segment for export: ${segment}`);
  }
  return `${segments.join("/")}.html`;
}

/** The `../` prefix that gets from one exported page back to the archive root. */
export function relativeRootPrefix(filePath: string) {
  const depth = filePath.split("/").length - 1;
  return "../".repeat(depth);
}

/** Rejects anything that could escape the archive root when a file is written. */
export function assertSafeExportPath(filePath: string) {
  if (!/^[A-Za-z0-9._][A-Za-z0-9/_.-]*$/.test(filePath)) throw new Error(`Unsafe export path: ${filePath}`);
  if (filePath.includes("..") || filePath.includes("//") || filePath.startsWith("/") || filePath.endsWith("/")) throw new Error(`Unsafe export path: ${filePath}`);
  // Reject anything that could resolve outside the archive root or hide a dot segment.
  for (const segment of filePath.split("/")) if (segment === "" || segment === "." || segment === "..") throw new Error(`Unsafe export path: ${filePath}`);
  return filePath;
}
