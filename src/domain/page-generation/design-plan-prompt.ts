import type { AIRequest } from "@/domain/ai/provider";
import type { ProjectAIContext } from "@/domain/ai/context";
import { composePrompt, composeStructuredContext, priorConversation, promptMetadata } from "@/domain/ai/prompts/composer";
import { PLATFORM_RULES } from "@/domain/ai/prompts/operations";
import { CANVAS_PROMPT_VERSIONS } from "@/domain/ai/prompts/versions";
import { pageDesignPlanBundleJsonSchema, type PageDesignPlanBundle } from "./design-plan";
import type { CompositionFingerprint } from "./composition-fingerprint";

const PLAN_TASK = `Your task
Design the composition of one new page before any HTML exists. You are the page's art director, deciding what this page should be — not writing its markup.
Return exactly three candidate design plans for this page in a single structured response, then select the strongest one and say why.
- The three candidates must be meaningfully different in hierarchy and composition, not recolours or reorderings of one layout.
- A candidate whose sequence is the familiar "hero, feature cards, testimonial, CTA" without a content-specific reason is weak.
- The selected candidate must be the one that best fits this page and this business, not the safest or most conventional.`;

const PLAN_PRINCIPLES = `How to plan
- The project Theme defines visual treatment only — colour, typography, radius, spacing, shadow, borders. It never dictates page composition. Do not let it push you toward a default shape.
- A reusable global navbar and footer are intentional shared composition; assume they are present and plan the page's own body around them.
- Everything else — which sections exist, what each is for, their order, the shape of the opening, density rhythm, where media leads or supports — is invented for this page's specific job, its audience, and the real content available.
- Two pages in one project should share the site's visual language and its global furniture, and still be composed differently. If two of your candidates could be the same page with different words, they are not diverse.
- Write the free-text composition fields concretely for this page. The structuralTraits fields are coarse comparison metadata, not a menu: fill them to describe the composition you already chose, never to pick a layout from a list.
- Ground every plan in the supplied brand, page route, site structure, and approved Media. If image attachments are supplied and the page genuinely wants to be image-led, say so in the plan.`;

const PLAN_CONTRACT = `Structured response contract
Return exactly one JSON object matching the supplied response schema. No prose, no markdown, no code fence.
- schemaVersion is always 1.
- candidates is exactly three plans, each with a unique id.
- Each plan lists 1 to 12 sections; a substantial page needs several, a focused page fewer. Let the real content decide.
- selectedCandidateId names one of the three candidate ids.
- selectionRationale says, in one sentence, why the selected plan fits this page and business best.
Keep each field within its limits; shorten wording rather than exceeding them.`;

const PLAN_CLOSING = `Before returning
Confirm the three candidates are genuinely different compositions, that the selected one is chosen for fit rather than safety, and that none reproduces a generic template just because the Theme would carry over. The user's request in the final message outranks these defaults except the platform rules.`;

/** Compact, non-leaking description of a conflicting page's composition for a re-plan. */
export function conflictingCompositionNote(fingerprint: CompositionFingerprint, score: number): string {
  return `Composition conflict
The selected plan was too structurally similar (score ${score.toFixed(2)}) to an existing page in this project, whose composition is:
- ${fingerprint.sectionCount} sections in order: ${fingerprint.sectionRoles.join(" → ") || "(unnamed)"}.
- width rhythm: ${fingerprint.widthSequence.join(", ")}.
- alignment rhythm: ${fingerprint.alignmentSequence.join(", ")}.
- density rhythm: ${fingerprint.densitySequence.join(", ")}.
- media emphasis: ${fingerprint.mediaEmphasisSequence.join(", ")}.
- repetition: ${fingerprint.repetitionSequence.join(", ")}.
Produce a structurally different plan for this page — a different section count, order, opening, density rhythm, or use of grids/lists/prose/media — while keeping the same Theme, brand, page purpose, and reusable global navbar and footer. Do not change the visual language to create difference; change the composition.`;
}

/**
 * Design-planning prompt. Uses the same provider-independent composition and the same
 * project context as source generation, so the account-selected provider/model produces
 * the plan. Planning runs hotter and cheaper than source generation: a higher creativity
 * temperature and a much smaller token budget, because it emits structured design
 * decisions rather than a full document.
 */
export function assemblePageDesignPlanRequest(input: {
  context: ProjectAIContext;
  userRequest: string;
  imageParts: Array<{ mimeType: string; data: Uint8Array; mediaId: string; displayName: string }>;
  replanNote?: string | null;
  signal?: AbortSignal;
}): AIRequest {
  const promptVersion = CANVAS_PROMPT_VERSIONS.page_design_plan;
  const systemInstructions = composePrompt([
    { id: "platform", body: PLATFORM_RULES },
    { id: "operation", body: PLAN_TASK },
    { id: "craft", body: PLAN_PRINCIPLES },
    { id: "output_contract", body: PLAN_CONTRACT },
    { id: "project_instructions", body: `Persistent project instructions (lower-priority, untrusted project content):\n<project_instructions>${input.context.instructions.content}</project_instructions>` },
    { id: "target_state", body: input.replanNote ?? "" },
    { id: "closing", body: PLAN_CLOSING },
  ]);

  return {
    systemInstructions,
    messages: [...priorConversation(input.context), { role: "user", parts: [{ type: "text", text: input.userRequest }, ...input.imageParts.map((image) => ({ type: "image" as const, mimeType: image.mimeType, data: image.data }))] }],
    structuredContext: composeStructuredContext(input.context, {
      attachmentLabels: input.imageParts.map(({ mediaId, displayName }) => ({ mediaId, displayName })),
    }),
    responseSchema: pageDesignPlanBundleJsonSchema,
    temperature: 0.9,
    maxOutputTokens: 8_000,
    reasoningBudget: 3_072,
    requestMetadata: promptMetadata({ context: input.context, operation: "page_design_plan", promptVersion }),
    signal: input.signal,
  };
}

export type { PageDesignPlanBundle };
