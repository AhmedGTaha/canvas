import type { AIRequest } from "@/domain/ai/provider";
import { validationRepairInstructions } from "@/domain/ai/prompts/operations";
import { repairPromptVersion } from "@/domain/ai/prompts/versions";
import { persistedGenerationDiagnostic } from "./diagnostics";

/** How many repair passes one generation may spend. Transient provider retries are
 *  separate and counted separately: this bound is about invalid candidates only. */
export const MAX_VALIDATION_REPAIR_ATTEMPTS = 2;

/**
 * One bounded model self-correction after Canvas validation rejects a candidate.
 *
 * The rejected candidate and a sanitized diagnostic go back to the same provider and
 * model the project selected, with repair-specific instructions. The invalid candidate is
 * never activated, the diagnostic never carries source or secrets, and the attempt count
 * is capped by the caller so a model that cannot fix its own output stops rather than
 * looping.
 */
export function generatedSourceCorrectionRequest(request: AIRequest, rejectedResponse: string, diagnostic?: string, attempt = 1, maxAttempts = MAX_VALIDATION_REPAIR_ATTEMPTS): AIRequest {
  const reason = persistedGenerationDiagnostic(diagnostic) ?? "generated source did not pass Canvas validation";
  const basePromptVersion = request.requestMetadata?.promptVersion;
  return {
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", parts: [{ type: "text", text: rejectedResponse }] },
      { role: "user", parts: [{ type: "text", text: validationRepairInstructions(reason, attempt, maxAttempts) }] },
    ],
    temperature: 0.1,
    requestMetadata: {
      ...request.requestMetadata,
      ...(basePromptVersion ? { promptVersion: repairPromptVersion(basePromptVersion) } : {}),
      repairAttempt: String(attempt),
    },
  };
}
