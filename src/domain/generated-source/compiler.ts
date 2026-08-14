import { build, type Plugin } from "esbuild";
import { AIError } from "@/domain/ai/provider";
import { generatedSourceValidationMessage } from "./diagnostics";

export type GeneratedBlockModule = { blockId: string; sourceCode: string };

function fail(detail: string): never {
  throw new AIError("AI_GENERATED_SOURCE_INVALID", generatedSourceValidationMessage(detail), false, undefined, detail);
}

// Platform-controlled runtime. Generated source may only import these primitives; the
// block registry is assembled by Canvas so a page can never resolve foreign block code.
const siteRuntimeSource = `import React from "react";
import { blocks } from "canvas-block-registry";
export function CanvasImage({mediaId,alt="",className="",...props}){const item=globalThis.__CANVAS_PREVIEW__?.media?.[mediaId];if(!item)return null;return React.createElement("img",{...props,className:("canvas-image "+className).trim(),src:item.previewUrl,alt:alt||item.altText||"",width:props.width||item.width,height:props.height||item.height});}
export function CanvasBlock({blockId,usageKey}){const Block=blocks[blockId];if(!Block)return null;return React.createElement("div",{className:"canvas-block-host","data-canvas-block":blockId,"data-canvas-usage":usageKey||""},React.createElement(Block));}`;

function registrySource(modules: GeneratedBlockModule[]) {
  const imports = modules.map((_entry, index) => `import Block${index} from "canvas-block:${index}";`).join("");
  const entries = modules.map((entry, index) => `${JSON.stringify(entry.blockId)}:Block${index}`).join(",");
  return `${imports}export const blocks={${entries}};`;
}

/**
 * Compiles one validated generated component and the Building Block modules it
 * references into a single restricted browser bundle. Every module is virtual: no
 * file system, npm package, or remote source can enter the bundle.
 */
export async function compileGeneratedSource(input: { entrySource: string; blocks?: GeneratedBlockModule[] }) {
  const modules = input.blocks ?? [];
  const virtual: Plugin = {
    name: "canvas-controlled-modules",
    setup(plugin) {
      plugin.onResolve({ filter: /^generated-entry$/ }, () => ({ path: "generated-entry", namespace: "canvas" }));
      plugin.onResolve({ filter: /^@canvas\/site-runtime$/ }, () => ({ path: "site-runtime", namespace: "canvas" }));
      plugin.onResolve({ filter: /^canvas-block-registry$/ }, () => ({ path: "block-registry", namespace: "canvas" }));
      plugin.onResolve({ filter: /^canvas-block:\d+$/ }, (args) => ({ path: args.path, namespace: "canvas" }));
      plugin.onLoad({ filter: /^generated-entry$/, namespace: "canvas" }, () => ({ contents: input.entrySource, loader: "tsx", resolveDir: process.cwd() }));
      plugin.onLoad({ filter: /^site-runtime$/, namespace: "canvas" }, () => ({ contents: siteRuntimeSource, loader: "jsx", resolveDir: process.cwd() }));
      plugin.onLoad({ filter: /^block-registry$/, namespace: "canvas" }, () => ({ contents: registrySource(modules), loader: "js", resolveDir: process.cwd() }));
      plugin.onLoad({ filter: /^canvas-block:\d+$/, namespace: "canvas" }, (args) => {
        const blockModule = modules[Number(args.path.slice("canvas-block:".length))];
        if (!blockModule) return { errors: [{ text: `Unknown Building Block module: ${args.path}` }] };
        return { contents: blockModule.sourceCode, loader: "tsx", resolveDir: process.cwd() };
      });
      plugin.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point" || args.path === "react" || args.path === "react-dom/client" || args.path.startsWith("react/") || args.importer.includes("node_modules")) return undefined;
        return { errors: [{ text: `Import is not allowed: ${args.path}` }] };
      });
    },
  };
  try {
    const result = await build({
      stdin: { contents: `import React from "react";import{createRoot}from"react-dom/client";import Generated from "generated-entry";const root=document.getElementById("generated-root");if(root)createRoot(root).render(React.createElement(Generated));`, loader: "tsx", resolveDir: process.cwd() },
      bundle: true, write: false, format: "iife", platform: "browser", target: ["es2020"], jsx: "automatic", plugins: [virtual], logLevel: "silent",
    });
    const output = result.outputFiles[0]?.text;
    if (!output) fail("compiler produced no output");
    return output;
  } catch (error) {
    if (error instanceof AIError) throw error;
    fail(`compile failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}
