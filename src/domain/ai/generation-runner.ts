import { AIError, type AIProvider, type AIRequest, type AIResponse, type AIUsage, type StructuredValidator } from "./provider";
import { generatedSourceCorrectionRequest, MAX_VALIDATION_REPAIR_ATTEMPTS } from "@/domain/generated-source/correction";

export type ProviderCallRecord = {
  requestKind: "generation" | "repair";
  promptVersion: string;
  succeeded: boolean;
  errorCode?: string;
  usage?: AIUsage;
  providerLatencyMs: number;
  validationDurationMs?: number;
};

/** Records one provider request. Returns the usage row id so the caller can attach the
 *  job duration once the whole job is finished. */
export type ProviderCallRecorder = (record: ProviderCallRecord) => Promise<string | null>;

export type GenerationRunResult<TResponse, TValidated> = {
  response: AIResponse<TResponse>;
  validated: TValidated;
  repairAttempts: number;
  providerLatencyMs: number;
  validationDurationMs: number;
  lastUsageEventId: string | null;
};

/**
 * One structured generation, with a bounded validation repair loop.
 *
 * Both kinds of retry Canvas performs are represented here, and they stay separate:
 * transient provider failures are retried by the durable job (a new attempt of the whole
 * job), while a candidate that fails Canvas validation is repaired in place, at most
 * `maxRepairAttempts` times, using the same project-selected provider and model.
 *
 * The invalid candidate is never activated and never persisted as source; only the
 * sanitized diagnostic travels back to the model.
 */
export async function generateWithRepair<TResponse, TValidated>(input: {
  provider: AIProvider;
  request: AIRequest;
  schema: StructuredValidator<TResponse>;
  validate: (data: TResponse, response: AIResponse<TResponse>) => Promise<TValidated>;
  /** Persists provider metadata for a fresh candidate before it is validated. */
  onCandidate?: (response: AIResponse<TResponse>) => Promise<void>;
  record: ProviderCallRecorder;
  promptVersion: string;
  maxRepairAttempts?: number;
}): Promise<GenerationRunResult<TResponse, TValidated>> {
  const maxRepairAttempts = input.maxRepairAttempts ?? MAX_VALIDATION_REPAIR_ATTEMPTS;
  let request = input.request;
  let repairAttempts = 0;
  let validationDurationMs = 0;

  for (;;) {
    const requestKind = repairAttempts === 0 ? "generation" as const : "repair" as const;
    const promptVersion = (request.requestMetadata?.promptVersion as string | undefined) ?? input.promptVersion;
    const startedAt = performance.now();
    let response: AIResponse<TResponse>;
    try {
      response = await input.provider.generateStructured(request, input.schema);
    } catch (error) {
      const failure = error instanceof AIError ? error : new AIError("AI_INTERNAL_ERROR", "Canvas could not complete this AI request.");
      await input.record({ requestKind, promptVersion, succeeded: false, errorCode: failure.code, providerLatencyMs: Math.round(performance.now() - startedAt) });
      throw error;
    }
    const providerLatencyMs = response.timing?.providerLatencyMs ?? Math.round(performance.now() - startedAt);
    if (!response.structuredData) {
      await input.record({ requestKind, promptVersion, succeeded: false, errorCode: "AI_PROVIDER_INVALID_RESPONSE", usage: response.usage, providerLatencyMs });
      throw new AIError("AI_PROVIDER_INVALID_RESPONSE", "Canvas could not produce a valid result from this request. Try again.");
    }
    await input.onCandidate?.(response);

    const validationStartedAt = performance.now();
    try {
      const validated = await input.validate(response.structuredData, response);
      const validationMs = Math.round(performance.now() - validationStartedAt);
      validationDurationMs += validationMs;
      const usageEventId = await input.record({ requestKind, promptVersion, succeeded: true, usage: response.usage, providerLatencyMs, validationDurationMs: validationMs });
      return { response, validated, repairAttempts, providerLatencyMs, validationDurationMs, lastUsageEventId: usageEventId };
    } catch (error) {
      const validationMs = Math.round(performance.now() - validationStartedAt);
      validationDurationMs += validationMs;
      const repairable = error instanceof AIError && error.code === "AI_GENERATED_SOURCE_INVALID";
      await input.record({ requestKind, promptVersion, succeeded: false, errorCode: error instanceof AIError ? error.code : "AI_INTERNAL_ERROR", usage: response.usage, providerLatencyMs, validationDurationMs: validationMs });
      if (!repairable || repairAttempts >= maxRepairAttempts) throw error;
      repairAttempts += 1;
      request = generatedSourceCorrectionRequest(request, response.text, (error as AIError).diagnostic, repairAttempts, maxRepairAttempts);
    }
  }
}
