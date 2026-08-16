import type { AIUsage, AIReportedCost } from "@/domain/ai/provider";

/**
 * Cost, honestly.
 *
 * Canvas distinguishes three states and never conflates them: a cost the provider itself
 * reported, a Canvas estimate computed from explicit model pricing metadata, and
 * unavailable. Unknown pricing is never treated as zero, and an estimate is never
 * labelled exact.
 */
export type ModelPricing = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  currency: string | null;
  version: number;
};

export type CostRecord = {
  source: "provider_reported" | "canvas_estimate" | null;
  amount: number | null;
  currency: string | null;
  /** Pricing the amount was computed from, stored so history never re-prices itself. */
  pricingInputPerMillion: number | null;
  pricingOutputPerMillion: number | null;
  pricingVersion: number | null;
};

export const UNAVAILABLE_COST: CostRecord = { source: null, amount: null, currency: null, pricingInputPerMillion: null, pricingOutputPerMillion: null, pricingVersion: null };

export function pricingFrom(model: { inputPricePerMillion: string | number | null; outputPricePerMillion: string | number | null; pricingCurrency: string | null; pricingVersion: number }): ModelPricing {
  const number = (value: string | number | null) => (value === null || value === "" ? null : Number(value));
  return { inputPerMillion: number(model.inputPricePerMillion), outputPerMillion: number(model.outputPricePerMillion), currency: model.pricingCurrency, version: model.pricingVersion };
}

/**
 * Costs one request. A provider-reported charge always wins. Otherwise both prices and
 * both token counts must be known: a half-priced estimate would be a fabricated number.
 */
export function costForRequest(usage: AIUsage | undefined, pricing: ModelPricing, reported?: AIReportedCost): CostRecord {
  if (reported && Number.isFinite(reported.amount)) {
    return { source: "provider_reported", amount: reported.amount, currency: reported.currency, pricingInputPerMillion: null, pricingOutputPerMillion: null, pricingVersion: null };
  }
  const { inputPerMillion, outputPerMillion } = pricing;
  if (inputPerMillion === null || outputPerMillion === null) return UNAVAILABLE_COST;
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return UNAVAILABLE_COST;
  const amount = (inputTokens / 1_000_000) * inputPerMillion + (outputTokens / 1_000_000) * outputPerMillion;
  return {
    source: "canvas_estimate",
    amount: Number(amount.toFixed(8)),
    currency: pricing.currency ?? "USD",
    pricingInputPerMillion: inputPerMillion,
    pricingOutputPerMillion: outputPerMillion,
    pricingVersion: pricing.version,
  };
}

/** Formats a cost for display. Unavailable stays unavailable — never `0`. */
export function formatCost(amount: number | null, currency: string | null) {
  if (amount === null) return "Unavailable";
  const unit = currency ?? "USD";
  if (amount > 0 && amount < 0.01) return `< 0.01 ${unit}`;
  return `${amount.toFixed(amount < 1 ? 4 : 2)} ${unit}`;
}
