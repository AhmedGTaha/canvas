import { parseHtmlFragment, walkElements, attributeValue } from "@/domain/generated-source/html/parser";
import { validateGeneratedJavaScript } from "@/domain/generated-source/javascript";
import { validateGeneratedCss } from "@/domain/generated-source/css";
import type { ExportFailure } from "./export-validator";
import type { ExportFile } from "./zip-packager";

const decoder = new TextDecoder();

/** Canvas internals and backend surfaces that must never reach an exported project. */
const FORBIDDEN_CONTENT: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /data-canvas-(id|label|block|usage|media)/, message: "editor-only Canvas attributes" },
  { pattern: /\bCANVAS_[A-Z_]+\b|PREVIEW_TOKEN_SECRET|DATABASE_URL|AI_PROVIDER_KEY|GEMINI_API_KEY/, message: "Canvas configuration or secrets" },
  { pattern: /\/api\/preview\/media\//, message: "Canvas preview URLs" },
  { pattern: /__CANVAS_PREVIEW__/, message: "Canvas preview globals" },
  { pattern: /\bprocess\.env\b/, message: "environment variables" },
  { pattern: /\b(drizzle-orm|node:fs|node:child_process|@node-rs\/argon2)\b/, message: "server-side packages" },
];
const FORBIDDEN_PATHS = [/^api\//, /\.env/, /^node_modules\//, /(^|\/)package\.json$/];

/**
 * Proves the assembled archive is a working, self-contained static website.
 *
 * The old export produced a Next.js project, so proving it worked meant type-checking or
 * actually running `npm install && next build`. A static site has no build, so the checks
 * that matter are different and cheaper: every document parses, every stylesheet and
 * script passes the same validators the generator is held to, every local reference
 * resolves to a file that is actually in the archive, and nothing Canvas-internal leaked.
 */
export class BuildValidator {
  async validate(files: ExportFile[]): Promise<ExportFailure[]> {
    const failures = this.inspect(files);
    if (failures.length) return failures;
    return this.checkDocuments(files);
  }

  /** Static gate: no backend surfaces, Canvas internals, or secrets in the output. */
  private inspect(files: ExportFile[]): ExportFailure[] {
    const failures: ExportFailure[] = [];
    for (const file of files) {
      for (const pattern of FORBIDDEN_PATHS) {
        if (pattern.test(file.path)) failures.push({ code: "EXPORT_BACKEND_CODE", message: "The exported website may not contain server or build files.", entity: file.path });
      }
      if (!/\.(html|css|js|md)$/.test(file.path)) continue;
      const contents = decoder.decode(file.contents);
      for (const rule of FORBIDDEN_CONTENT) {
        if (rule.pattern.test(contents)) failures.push({ code: "EXPORT_UNSAFE_OUTPUT", message: `The exported website would contain ${rule.message}.`, entity: file.path });
      }
    }
    return failures;
  }

  /**
   * Every page is parsed and its local references are resolved against the archive, so a
   * stylesheet, script, or image that is named but not shipped fails the export here
   * rather than showing up as a broken page after somebody has published it.
   */
  private checkDocuments(files: ExportFile[]): ExportFailure[] {
    const failures: ExportFailure[] = [];
    const present = new Set(files.map((file) => file.path));

    for (const file of files) {
      if (file.path.endsWith(".css")) {
        try { validateGeneratedCss(decoder.decode(file.contents)); }
        catch (error) { failures.push({ code: "EXPORT_UNSAFE_OUTPUT", message: "The exported website contains a stylesheet Canvas cannot verify.", entity: `${file.path}: ${message(error)}` }); }
        continue;
      }
      if (file.path.endsWith(".js")) {
        try { validateGeneratedJavaScript(unwrapScript(decoder.decode(file.contents))); }
        catch (error) { failures.push({ code: "EXPORT_UNSAFE_OUTPUT", message: "The exported website contains a script Canvas cannot verify.", entity: `${file.path}: ${message(error)}` }); }
        continue;
      }
      if (!file.path.endsWith(".html")) continue;

      const html = decoder.decode(file.contents);
      const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
      const fragment = body.slice(body.indexOf(">") + 1);
      let references: string[];
      try {
        const nodes = parseHtmlFragment(fragment);
        references = localReferences(nodes);
      } catch (error) {
        failures.push({ code: "EXPORT_INVALID_DOCUMENT", message: "The exported website contains a page Canvas could not re-read.", entity: `${file.path}: ${message(error)}` });
        continue;
      }
      for (const reference of [...references, ...headReferences(html)]) {
        const resolved = resolveAgainst(file.path, reference);
        if (resolved !== null && !present.has(resolved)) {
          failures.push({ code: "EXPORT_BROKEN_REFERENCE", message: "The exported website links to a file that is not in the download.", entity: `${file.path} → ${reference}` });
        }
      }
    }
    return failures.slice(0, 8);
  }
}

function message(error: unknown) {
  return (error instanceof Error ? error.message : "unknown").slice(0, 160);
}

/** The generated script as it was validated, before Canvas wrapped it in its own scope. */
function unwrapScript(contents: string) {
  const start = contents.indexOf('"use strict";');
  const end = contents.lastIndexOf("})();");
  return start === -1 || end === -1 ? contents : contents.slice(start + '"use strict";'.length, end);
}

function localReferences(nodes: ReturnType<typeof parseHtmlFragment>) {
  const references: string[] = [];
  walkElements(nodes, (element) => {
    const value = element.tag === "img" ? attributeValue(element, "src") : element.tag === "a" ? attributeValue(element, "href") : null;
    if (value) references.push(value);
  });
  return references;
}

function headReferences(html: string) {
  const head = html.slice(0, html.indexOf("</head>"));
  return [...head.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]!)
    .concat([...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]!));
}

/**
 * Resolves a reference from one archive file, or returns null when it is not a local
 * file reference at all (an absolute URL, a mail or phone link, or an in-page anchor).
 */
function resolveAgainst(from: string, reference: string) {
  if (!reference || /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("#") || reference.startsWith("//")) return null;
  const base = from.split("/").slice(0, -1);
  const target = reference.split(/[?#]/)[0]!;
  if (!target) return null;
  const segments = target.startsWith("/") ? target.slice(1).split("/") : [...base, ...target.split("/")];
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") { resolved.pop(); continue; }
    resolved.push(segment);
  }
  return resolved.join("/");
}
