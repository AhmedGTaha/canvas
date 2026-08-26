import type { AIRequest, AIProviderMessage } from "@/domain/ai/provider";
import type { ProjectAIContext } from "@/domain/ai/context";

/**
 * Provider-independent prompt composition.
 *
 * A Canvas prompt is assembled from labelled sections in one fixed order, and the same
 * composed prompt is handed to whichever adapter the project selected. Adapters decide
 * how to transport it — a system instruction, a developer message, a tool schema — but
 * never what it says.
 *
 * The order is deliberate. Platform rules lead, because nothing below may override them.
 * Project-controlled data follows, clearly framed as untrusted. The target's current
 * state comes late, and the closing anchor comes last so the model reads what it must do
 * immediately before it starts writing.
 */
export const PROMPT_SECTION_ORDER = [
  "platform",            // 1. platform, security, and technical constraints
  "operation",           // 2. what this request is: create, modify, scope of change
  "craft",               //    the design and copy standard for generated output
  "design_plan",         //    the selected PageDesignPlan this source must implement
  "output_contract",     // 10. what a valid structured response must contain
  "project_instructions",// 3. persistent project instructions (untrusted)
  "design_system",       // 4. brand, theme, and design system notes
  "reusable_sections",   // 5. global and reusable sections available for reuse
  "site_structure",      // 6. page tree, routes, navigation notes
  "target_state",        // 7. the current source or state of the target
  "media",               // 8. relevant media notes
  "conversation",        // 9. relevant recent conversation notes
  "closing",             //    re-anchor: the user's request outranks the defaults
] as const;

export type PromptSectionId = (typeof PROMPT_SECTION_ORDER)[number];
export type PromptSection = { id: PromptSectionId; body: string };

/**
 * Renders the sections that have content, in canonical order. Empty sections are omitted
 * rather than sent as empty headings: context stays minimal and relevant.
 */
export function composePrompt(sections: Array<PromptSection | null | undefined>): string {
  const byId = new Map<PromptSectionId, string[]>();
  for (const section of sections) {
    if (!section?.body.trim()) continue;
    const existing = byId.get(section.id) ?? [];
    existing.push(section.body.trim());
    byId.set(section.id, existing);
  }
  return PROMPT_SECTION_ORDER.flatMap((id) => byId.get(id) ?? []).join("\n\n");
}

/**
 * The data half of a prompt: everything that is project content rather than instruction.
 *
 * It travels as one structured payload the adapter passes through verbatim, so no
 * provider-specific serialization decision leaks into what the model is told. Only the
 * slices a request actually needs are included — the whole project is never dumped in.
 */
export function composeStructuredContext(context: ProjectAIContext, extras: Record<string, unknown> = {}) {
  return {
    project: context.project,
    brand: context.brand,
    theme: context.theme,
    structure: context.structure,
    target: context.target,
    existingBuildingBlocks: context.blocks,
    approvedMedia: context.media,
    constraints: context.constraints,
    ...extras,
  };
}

/** Recent conversation as provider messages, excluding the request being answered. */
export function priorConversation(context: ProjectAIContext, options: { dropLast?: boolean } = {}): AIProviderMessage[] {
  const messages = options.dropLast === false ? context.conversation : context.conversation.slice(0, -1);
  return messages.map((message) => ({ role: message.role, parts: [{ type: "text" as const, text: message.content }] }));
}

/** Request metadata every Canvas provider call carries. Never includes credentials. */
export function promptMetadata(input: { context: ProjectAIContext; operation: string; promptVersion: string }): AIRequest["requestMetadata"] {
  return { contextFingerprint: input.context.fingerprint, operation: input.operation, promptVersion: input.promptVersion };
}
