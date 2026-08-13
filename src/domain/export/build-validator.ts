import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import type { ExportFailure } from "./export-validator";
import type { ExportFile } from "./zip-packager";

const decoder = new TextDecoder();
const SOURCE_PATTERN = /\.tsx?$/;

/** Canvas internals and backend surfaces that must never reach an exported project. */
const FORBIDDEN_CONTENT: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /data-canvas-(id|label|block|usage)/, message: "editor-only Canvas attributes" },
  { pattern: /@canvas\/site-runtime/, message: "the Canvas preview runtime" },
  { pattern: /\bCANVAS_[A-Z_]+\b|PREVIEW_TOKEN_SECRET|DATABASE_URL|AI_PROVIDER_KEY|GEMINI_API_KEY/, message: "Canvas configuration or secrets" },
  { pattern: /from\s+["']next\/(server|headers)["']|["']server-only["']/, message: "server-only Next.js APIs" },
  { pattern: /\buse server\b/, message: "server actions" },
  { pattern: /\bprocess\.env\b/, message: "environment variables" },
  { pattern: /\b(drizzle-orm|postgres|node:fs|node:child_process|@node-rs\/argon2)\b/, message: "server-side packages" },
  { pattern: /__CANVAS_PREVIEW__|canvas-block-registry/, message: "Canvas preview globals" },
];
const FORBIDDEN_PATHS = [/^app\/api\//, /^pages\/api\//, /route\.tsx?$/, /middleware\.tsx?$/, /\.env/];

export type BuildMode = "typecheck" | "full";

/**
 * Proves the assembled project is a valid, frontend-only Next.js + TypeScript app.
 * A full `npm install && next build` runs when CANVAS_EXPORT_BUILD=full; otherwise the
 * sources are type-checked in-process against the Canvas runtime's React/Next types.
 */
export class BuildValidator {
  constructor(private readonly mode: BuildMode = (process.env.CANVAS_EXPORT_BUILD === "full" ? "full" : "typecheck")) {}

  async validate(files: ExportFile[]): Promise<ExportFailure[]> {
    const failures = this.inspect(files);
    if (failures.length) return failures;
    return this.mode === "full" ? this.fullBuild(files) : this.typecheck(files);
  }

  /** Static gate: no backend surfaces, Canvas internals, or secrets in the output. */
  private inspect(files: ExportFile[]): ExportFailure[] {
    const failures: ExportFailure[] = [];
    for (const file of files) {
      for (const pattern of FORBIDDEN_PATHS) {
        if (pattern.test(file.path)) failures.push({ code: "EXPORT_BACKEND_CODE", message: "The exported website may not contain server or API code.", entity: file.path });
      }
      if (!SOURCE_PATTERN.test(file.path) && !file.path.endsWith(".json") && !file.path.endsWith(".css") && !file.path.endsWith(".mjs") && !file.path.endsWith(".md")) continue;
      const contents = decoder.decode(file.contents);
      for (const rule of FORBIDDEN_CONTENT) {
        if (rule.pattern.test(contents)) failures.push({ code: "EXPORT_UNSAFE_OUTPUT", message: `The exported website would contain ${rule.message}.`, entity: file.path });
      }
    }
    return failures;
  }

  /**
   * Type-checks the assembled sources against the Canvas runtime's React/Next types.
   * Files are staged inside the repository so `@/*` and package resolution behave
   * exactly as they will in the exported project.
   */
  private async typecheck(files: ExportFile[]): Promise<ExportFailure[]> {
    const root = await mkdtemp(path.join(process.cwd(), ".canvas-export-check-"));
    try {
      const sources: string[] = [];
      for (const file of files) {
        if (!SOURCE_PATTERN.test(file.path) && !file.path.endsWith(".json")) continue;
        const target = path.join(root, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.contents);
        if (SOURCE_PATTERN.test(file.path)) sources.push(target);
      }
      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022, lib: ["lib.dom.d.ts", "lib.es2022.d.ts"], jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true,
        skipLibCheck: true, esModuleInterop: true, isolatedModules: true, resolveJsonModule: true,
        baseUrl: root, paths: { "@/*": ["./*"] }, types: ["react", "node"],
      };
      const program = ts.createProgram(sources, options, ts.createCompilerHost(options, true));
      const diagnostics = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
      return diagnostics.slice(0, 8).map((diagnostic) => ({
        code: "EXPORT_TYPECHECK_FAILED",
        message: "The exported website did not pass its TypeScript check.",
        entity: `${diagnostic.file ? path.relative(root, diagnostic.file.fileName) : "project"}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
      }));
    } finally { await rm(root, { recursive: true, force: true }); }
  }

  /** Real `npm install` + `next build` in a temporary directory. */
  private async fullBuild(files: ExportFile[]): Promise<ExportFailure[]> {
    const directory = await mkdtemp(path.join(tmpdir(), "canvas-export-"));
    try {
      for (const file of files) {
        const target = path.join(directory, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.contents);
      }
      for (const [command, args] of [["npm", ["install", "--no-audit", "--no-fund"]], ["npm", ["run", "build"]]] as const) {
        const result = await run(command, [...args], directory);
        if (result.code !== 0) {
          return [{ code: "EXPORT_BUILD_FAILED", message: "The exported website did not build successfully.", entity: result.output.slice(-1200) }];
        }
      }
      return [];
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}

function run(command: string, args: string[], cwd: string) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", CI: "1" } });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
    child.on("error", (error) => resolve({ code: 1, output: error.message }));
  });
}
