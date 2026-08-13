import type { AIRequest } from "@/domain/ai/provider";
import { persistedGenerationDiagnostic } from "./diagnostics";

/** One bounded model self-correction after deterministic source validation rejects. */
export function generatedSourceCorrectionRequest(request: AIRequest, rejectedResponse: string, diagnostic?: string): AIRequest {
  const reason = persistedGenerationDiagnostic(diagnostic) ?? "generated source did not pass Canvas validation";
  return {
    ...request,
    messages: [
      ...request.messages,
      { role: "assistant", parts: [{ type: "text", text: rejectedResponse }] },
      { role: "user", parts: [{ type: "text", text: `The previous candidate was rejected by Canvas: ${reason}. Return one complete corrected structured response. Fix that exact issue, re-check every contract rule, and do not omit requested content.` }] },
    ],
    temperature: 0.1,
  };
}
