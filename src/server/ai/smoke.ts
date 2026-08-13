/**
 * Real Gemini smoke check.
 *
 * Exercises every Canvas AI operation against the live provider and asserts that each
 * result still passes the unchanged Canvas validation pipeline. This makes real,
 * billable API calls; run it only when GEMINI_API_KEY is configured:
 *
 *   npm run test:ai-provider
 */
import { getAIProvider } from "./provider-registry";
import { aiProviderDescriptor, isAIConfigured } from "./config";
import { generatedPageResponseJsonSchema, generatedPageResponseSchema } from "@/domain/page-generation/contract";
import { generatedBlockResponseJsonSchema, generatedBlockResponseSchema } from "@/domain/block-generation/contract";
import { validateGeneratedPageSource } from "@/domain/page-generation/validator";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { compileGeneratedPage } from "@/domain/page-generation/validator";
import { PLATFORM_AI_INSTRUCTIONS } from "@/domain/ai/prompt-assembler";
import type { AIRequest } from "@/domain/ai/provider";

if (!isAIConfigured()) {
  // Not a failure: an unconfigured environment simply skips the paid checks.
  console.log("SKIPPED: GEMINI_API_KEY is not set. Add it to .env to run the real Gemini smoke check.");
  process.exit(0);
}

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";
const ROUTES = new Set(["/", "/contact"]);
const APPROVED_MEDIA = new Set([MEDIA_ID]);

// A 2x2 solid red PNG, standing in for a Canvas Media attachment.
const RED_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z4AATAxIHAAeQwEBpwGqzAAAAABJRU5ErkJggg==", "base64");

const PAGE_RULES = `Return one complete TypeScript React page component as structured JSON. The source must default-export exactly one page component.
Allowed imports: react and @canvas/site-runtime only. Use CanvasImage with approved Media UUIDs; never use remote images or raw img elements.
Use only static className strings from: c-page, c-container, c-section, c-hero, c-stack, c-grid, c-card, c-actions, c-button, c-muted, c-kicker, c-media. Inline style attributes are forbidden.
Anchors may only reference routes listed in the project structure. Never use fetch, network APIs, eval, Function, require, dynamic imports, server APIs, browser storage, cookies, parent-window access, HTML injection, iframe, script, object, or embed.
Give meaningful regions a stable data-canvas-id such as "hero-main" or "pricing-card".
referencedMediaIds must exactly match the CanvasImage mediaId values in the source.`;

const BLOCK_RULES = `${PAGE_RULES}
This is a reusable Building Block, not a page: it may not contain CanvasBlock.`;

type Check = { name: string; run: () => Promise<string> };
const provider = getAIProvider();
const descriptor = aiProviderDescriptor();

function ask(systemInstructions: string, text: string, responseSchema: unknown, extra: Partial<AIRequest> = {}): AIRequest {
  return {
    systemInstructions: `${PLATFORM_AI_INSTRUCTIONS}\n\n${systemInstructions}`,
    messages: [{ role: "user", parts: [{ type: "text", text }] }],
    responseSchema, temperature: 0.2, maxOutputTokens: 8_000, ...extra,
  };
}
async function page(prompt: string, extra: Partial<AIRequest> = {}) {
  const response = await provider.generateStructured(ask(PAGE_RULES, prompt, generatedPageResponseJsonSchema, extra), generatedPageResponseSchema);
  if (!response.structuredData) throw new Error("structured page response was missing");
  const manifest = await validateGeneratedPageSource({
    sourceCode: response.structuredData.sourceCode, approvedMediaIds: APPROVED_MEDIA, activeRoutes: ROUTES,
    declaredMediaIds: response.structuredData.referencedMediaIds,
    availableBlockIds: new Set([BLOCK_ID]), declaredBlockUsages: response.structuredData.blockUsages,
    blockSources: new Map([[BLOCK_ID, `export default function Block(){return <nav data-canvas-id="navbar-root"><a href="/">Home</a></nav>}`]]),
  });
  return { response, manifest, source: response.structuredData.sourceCode };
}
async function block(prompt: string, extra: Partial<AIRequest> = {}) {
  const response = await provider.generateStructured(ask(BLOCK_RULES, prompt, generatedBlockResponseJsonSchema, extra), generatedBlockResponseSchema);
  if (!response.structuredData) throw new Error("structured block response was missing");
  const manifest = await validateGeneratedBlockSource({
    sourceCode: response.structuredData.sourceCode, approvedMediaIds: APPROVED_MEDIA, activeRoutes: ROUTES,
    declaredMediaIds: response.structuredData.referencedMediaIds,
  });
  return { response, manifest, source: response.structuredData.sourceCode };
}
const tokens = (usage?: { totalTokens?: number }) => usage?.totalTokens ? `${usage.totalTokens} tokens` : "usage unreported";

let generatedPageSource = "";
let generatedBlockSource = "";

const checks: Check[] = [
  {
    name: "page generation",
    run: async () => {
      const result = await page("Create the Home page for Acme Tools: a hero with a heading and short paragraph, and a three-item services grid. Include a link to /contact.");
      generatedPageSource = result.source;
      if (!result.manifest.editableElements.length) throw new Error("no selectable regions were generated");
      return `${result.manifest.editableElements.length} selectable regions, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "page modification",
    run: async () => {
      const result = await page(`Modify this page so the hero heading reads "Tools that last". Preserve everything else.\n\n<existing_page_source>\n${generatedPageSource}\n</existing_page_source>`);
      if (!/Tools that last/i.test(result.source)) throw new Error("the requested modification was not applied");
      return `applied, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "Building Block generation",
    run: async () => {
      const result = await block("Create a global navbar Building Block for Acme Tools with links to / and /contact.");
      generatedBlockSource = result.source;
      if (!/<nav/i.test(result.source)) throw new Error("navbar block did not render a nav landmark");
      return `${result.manifest.editableElements.length} selectable regions, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "Building Block modification",
    run: async () => {
      const result = await block(`Modify this Building Block so the Contact link text reads "Talk to us". Preserve everything else.\n\n<existing_block_source>\n${generatedBlockSource}\n</existing_block_source>`);
      if (!/Talk to us/i.test(result.source)) throw new Error("the requested block modification was not applied");
      return `applied, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "targeted element modification",
    run: async () => {
      const targeted = `export default function Page(){return <main className="c-page"><section data-canvas-id="hero-main" className="c-section c-container"><h1>Original hero</h1></section><article data-canvas-id="pricing-card" className="c-card"><p>Spacious pricing details</p></article></main>}`;
      const result = await page(`The user selected the element with data-canvas-id="pricing-card" and asked: "Make this card more compact". Change only that element, keep every other region byte-for-byte identical, keep its data-canvas-id, and set targetCanvasId to "pricing-card".\n\n<existing_page_source>\n${targeted}\n</existing_page_source>`);
      if (result.response.structuredData?.targetCanvasId !== "pricing-card") throw new Error(`targetCanvasId was ${String(result.response.structuredData?.targetCanvasId)}`);
      if (!result.manifest.editableElements.some((element) => element.canvasId === "pricing-card")) throw new Error("the targeted element did not survive");
      if (!result.source.includes("Original hero")) throw new Error("an unrelated region was modified");
      return `target preserved, unrelated regions intact, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "Media-assisted generation",
    run: async () => {
      const result = await page(
        `Create a Home page hero that displays the attached image with CanvasImage using mediaId "${MEDIA_ID}", plus a heading describing its dominant color.`,
        { messages: [{ role: "user", parts: [
          { type: "text", text: `Create a Home page hero that displays the attached image with CanvasImage using mediaId "${MEDIA_ID}", plus a heading naming its dominant color.` },
          { type: "image", mimeType: "image/png", data: new Uint8Array(RED_PNG) },
        ] }] },
      );
      if (!result.manifest.referencedMediaIds.includes(MEDIA_ID)) throw new Error("the attached Media was not used");
      return `Media referenced and validated, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "structured output parsing",
    run: async () => {
      const result = await page("Create a minimal Contact page with a heading and a short paragraph.");
      const data = result.response.structuredData!;
      if (data.schemaVersion !== 1) throw new Error("schemaVersion was not 1");
      if (!data.summary.headline) throw new Error("summary headline was empty");
      return `schemaVersion 1, summary "${data.summary.headline.slice(0, 40)}", ${data.summary.changes.length} change notes`;
    },
  },
  {
    name: "Preview rendering",
    run: async () => {
      const bundle = await compileGeneratedPage(generatedPageSource, []);
      if (!bundle.includes("createRoot")) throw new Error("the compiled Preview bundle is missing its runtime entry");
      return `${(bundle.length / 1024).toFixed(0)} KB Preview bundle compiled`;
    },
  },
];

console.log(`Running real Gemini smoke checks against ${descriptor.provider}/${descriptor.model}\n`);
let failures = 0;
for (const check of checks) {
  const started = Date.now();
  try {
    const detail = await check.run();
    console.log(`  PASS  ${check.name.padEnd(30)} ${detail} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failures += 1;
    const reason = error instanceof Error ? error.message : String(error);
    const diagnostic = (error as { diagnostic?: string }).diagnostic;
    console.error(`  FAIL  ${check.name.padEnd(30)} ${reason}${diagnostic ? ` — ${diagnostic}` : ""}`);
  }
}
console.log(`\n${checks.length - failures}/${checks.length} real Gemini checks passed.`);
process.exit(failures ? 1 : 0);
