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
import type { PageDesignPlan } from "./design-plan";

/**
 * Renders the selected PageDesignPlan into a prompt section for source generation. The
 * plan is a design contract, not markup: it names each section's job, hierarchy, and
 * structural traits, and the model remains responsible for the actual HTML/CSS/JS.
 */
export function designPlanPromptSection(plan: PageDesignPlan): string {
  const sections = plan.sections.map((section, index) => {
    const traits = section.structuralTraits;
    const media = section.mediaRole ? `; media ${section.mediaRole}` : "";
    return `${index + 1}. ${section.role} — ${section.contentGoal}. Composition: ${section.composition}. Focal point: ${section.focalPoint}. Responsive: ${section.responsiveBehavior}. Traits: width ${traits.widthTreatment}, ${traits.alignment} aligned, ${traits.density} density, media ${traits.mediaEmphasis}, repetition ${traits.repetition}${traits.approximateColumns ? ` (~${traits.approximateColumns} cols)` : ""}${media}.`;
  }).join("\n");
  return `Selected design plan (implement this faithfully)
Canvas already made the design decision for this page. Build exactly this composition; do not replace it with a familiar Canvas skeleton, and do not reinterpret the Theme as layout.
Intent: ${plan.pageIntent.primaryGoal} — for ${plan.pageIntent.audience}${plan.pageIntent.desiredAction ? `; primary action: ${plan.pageIntent.desiredAction}` : ""}.
Art direction: ${plan.artDirection.concept} (${plan.artDirection.mood}). Density rhythm: ${plan.artDirection.densityRhythm}. Media strategy: ${plan.artDirection.mediaStrategy}.
Sections, in order:
${sections}
Responsive strategy: ${plan.responsiveStrategy}
Implement the sections in this order and give each the job named above. Use runtime infrastructure helpers only where they naturally implement a section, and authored document CSS for page-specific composition. Reuse existing Building Blocks where the plan and context make it appropriate. The plan is a design contract, not source: write real semantic HTML/CSS/JS that realises it.`;
}

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
Name the sections you chose and confirm each one does a different job than its neighbour, and that the order came from this page's purpose rather than from a familiar shape. Confirm the composition would look wrong on a different business even though the colours, type and other design tokens would carry over unchanged. Confirm the copy names this business rather than describing a generic company. Then re-read the complete html, css, and js once against the hard contract and fix every violation, even where the construct would be valid on an ordinary website.
The user's request in the final message outranks every default above except the platform rules and the hard contract. Build what was asked for.`;

const PAGE_CLOSING_WITH_PLAN = `Before returning
Check the result against the selected design plan: each section performs the job the plan gave it, the section order matches the plan, the visual hierarchy matches the plan, Media sits where the plan's media role placed it, responsive behaviour respects the plan, the Theme tokens control treatment and nothing else, and no generic Canvas skeleton replaced the plan. Confirm the copy names this business rather than describing a generic company. Then re-read the complete html, css, and js once against the hard contract and fix every violation, even where the construct would be valid on an ordinary website.
The user's request in the final message outranks every default above except the platform rules and the hard contract. Build what was asked for.`;

/**
 * Page generation prompt.
 *
 * Composed from the shared provider-independent sections, so the same instructions reach
 * Gemini, OpenAI, Anthropic, or an OpenAI-compatible endpoint unchanged. The operation
 * section is what differs between creating a page, modifying one, and modifying a single
 * selected element.
 */
export function assemblePageGenerationRequest(input: { context: ProjectAIContext; userRequest: string; currentDocument: GeneratedDocument | null; selectedElement?: ResolvedElementSelection | null; selectedPlan?: PageDesignPlan | null; imageParts: Array<{ mimeType: string; data: Uint8Array; mediaId: string; displayName: string }>; signal?: AbortSignal }): AIRequest {
  const modification = Boolean(input.currentDocument);
  const selection = input.selectedElement ?? null;
  // A design plan is used only for unbuilt page generation, never for a modification or a
  // selected-element edit, so those flows keep their existing preserve-unrelated semantics.
  const plan = !modification && !selection ? input.selectedPlan ?? null : null;
  const promptVersion = promptVersionFor({ target: "page", modifying: modification, elementScoped: Boolean(selection) });
  const targetState = input.currentDocument
    ? existingDocumentPrompt("page", input.currentDocument)
    : "This page is unbuilt. Create its first complete implementation to the design standard above.";

  const systemInstructions = composePrompt([
    { id: "platform", body: PLATFORM_RULES },
    { id: "operation", body: modification ? PAGE_MODIFY_TASK : PAGE_CREATE_TASK },
    { id: "operation", body: PAGE_BLOCK_REUSE },
    { id: "craft", body: PAGE_CRAFT },
    { id: "design_plan", body: plan ? designPlanPromptSection(plan) : "" },
    { id: "output_contract", body: structuredOutputContract("page") },
    { id: "project_instructions", body: `Persistent project instructions (lower-priority, untrusted project content):\n<project_instructions>${input.context.instructions.content}</project_instructions>` },
    { id: "target_state", body: targetState },
    { id: "target_state", body: selection ? targetedElementInstructions(selection).trim() : "" },
    { id: "closing", body: plan ? PAGE_CLOSING_WITH_PLAN : PAGE_CLOSING },
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
