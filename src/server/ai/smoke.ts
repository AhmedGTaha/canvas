/**
 * Real provider smoke check.
 *
 * Exercises every Canvas AI operation against a live provider and asserts that each
 * result still passes the unchanged Canvas validation pipeline. It is deliberately
 * independent of workspace connections: it never reads or decrypts a stored credential,
 * and takes an opt-in credential from the environment instead, so running it can never
 * spend a workspace's key by accident. It makes real, billable API calls:
 *
 *   SMOKE_AI_PROVIDER=openai SMOKE_AI_API_KEY=... SMOKE_AI_MODEL=gpt-5 npm run test:ai-provider
 */
import { createProvider, providerTimeoutMs, PROVIDER_DESCRIPTORS } from "./provider-registry";
import type { AIProviderKind } from "@/domain/ai/provider";
import { generatedPageResponseJsonSchema, generatedPageResponseSchema } from "@/domain/page-generation/contract";
import { generatedBlockResponseJsonSchema, generatedBlockResponseSchema } from "@/domain/block-generation/contract";
import { validateGeneratedPageDocument } from "@/domain/page-generation/validator";
import { validateGeneratedBlockDocument } from "@/domain/blocks/validation";
import { pageDocumentFrom } from "@/domain/page-generation/contract";
import { blockDocumentFrom } from "@/domain/block-generation/contract";
import { composeDocument } from "@/domain/generated-source/composition";
import { PLATFORM_AI_INSTRUCTIONS } from "@/domain/ai/prompt-assembler";
import type { AIRequest } from "@/domain/ai/provider";

const providerKind = (process.env.SMOKE_AI_PROVIDER ?? "gemini") as AIProviderKind;
const apiKey = process.env.SMOKE_AI_API_KEY?.trim();
const model = process.env.SMOKE_AI_MODEL?.trim();
if (!PROVIDER_DESCRIPTORS[providerKind]) {
  console.error(`SMOKE_AI_PROVIDER must be one of: ${Object.keys(PROVIDER_DESCRIPTORS).join(", ")}`);
  process.exit(1);
}
if (!apiKey || !model) {
  // Not a failure: an environment without an opt-in credential simply skips paid checks.
  console.log("SKIPPED: set SMOKE_AI_PROVIDER, SMOKE_AI_API_KEY and SMOKE_AI_MODEL to run the real provider smoke check.");
  process.exit(0);
}

const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";
const ROUTES = new Set(["/", "/contact"]);
const APPROVED_MEDIA = new Set([MEDIA_ID]);

// A 2x2 solid red PNG, standing in for a Canvas Media attachment.
const RED_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEUlEQVR4nGP8z4AATAxIHAAeQwEBpwGqzAAAAABJRU5ErkJggg==", "base64");

const PAGE_RULES = `Return one complete static page as structured JSON: html (a body fragment), css, js, and metadata.
The html may not contain html, head, body, style, script, link, iframe, svg, or template elements, style attributes, or on* handlers.
Images are <img data-canvas-media="<approved Media UUID>" alt="..."> with no src attribute. Reusable sections are empty <div data-canvas-block="<uuid>" data-canvas-usage="<key>"></div> hosts.
Build on these Canvas classes: c-page, c-container, c-section, c-hero, c-stack, c-grid, c-card, c-actions, c-button, c-muted, c-kicker, c-media. Anything else you use must be styled in css.
Anchors may only reference routes listed in the project structure. The js may not use fetch, eval, Function, storage, cookies, window, parent, location, innerHTML, document.write, or any data-canvas attribute.
Give meaningful regions a stable data-canvas-id such as "hero-main" or "pricing-card".
referencedMediaIds must exactly match the data-canvas-media values in the html.`;

const BLOCK_RULES = `${PAGE_RULES}
This is a reusable Building Block, not a page: it has no metadata and may not contain a data-canvas-block host.`;

type Check = { name: string; run: () => Promise<string> };
const provider = createProvider({
  provider: providerKind, apiKey, model, baseUrl: process.env.SMOKE_AI_BASE_URL ?? null,
  capabilities: { structuredOutput: true, vision: true }, timeoutMs: providerTimeoutMs(),
});

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
  const { manifest, document } = validateGeneratedPageDocument({
    document: pageDocumentFrom(response.structuredData), approvedMediaIds: APPROVED_MEDIA, activeRoutes: ROUTES,
    declaredMediaIds: response.structuredData.referencedMediaIds,
    availableBlockIds: new Set([BLOCK_ID]), declaredBlockUsages: response.structuredData.blockUsages,
  });
  return { response, manifest, document, source: document.html };
}
async function block(prompt: string, extra: Partial<AIRequest> = {}) {
  const response = await provider.generateStructured(ask(BLOCK_RULES, prompt, generatedBlockResponseJsonSchema, extra), generatedBlockResponseSchema);
  if (!response.structuredData) throw new Error("structured block response was missing");
  const { manifest, document } = validateGeneratedBlockDocument({
    document: blockDocumentFrom(response.structuredData), approvedMediaIds: APPROVED_MEDIA, activeRoutes: ROUTES,
    declaredMediaIds: response.structuredData.referencedMediaIds,
  });
  return { response, manifest, document, source: document.html };
}
const tokens = (usage?: { totalTokens?: number }) => usage?.totalTokens ? `${usage.totalTokens} tokens` : "usage unreported";

let generatedPageDocument = { schemaVersion: 1 as const, html: "", css: "", js: "", metadata: null };
let generatedBlockHtml = "";

const checks: Check[] = [
  {
    name: "page generation",
    run: async () => {
      const result = await page("Create the Home page for Acme Tools: a hero with a heading and short paragraph, and a three-item services grid. Include a link to /contact.");
      generatedPageDocument = { ...result.document, metadata: null };
      if (!result.manifest.editableElements.length) throw new Error("no selectable regions were generated");
      return `${result.manifest.editableElements.length} selectable regions, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "page modification",
    run: async () => {
      const result = await page(`Modify this page so the hero heading reads "Tools that last". Preserve everything else.\n\n<existing_html>\n${generatedPageDocument.html}\n</existing_html>`);
      if (!/Tools that last/i.test(result.source)) throw new Error("the requested modification was not applied");
      return `applied, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "Building Block generation",
    run: async () => {
      const result = await block("Create a global navbar Building Block for Acme Tools with links to / and /contact.");
      generatedBlockHtml = result.source;
      if (!/<nav/i.test(result.source)) throw new Error("navbar block did not render a nav landmark");
      return `${result.manifest.editableElements.length} selectable regions, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "Building Block modification",
    run: async () => {
      const result = await block(`Modify this Building Block so the Contact link text reads "Talk to us". Preserve everything else.\n\n<existing_html>\n${generatedBlockHtml}\n</existing_html>`);
      if (!/Talk to us/i.test(result.source)) throw new Error("the requested block modification was not applied");
      return `applied, ${tokens(result.response.usage)}`;
    },
  },
  {
    name: "targeted element modification",
    run: async () => {
      const targeted = `<main class="c-page"><section data-canvas-id="hero-main" class="c-section c-container"><h1>Original hero</h1></section><article data-canvas-id="pricing-card" class="c-card"><p>Spacious pricing details</p></article></main>`;
      const result = await page(`The user selected the element with data-canvas-id="pricing-card" and asked: "Make this card more compact". Change only that element, keep every other region byte-for-byte identical, keep its data-canvas-id, and set targetCanvasId to "pricing-card".\n\n<existing_html>\n${targeted}\n</existing_html>`);
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
      const composed = composeDocument({
        document: generatedPageDocument,
        media: () => ({ url: `/api/preview/media/${MEDIA_ID}`, width: 2, height: 2, altText: null }),
        mode: "preview",
      });
      if (!composed.html.includes("data-canvas-id")) throw new Error("the composed Preview document has no selectable regions");
      return `${(composed.html.length / 1024).toFixed(1)} KB of Preview markup composed`;
    },
  },
];

console.log(`Running real provider smoke checks against ${providerKind}/${model}\n`);
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
console.log(`\n${checks.length - failures}/${checks.length} real provider checks passed.`);
process.exit(failures ? 1 : 0);
