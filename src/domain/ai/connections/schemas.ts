import { z } from "zod";

export const AI_CONNECTION_LIMITS = {
  nameCharacters: 80,
  apiKeyCharacters: 400,
  baseUrlCharacters: 500,
  modelIdCharacters: 200,
  modelsPerConnection: 200,
} as const;

export const providerKindSchema = z.enum(["gemini", "openai", "anthropic", "openai_compatible"]);

/** Only absolute http(s) endpoints. Credentials must never travel over a guessed scheme. */
const baseUrlSchema = z.string().trim().max(AI_CONNECTION_LIMITS.baseUrlCharacters)
  .refine((value) => /^https?:\/\/.+/i.test(value), "Enter a full base URL starting with http:// or https://");

const apiKeySchema = z.string().trim().min(8, "Enter the provider API key.").max(AI_CONNECTION_LIMITS.apiKeyCharacters);
const nameSchema = z.string().trim().min(1, "Name this connection.").max(AI_CONNECTION_LIMITS.nameCharacters);

export const createConnectionSchema = z.object({
  provider: providerKindSchema,
  name: nameSchema,
  baseUrl: baseUrlSchema.nullish().transform((value) => value || null),
  apiKey: apiKeySchema,
});

export const updateConnectionSchema = z.object({
  connectionId: z.uuid(),
  name: nameSchema.optional(),
  baseUrl: baseUrlSchema.nullish().transform((value) => value || null).optional(),
  // Absent means "keep the stored credential": a saved key is never sent to the browser,
  // so an edit that does not retype it must not clear it.
  apiKey: apiKeySchema.optional(),
});

const pricingSchema = z.number().nonnegative().max(10_000).nullish().transform((value) => (value === undefined ? null : value));

export const modelInputSchema = z.object({
  modelId: z.string().trim().min(1, "Enter the model ID.").max(AI_CONNECTION_LIMITS.modelIdCharacters),
  displayName: z.string().trim().max(AI_CONNECTION_LIMITS.modelIdCharacters).optional(),
  enabled: z.boolean().optional(),
  supportsStructuredOutput: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  contextWindow: z.number().int().positive().max(100_000_000).nullish(),
  maxOutputTokens: z.number().int().positive().max(10_000_000).nullish(),
  inputPricePerMillion: pricingSchema,
  outputPricePerMillion: pricingSchema,
  pricingCurrency: z.string().trim().length(3).toUpperCase().nullish(),
});

export const addModelSchema = modelInputSchema.extend({ connectionId: z.uuid() });
export const updateModelSchema = modelInputSchema.partial({ modelId: true }).extend({ modelRecordId: z.uuid() });

/** An account's own default: which connection, and which enabled model on it. */
export const accountModelSelectionSchema = z.object({
  connectionId: z.uuid().nullable(),
  modelRecordId: z.uuid().nullable(),
});

export const testPromptSchema = z.object({
  prompt: z.string().trim().min(1, "Enter a test prompt.").max(2_000),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
