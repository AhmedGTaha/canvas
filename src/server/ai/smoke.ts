import { getAIProvider } from "./provider-registry";
import { generatedPageResponseJsonSchema, generatedPageResponseSchema } from "@/domain/page-generation/contract";
import { validateGeneratedPageSource } from "@/domain/page-generation/validator";

const provider = getAIProvider();
const response = await provider.generateStructured({ systemInstructions: "Return the requested small frontend-only React page in the response schema. Use no imports or inline styles.", messages: [{ role: "user", parts: [{ type: "text", text: "Create a page whose default component renders <main className=\"c-page\"><h1>Canvas AI ready</h1></main>. Use no Media." }] }], responseSchema: generatedPageResponseJsonSchema, maxOutputTokens: 500, temperature: 0 }, generatedPageResponseSchema);
if (!response.structuredData) throw new Error("Structured page response was missing.");
await validateGeneratedPageSource({ sourceCode: response.structuredData.sourceCode, approvedMediaIds: new Set(), activeRoutes: new Set(["/"]), declaredMediaIds: response.structuredData.referencedMediaIds });
console.log(`${response.provider}/${response.model}: structured page validated`);
