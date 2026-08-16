import { EXPORT_BASE_CSS, GENERATED_RUNTIME_CSS, themeColorDeclarations, themeScaleDeclarations } from "@/generated-runtime/preview/runtime-css";
import { composeDocument, type ComposedBlockDocument, type MediaResolver } from "@/domain/generated-source/composition";
import { escapeHtmlAttribute, escapeHtmlText } from "@/domain/generated-source/html/parser";
import { requireVersionDocument } from "@/domain/generated-source/stored-version";
import { AssetResolver } from "./asset-resolver";
import { assertSafeExportPath, fileStem, pageFilePath, relativeRootPrefix } from "./naming";
import type { ExportProjectState } from "./project-state";
import type { ExportFile } from "./zip-packager";

const encoder = new TextEncoder();
const text = (path: string, contents: string): ExportFile => ({ path: assertSafeExportPath(path), contents: encoder.encode(contents) });

/**
 * Turns the validated active project into a plain static website.
 *
 * There is no framework, no package manager, and no build step in the output: a person
 * can open `index.html` from disk, or drop the folder onto any static host, and it works.
 * That is possible because the stored form is already HTML, CSS, and JavaScript — the
 * assembler's job is composition and file layout, not compilation.
 *
 * ```
 * index.html          one file per page, named from its route
 * about.html
 * assets/             the images those pages reference
 * styles/site.css     theme tokens + the shared Canvas classes
 * styles/<page>.css   that page's own styles, and the styles of the blocks it uses
 * scripts/<page>.js   that page's own behaviour, and its blocks'
 * ```
 */
export class ProjectAssembler {
  constructor(private readonly assets = new AssetResolver()) {}

  async assemble(state: ExportProjectState) {
    const files: ExportFile[] = [];
    const projectName = state.project.name;
    const siteName = state.brand?.companyName?.trim() || projectName;

    const mediaIds = new Set<string>([
      ...state.referencedMediaIds(state.pages.flatMap((page) => (page.version ? [page.version.id] : []))),
      ...state.referencedMediaIds(state.pages.flatMap((page) => page.usages.map((usage) => usage.versionId))),
    ]);
    const { targets, files: mediaFiles } = await this.assets.resolve(state, mediaIds);
    files.push(...mediaFiles);

    // Every reference the exported site makes is relative to the file making it, so the
    // folder works opened from disk and served from a domain without a base tag or a
    // rewrite rule. A nested route simply gets more `../`.
    const mediaFor = (prefix: string): MediaResolver => (mediaId) => {
      const target = targets.get(mediaId);
      return target ? { url: `${prefix}${target.assetPath.replace(/^\//, "")}`, width: target.width, height: target.height, altText: target.altText } : null;
    };
    const routeToFile = new Map(state.pages.map((page) => [page.route, pageFilePath(page.route)]));

    let blockCount = 0;
    for (const page of state.pages) {
      if (!page.version) throw new Error(`Export could not resolve content for ${page.node.name}.`);
      const document = requireVersionDocument(page.version);

      const blocks = new Map<string, ComposedBlockDocument>();
      for (const usage of page.usages) {
        const version = state.blockVersionById.get(usage.versionId);
        if (!version) throw new Error(`Export could not resolve Building Block ${usage.blockId}.`);
        blocks.set(`${usage.blockId}:${usage.usageKey}`, { blockId: usage.blockId, usageKey: usage.usageKey, document: requireVersionDocument(version) });
        blockCount += 1;
      }

      const pagePath = pageFilePath(page.route);
      const prefix = relativeRootPrefix(pagePath);
      const composed = composeDocument({
        document, blocks, mode: "export",
        media: mediaFor(prefix),
        links: (route) => { const file = routeToFile.get(route); return file ? `${prefix}${file}` : null; },
      });
      if (composed.missingMedia.length) throw new Error(`Export could not resolve media ${composed.missingMedia[0]}.`);
      if (composed.missingBlocks.length) throw new Error(`Export could not resolve Building Block ${composed.missingBlocks[0]}.`);

      const stem = fileStem(page.node.name, page.node.id, "page");
      const stylesheet = composed.css.trim() ? `styles/${stem}.css` : null;
      const script = composed.js.trim() ? `scripts/${stem}.js` : null;
      if (stylesheet) files.push(text(stylesheet, `${composed.css}\n`));
      if (script) files.push(text(script, `${composed.js}\n`));

      files.push(text(pagePath, this.pageHtml({
        siteName,
        title: document.metadata?.title?.trim() || page.node.pageTitle?.trim() || page.node.name,
        description: document.metadata?.description?.trim() || page.node.metaDescription?.trim() || null,
        body: composed.html,
        stylesheet: stylesheet ? `${prefix}${stylesheet}` : null,
        script: script ? `${prefix}${script}` : null,
        prefix,
      })));
    }

    files.push(...this.projectFiles(state, siteName, projectName));
    return { files, blockComponentCount: blockCount, mediaCount: targets.size };
  }

  /**
   * One page document. Every page links the shared stylesheet first and its own second,
   * so a page's styles win over the shared classes without either being duplicated.
   */
  private pageHtml(input: { siteName: string; title: string; description: string | null; body: string; stylesheet: string | null; script: string | null; prefix: string }) {
    const title = input.title === input.siteName ? input.title : `${input.title} · ${input.siteName}`;
    return [
      `<!doctype html>`,
      `<html lang="en">`,
      `<head>`,
      `<meta charset="utf-8">`,
      `<meta name="viewport" content="width=device-width,initial-scale=1">`,
      `<title>${escapeHtmlText(title)}</title>`,
      input.description ? `<meta name="description" content="${escapeHtmlAttribute(input.description)}">` : "",
      `<link rel="stylesheet" href="${escapeHtmlAttribute(`${input.prefix}styles/site.css`)}">`,
      input.stylesheet ? `<link rel="stylesheet" href="${escapeHtmlAttribute(input.stylesheet)}">` : "",
      `</head>`,
      `<body class="c-page">`,
      input.body,
      input.script ? `<script src="${escapeHtmlAttribute(input.script)}"></script>` : "",
      `</body>`,
      `</html>`,
      ``,
    ].filter((line) => line !== "").join("\n");
  }

  private projectFiles(state: ExportProjectState, siteName: string, projectName: string) {
    const css = [
      `:root{${themeScaleDeclarations(state.theme)}}`,
      `:root{${themeColorDeclarations(state.theme, "light")}}`,
      `@media (prefers-color-scheme: dark){:root{${themeColorDeclarations(state.theme, "dark")}}}`,
      EXPORT_BASE_CSS,
      GENERATED_RUNTIME_CSS,
    ].join("\n");

    return [
      text("styles/site.css", `${css}\n`),
      text(".gitignore", [".DS_Store", ""].join("\n")),
      text("README.md", this.readme(siteName, state, projectName)),
    ];
  }

  private readme(siteName: string, state: ExportProjectState, projectName: string) {
    const routes = state.pages.map((page) => `- \`${pageFilePath(page.route)}\` — ${page.node.name} (${page.route})`).join("\n");
    return [
      `# ${siteName}`,
      ``,
      `This is the exported website for **${siteName}**, generated by Canvas as a plain`,
      `static site: HTML, CSS, and JavaScript, with no framework and no build step.`,
      ``,
      `## Viewing it`,
      ``,
      `Open \`index.html\` in a browser, or serve the folder with any static file server:`,
      ``,
      "```bash",
      `python3 -m http.server`,
      "```",
      ``,
      `## Publishing it`,
      ``,
      `Upload the whole folder to any static host — Vercel, Netlify, GitHub Pages, S3, or`,
      `ordinary shared hosting. There is nothing to install, compile, or configure.`,
      ``,
      `## Pages`,
      ``,
      routes || `- \`index.html\` — Home (/)`,
      ``,
      `## What is included`,
      ``,
      `- \`*.html\` — one file per page, with its own title and meta description`,
      `- \`styles/site.css\` — your theme colors, spacing, typography, and the shared classes`,
      `- \`styles/\` and \`scripts/\` — each page's own styles and behaviour, including the reusable sections it uses`,
      `- \`assets/\` — the images used by this website`,
      ``,
      `## This website is frontend-only`,
      ``,
      `Everything here runs in the browser. There is no backend, database, API, or user`,
      `accounts, and no data is stored or sent anywhere.`,
      ``,
      `Forms and other interactive elements are **visual only**: they do not submit or save`,
      `anything. To make them work, connect them to a backend or form service of your choice.`,
      ``,
      `Exported from the Canvas project “${projectName}”.`,
      ``,
    ].join("\n");
  }
}
