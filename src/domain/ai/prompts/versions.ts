/**
 * Prompt revision identifiers.
 *
 * Every generation records the prompt version that produced it, so two revisions can be
 * compared on the same analytics — success rate, repair rate, latency, tokens — instead
 * of on impressions. The identifiers describe the Canvas operation only: they are never
 * tied to Gemini, OpenAI, Anthropic, or any other provider, because the same composed
 * prompt is sent to whichever adapter a project selected.
 *
 * Bump the version whenever the instructions for that operation change in a way that
 * could move output quality.
 */
export const CANVAS_PROMPT_VERSIONS = {
  page_create: "canvas-page-create-v2",
  page_modify: "canvas-page-modify-v2",
  page_element_modify: "canvas-page-element-modify-v2",
  block_create: "canvas-block-create-v2",
  block_modify: "canvas-block-modify-v2",
  block_element_modify: "canvas-block-element-modify-v2",
  assistant: "canvas-assistant-v2",
  validation_repair: "canvas-validation-repair-v2",
  test_console: "canvas-test-console-v1",
} as const;

export type CanvasPromptOperation = keyof typeof CANVAS_PROMPT_VERSIONS;
export type CanvasPromptVersion = (typeof CANVAS_PROMPT_VERSIONS)[CanvasPromptOperation];

/** The prompt revision for one generation, given what it is actually doing. */
export function promptVersionFor(input: { target: "page" | "block"; modifying: boolean; elementScoped: boolean }): CanvasPromptVersion {
  if (input.target === "page") {
    if (input.elementScoped) return CANVAS_PROMPT_VERSIONS.page_element_modify;
    return input.modifying ? CANVAS_PROMPT_VERSIONS.page_modify : CANVAS_PROMPT_VERSIONS.page_create;
  }
  if (input.elementScoped) return CANVAS_PROMPT_VERSIONS.block_element_modify;
  return input.modifying ? CANVAS_PROMPT_VERSIONS.block_modify : CANVAS_PROMPT_VERSIONS.block_create;
}

/** The repair pass is its own revision: it is a different prompt with a different job. */
export function repairPromptVersion(base: string) {
  return `${CANVAS_PROMPT_VERSIONS.validation_repair}+${base}`;
}
