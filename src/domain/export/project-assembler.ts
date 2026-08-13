import { EXPORT_BASE_CSS, GENERATED_RUNTIME_CSS, themeColorDeclarations, themeScaleDeclarations } from "@/generated-runtime/preview/runtime-css";
import { AssetResolver } from "./asset-resolver";
import { EXPORT_DEPENDENCIES } from "./dependencies";
import { assertSafeExportPath, componentName, fileStem, routeDirectory } from "./naming";
import type { ExportProjectState } from "./project-state";
import { requiresClientRuntime, transformGeneratedSource, type BlockTarget } from "./source-transform";
import type { ExportFile } from "./zip-packager";

const encoder = new TextEncoder();
const text = (path: string, contents: string): ExportFile => ({ path: assertSafeExportPath(path), contents: encoder.encode(contents) });
function tsxString(value: string) { return JSON.stringify(value); }

/**
 * Turns the validated active project into a standalone Next.js + TypeScript app.
 * Building Blocks become shared component files imported wherever they are used, so a
 * global navbar or footer exists exactly once in the output.
 */
export class ProjectAssembler {
  constructor(private readonly assets = new AssetResolver()) {}

  async assemble(state: ExportProjectState) {
    const files: ExportFile[] = [];
    const projectName = state.project.name;
    const siteName = state.brand?.companyName?.trim() || projectName;

    // One component file per Block Version actually used (a pinned historical version
    // and the current version of the same block export as separate files).
    const blockComponents = new Map<string, BlockTarget & { versionId: string }>();
    for (const page of state.pages) {
      for (const usage of page.usages) {
        if (blockComponents.has(usage.versionId)) continue;
        const version = state.blockVersionById.get(usage.versionId);
        const block = state.blockById.get(usage.blockId);
        if (!version || !block) throw new Error(`Export could not resolve Building Block ${usage.blockId}.`);
        const suffix = usage.isGlobal || version.id === block.currentVersionId ? "" : `V${version.versionNumber}`;
        const name = `${componentName(block.name, block.id, "Block")}${suffix}`;
        blockComponents.set(usage.versionId, { versionId: usage.versionId, componentName: name, importPath: `@/components/blocks/${name}` });
      }
    }

    const mediaIds = new Set<string>([
      ...state.referencedMediaIds(state.pages.flatMap((page) => (page.version ? [page.version.id] : []))),
      ...state.referencedMediaIds([...blockComponents.keys()]),
    ]);
    const { targets: media, files: mediaFiles } = await this.assets.resolve(state, mediaIds);
    files.push(...mediaFiles);

    for (const [versionId, target] of blockComponents) {
      const version = state.blockVersionById.get(versionId)!;
      const transformed = transformGeneratedSource({
        sourceCode: version.sourceCode, media, blocks: new Map(), componentName: target.componentName,
        forceClient: requiresClientRuntime(version.sourceCode, version.manifest),
      });
      files.push(text(`components/blocks/${target.componentName}.tsx`, transformed.code));
    }

    for (const page of state.pages) {
      if (!page.version) throw new Error(`Export could not resolve content for ${page.node.name}.`);
      const blocks = new Map<string, BlockTarget>();
      for (const usage of page.usages) {
        const target = blockComponents.get(usage.versionId);
        if (target) blocks.set(`${usage.blockId}:${usage.usageKey}`, target);
      }
      const name = componentName(page.node.name, page.node.id, "Page");
      const transformed = transformGeneratedSource({
        sourceCode: page.version.sourceCode, media, blocks, componentName: name,
        forceClient: requiresClientRuntime(page.version.sourceCode, page.version.manifest),
      });
      files.push(text(`components/pages/${name}.tsx`, transformed.code));

      const title = page.node.pageTitle?.trim() || page.node.name;
      const description = page.node.metaDescription?.trim();
      files.push(text(`${routeDirectory(page.route)}/page.tsx`, [
        `import type { Metadata } from "next";`,
        `import ${name} from "@/components/pages/${name}";`,
        ``,
        `export const metadata: Metadata = {`,
        `  title: ${tsxString(title)},`,
        description ? `  description: ${tsxString(description)},` : `  description: undefined,`,
        `};`,
        ``,
        `export default function Page() {`,
        `  return <${name} />;`,
        `}`,
        ``,
      ].join("\n")));
    }

    files.push(...this.projectFiles(state, siteName, projectName));
    return { files, blockComponentCount: blockComponents.size, mediaCount: media.size };
  }

  private projectFiles(state: ExportProjectState, siteName: string, projectName: string) {
    const description = state.brand?.companyDescription?.trim() || null;
    const packageName = fileStem(projectName, state.project.id, "canvas-site");
    const css = [
      `:root{${themeScaleDeclarations(state.theme)}}`,
      `:root{${themeColorDeclarations(state.theme, "light")}}`,
      `@media (prefers-color-scheme: dark){:root{${themeColorDeclarations(state.theme, "dark")}}}`,
      EXPORT_BASE_CSS,
      GENERATED_RUNTIME_CSS,
    ].join("\n");

    return [
      text("package.json", `${JSON.stringify({
        name: packageName, private: true, version: "1.0.0",
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: EXPORT_DEPENDENCIES.dependencies,
        devDependencies: EXPORT_DEPENDENCIES.devDependencies,
      }, null, 2)}\n`),
      text("tsconfig.json", `${JSON.stringify({
        compilerOptions: {
          target: "ES2022", lib: ["dom", "dom.iterable", "ES2022"], allowJs: false, skipLibCheck: true,
          strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler",
          resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", incremental: true,
          plugins: [{ name: "next" }], baseUrl: ".", paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
        exclude: ["node_modules"],
      }, null, 2)}\n`),
      text("next.config.mjs", [
        `/** @type {import("next").NextConfig} */`,
        `const nextConfig = {`,
        `  eslint: { ignoreDuringBuilds: true },`,
        `};`,
        ``,
        `export default nextConfig;`,
        ``,
      ].join("\n")),
      text("next-env.d.ts", `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n`),
      text(".gitignore", ["node_modules", ".next", "out", ".DS_Store", "*.tsbuildinfo", ""].join("\n")),
      text("styles/globals.css", `${css}\n`),
      text("app/layout.tsx", [
        `import type { Metadata } from "next";`,
        `import type { ReactNode } from "react";`,
        `import "@/styles/globals.css";`,
        ``,
        `export const metadata: Metadata = {`,
        `  title: { default: ${tsxString(siteName)}, template: ${tsxString(`%s · ${siteName}`)} },`,
        description ? `  description: ${tsxString(description)},` : `  description: undefined,`,
        `};`,
        ``,
        `export default function RootLayout({ children }: { children: ReactNode }) {`,
        `  return (`,
        `    <html lang="en">`,
        `      <body>{children}</body>`,
        `    </html>`,
        `  );`,
        `}`,
        ``,
      ].join("\n")),
      text("app/not-found.tsx", [
        `export default function NotFound() {`,
        `  return (`,
        `    <main className="c-page">`,
        `      <section className="c-section c-container c-stack">`,
        `        <span className="c-kicker">404</span>`,
        `        <h1>Page not found</h1>`,
        `        <p className="c-muted">The page you are looking for does not exist.</p>`,
        `        <p><a className="c-button" href="/">Back to home</a></p>`,
        `      </section>`,
        `    </main>`,
        `  );`,
        `}`,
        ``,
      ].join("\n")),
      text("README.md", this.readme(siteName, state)),
    ];
  }

  private readme(siteName: string, state: ExportProjectState) {
    const routes = state.pages.map((page) => `- \`${page.route}\` — ${page.node.name}`).join("\n");
    return [
      `# ${siteName}`,
      ``,
      `This is the exported website for **${siteName}**, generated by Canvas as a standalone`,
      `Next.js + TypeScript project. It has no dependency on Canvas and can be run, edited,`,
      `and deployed on its own.`,
      ``,
      `## Getting started`,
      ``,
      "```bash",
      `npm install`,
      `npm run dev`,
      "```",
      ``,
      `Then open http://localhost:3000.`,
      ``,
      `To create a production build:`,
      ``,
      "```bash",
      `npm run build`,
      "```",
      ``,
      `## Pages`,
      ``,
      routes || `- \`/\` — Home`,
      ``,
      `## What is included`,
      ``,
      `- \`app/\` — one route per page, with its title and meta description`,
      `- \`components/pages/\` — the content of each page`,
      `- \`components/blocks/\` — reusable sections such as a navbar or footer, imported by every page that uses them`,
      `- \`public/assets/\` — the images used by this website`,
      `- \`styles/globals.css\` — your theme colors, spacing, typography, and shared classes`,
      ``,
      `## This website is frontend-only`,
      ``,
      `Everything here runs in the browser. There is no backend, database, API, or user`,
      `accounts, and no data is stored or sent anywhere.`,
      ``,
      `Forms and other interactive elements are **visual only**: they do not submit or save`,
      `anything. To make them work, connect them to a backend or form service of your choice.`,
      ``,
    ].join("\n");
  }
}
