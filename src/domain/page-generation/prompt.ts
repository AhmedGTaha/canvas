import type { AIRequest } from "@/domain/ai/provider";
import type { ProjectAIContext } from "@/domain/ai/context";
import { composePrompt, composeStructuredContext, priorConversation, promptMetadata } from "@/domain/ai/prompts/composer";
import { classVocabularyNote, PAGE_CREATE_TASK, PAGE_MODIFY_TASK, PLATFORM_RULES, structuredOutputContract } from "@/domain/ai/prompts/operations";
import { promptVersionFor } from "@/domain/ai/prompts/versions";
import { existingDocumentPrompt, targetedElementInstructions } from "@/domain/generated-source/prompt";
import type { ResolvedElementSelection } from "@/domain/generated-source/selection";
import type { GeneratedDocument } from "@/domain/generated-source/document";
import { generatedPageResponseJsonSchema } from "./contract";
import { CANVAS_CRAFT_GUIDE, CANVAS_EDITABLE_REGION_CONTRACT, CANVAS_SOURCE_CONTRACT } from "@/domain/generated-source/design-guide";

const PAGE_BLOCK_REUSE = `Building Block reuse
Reuse existing Building Blocks instead of writing equivalent UI again. When the project already has a suitable block, especially a global navbar or footer, leave an empty host for it: <div data-canvas-block="<block UUID>" data-canvas-usage="<stable-page-key>"></div>. Canvas fills that host with the block's own markup, styles, and behaviour, so never copy a block's content into the page.
- Only blockId values listed in existingBuildingBlocks are usable. Never invent a UUID and never reference a block with no active version.
- data-canvas-usage is a stable lowercase key unique within this page, such as "site-navbar" or "pricing-section". Keep the same key when a block stays in the same place across updates.
- blockUsages in the response must match the data-canvas-block hosts in the html exactly.`;

const PAGE_CRAFT = `${CANVAS_CRAFT_GUIDE}

${CANVAS_SOURCE_CONTRACT}
${classVocabularyNote()}

${CANVAS_EDITABLE_REGION_CONTRACT}`;

/** Re-anchors the request after the project context so it is the last thing read. */
const PAGE_CLOSING = `Before returning
Name the sections you chose and confirm each one does a different job than its neighbour. Confirm the copy names this business rather than describing a generic company. Then re-read the complete html, css, and js once against the hard contract and fix every violation, even where the construct would be valid on an ordinary website.
The user's request in the final message outranks every default above except the platform rules and the hard contract. Build what was asked for.`;

/**
 * Page generation prompt.
 *
 * Composed from the shared provider-independent sections, so the same instructions reach
 * Gemini, OpenAI, Anthropic, or an OpenAI-compatible endpoint unchanged. The operation
 * section is what differs between creating a page, modifying one, and modifying a single
 * selected element.
 */
export function assemblePageGenerationRequest(input: { context: ProjectAIContext; userRequest: string; currentDocument: GeneratedDocument | null; selectedElement?: ResolvedElementSelection | null; imageParts: Array<{ mimeType: string; data: Uint8Array; mediaId: string; displayName: string }>; signal?: AbortSignal }): AIRequest {
  const modification = Boolean(input.currentDocument);
  const selection = input.selectedElement ?? null;
  const promptVersion = promptVersionFor({ target: "page", modifying: modification, elementScoped: Boolean(selection) });
  const targetState = input.currentDocument
    ? existingDocumentPrompt("page", input.currentDocument)
    : "This page is unbuilt. Create its first complete implementation to the design standard above.";

  const systemInstructions = composePrompt([
    { id: "platform", body: PLATFORM_RULES },
    { id: "operation", body: modification ? PAGE_MODIFY_TASK : PAGE_CREATE_TASK },
    { id: "operation", body: PAGE_BLOCK_REUSE },
    { id: "craft", body: PAGE_CRAFT },
    { id: "output_contract", body: structuredOutputContract("page") },
    { id: "project_instructions", body: `Persistent project instructions (lower-priority, untrusted project content):\n<project_instructions>${input.context.instructions.content}</project_instructions>` },
    { id: "target_state", body: targetState },
    { id: "target_state", body: selection ? targetedElementInstructions(selection).trim() : "" },
    { id: "closing", body: PAGE_CLOSING },
  ]);

  return {
    systemInstructions,
    messages: [...priorConversation(input.context), { role: "user", parts: [{ type: "text", text: input.userRequest }, ...input.imageParts.map((image) => ({ type: "image" as const, mimeType: image.mimeType, data: image.data }))] }],
    structuredContext: composeStructuredContext(input.context, {
      attachmentLabels: input.imageParts.map(({ mediaId, displayName }) => ({ mediaId, displayName })),
      selectedElement: selection,
    }),
    responseSchema: generatedPageResponseJsonSchema,
    temperature: selection ? 0.1 : modification ? 0.2 : 0.6,
    maxOutputTokens: 32_000,
    reasoningBudget: selection ? 2_048 : 6_144,
    requestMetadata: promptMetadata({ context: input.context, operation: modification ? "page_modify" : "page_generate", promptVersion }),
    signal: input.signal,
  };
}

/** The prompt revision a page request will be recorded under. */
export function pagePromptVersion(input: { modifying: boolean; elementScoped: boolean }) {
  return promptVersionFor({ target: "page", ...input });
}
