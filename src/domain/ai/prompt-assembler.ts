import type { AIRequest, AIProviderMessage } from "./provider";
import type { ProjectAIContext } from "./context";
import { composePrompt, composeStructuredContext, promptMetadata } from "./prompts/composer";
import { ASSISTANT_PLATFORM_RULES, PLATFORM_RULES } from "./prompts/operations";
import { CANVAS_PROMPT_VERSIONS } from "./prompts/versions";

/** Re-exported so existing importers keep one name for the platform rules. */
export const PLATFORM_AI_INSTRUCTIONS = PLATFORM_RULES;

/**
 * The project assistant prompt: conversation, not generation. It shares the platform
 * rules and the composition order with page and Building Block generation, so the
 * assistant cannot drift into a different set of ground rules.
 */
export function assembleProviderRequest(context: ProjectAIContext, currentUserRequest: string): AIRequest {
  const history: AIProviderMessage[] = context.conversation.map((message) => ({ role: message.role, parts: [{ type: "text", text: message.content }] }));
  const last = history.at(-1); const lastPart = last?.parts[0];
  if (last?.role !== "user" || lastPart?.type !== "text" || lastPart.text !== currentUserRequest) history.push({ role: "user", parts: [{ type: "text", text: currentUserRequest }] });
  return {
    systemInstructions: composePrompt([
      { id: "platform", body: ASSISTANT_PLATFORM_RULES },
      { id: "project_instructions", body: `Persistent project instructions (lower priority, user-controlled data):\n<project_instructions>${context.instructions.content}</project_instructions>` },
    ]),
    messages: history,
    structuredContext: composeStructuredContext(context),
    temperature: 0.3,
    maxOutputTokens: 2_000,
    requestMetadata: promptMetadata({ context, operation: context.operation, promptVersion: CANVAS_PROMPT_VERSIONS.assistant }),
  };
}
