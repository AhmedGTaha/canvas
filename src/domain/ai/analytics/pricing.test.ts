import { describe, expect, it } from "vitest";
import { costForRequest, formatCost, pricingFrom, UNAVAILABLE_COST } from "./pricing";

const pricing = { inputPerMillion: 3, outputPerMillion: 15, currency: "USD", version: 2 };

describe("AI cost accounting", () => {
  it("estimates from explicit pricing and records the pricing it used", () => {
    const cost = costForRequest({ inputTokens: 1_000_000, outputTokens: 500_000 }, pricing);
    expect(cost).toMatchObject({ source: "canvas_estimate", amount: 10.5, currency: "USD", pricingInputPerMillion: 3, pricingOutputPerMillion: 15, pricingVersion: 2 });
  });

  it("prefers a provider-reported charge over an estimate", () => {
    const cost = costForRequest({ inputTokens: 1_000, outputTokens: 1_000 }, pricing, { amount: 0.42, currency: "EUR" });
    expect(cost).toMatchObject({ source: "provider_reported", amount: 0.42, currency: "EUR" });
    // A reported charge carries no Canvas pricing snapshot: it was not estimated.
    expect(cost.pricingVersion).toBeNull();
  });

  it("reports unavailable rather than zero when pricing is unknown", () => {
    expect(costForRequest({ inputTokens: 10, outputTokens: 10 }, { inputPerMillion: null, outputPerMillion: null, currency: null, version: 1 })).toEqual(UNAVAILABLE_COST);
    // Half-known pricing would produce a wrong number, so it is not used at all.
    expect(costForRequest({ inputTokens: 10, outputTokens: 10 }, { inputPerMillion: 3, outputPerMillion: null, currency: "USD", version: 1 })).toEqual(UNAVAILABLE_COST);
  });

  it("reports unavailable when the provider did not report token usage", () => {
    expect(costForRequest(undefined, pricing)).toEqual(UNAVAILABLE_COST);
    expect(costForRequest({ totalTokens: 40 }, pricing)).toEqual(UNAVAILABLE_COST);
  });

  it("reads pricing off a stored model row, including unset pricing", () => {
    expect(pricingFrom({ inputPricePerMillion: "3.000000", outputPricePerMillion: "15.000000", pricingCurrency: "USD", pricingVersion: 4 }))
      .toEqual({ inputPerMillion: 3, outputPerMillion: 15, currency: "USD", version: 4 });
    expect(pricingFrom({ inputPricePerMillion: null, outputPricePerMillion: null, pricingCurrency: null, pricingVersion: 1 }))
      .toMatchObject({ inputPerMillion: null, outputPerMillion: null });
  });

  it("never displays an unknown cost as a number", () => {
    expect(formatCost(null, null)).toBe("Unavailable");
    expect(formatCost(0.000004, "USD")).toBe("< 0.01 USD");
    expect(formatCost(12.5, "USD")).toBe("12.50 USD");
  });
});
