import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, userAISettings } from "@/server/db/schema";
import { encryptCredential, credentialHint } from "@/server/security/credential-cipher";
import type { AIProvider, AIProviderKind, AIRequest, AIResponse, ModelCapabilities, StructuredValidator } from "@/domain/ai/provider";
import type { ResolvedActorModel } from "@/domain/ai/connections/model-resolution";
import { pageDesignPlanBundleJsonSchema, DESIGN_PLAN_SCHEMA_VERSION } from "@/domain/page-generation/design-plan";

/**
 * Test support for the BYOK path.
 *
 * Suites that exercise generation still need a real, selected account connection, because
 * that is what production does. This creates one for a given person — encrypted with the
 * same cipher, selected through the same table — and hands back a resolver that uses a
 * fake adapter instead of a real provider call. Nothing here is imported by application
 * code.
 */
export const FIXTURE_API_KEY = "test-fixture-api-key-0000";

export async function ensureFixtureConnection(actorUserId: string, database: Database = db, options: {
  provider?: AIProviderKind;
  modelId?: string;
  capabilities?: Partial<ModelCapabilities>;
  pricing?: { input: number; output: number; currency?: string };
} = {}) {
  const provider = options.provider ?? "gemini";
  const modelId = options.modelId ?? "fixture-model";

  const [existing] = await database.select().from(aiConnections)
    .where(and(eq(aiConnections.userId, actorUserId), isNull(aiConnections.deletedAt))).limit(1);
  let connection = existing;
  if (!connection) {
    const [created] = await database.insert(aiConnections).values({
      userId: actorUserId, provider, name: `Fixture ${provider}`,
      credentialCiphertext: "", credentialHint: credentialHint(FIXTURE_API_KEY), createdByUserId: actorUserId,
    }).returning();
    const ciphertext = encryptCredential(FIXTURE_API_KEY, { connectionId: created!.id, userId: actorUserId });
    [connection] = await database.update(aiConnections).set({ credentialCiphertext: ciphertext }).where(eq(aiConnections.id, created!.id)).returning();
  }

  const [model] = await database.insert(aiConnectionModels).values({
    connectionId: connection!.id, userId: actorUserId, modelId, displayName: modelId, source: "manual", enabled: true,
    supportsStructuredOutput: options.capabilities?.structuredOutput ?? true,
    supportsVision: options.capabilities?.vision ?? true,
    inputPricePerMillion: options.pricing ? options.pricing.input.toFixed(6) : null,
    outputPricePerMillion: options.pricing ? options.pricing.output.toFixed(6) : null,
    pricingCurrency: options.pricing ? options.pricing.currency ?? "USD" : null,
  }).onConflictDoUpdate({
    target: [aiConnectionModels.connectionId, aiConnectionModels.modelId],
    set: { enabled: true },
  }).returning();

  await database.insert(userAISettings).values({ userId: actorUserId, connectionId: connection!.id, modelId: model!.id })
    .onConflictDoUpdate({ target: userAISettings.userId, set: { connectionId: connection!.id, modelId: model!.id, updatedAt: new Date() } });

  return { connection: connection!, model: model! };
}

/**
 * Design-planning happens before source generation for an unbuilt page, as its own
 * provider call with the plan-bundle schema. A test's fixture provider only knows how to
 * return a page document, so this wrapper answers the planning call for it with a valid,
 * diverse, conformance-safe bundle and delegates every other call to the inner provider.
 *
 * The selected candidate is deliberately conservative — three sections and no dominant
 * Media — so the deterministic conformance check passes against a fixture document that has
 * no images and few editable regions. A per-call counter varies the selected plan's
 * composition so successive pages in one project never collide on the similarity gate.
 */
let planCallCounter = 0;

function fixturePlanBundleValue(n: number) {
  const widths = ["contained", "full_bleed", "mixed"] as const;
  const aligns = ["left", "center", "asymmetric"] as const;
  const densities = ["balanced", "airy", "compact"] as const;
  const safeMedia = ["none", "supporting", "background"] as const;
  const reps = ["none", "list", "sequence"] as const;
  const makeSection = (candidate: number, count: number) => Array.from({ length: count }, (_, j) => ({
    id: `s${candidate}-${j}`,
    role: `role-${n}-${candidate}-${j}`,
    contentGoal: "explain one thing this page must convey",
    composition: `a section composed for call ${n}, candidate ${candidate}, position ${j}`,
    focalPoint: "the section heading",
    responsiveBehavior: "stacks to a single column on small screens",
    mediaRole: null,
    structuralTraits: {
      widthTreatment: widths[candidate % widths.length]!,
      alignment: aligns[candidate % aligns.length]!,
      density: densities[candidate % densities.length]!,
      // The selected candidate (0) never asks for dominant Media, so a fixture document
      // with no images still satisfies conformance.
      mediaEmphasis: safeMedia[(n + candidate) % safeMedia.length]!,
      repetition: reps[candidate % reps.length]!,
      approximateColumns: candidate === 0 ? null : candidate + 1,
    },
  }));
  const candidate = (index: number, count: number) => ({
    id: `cand-${index}`,
    pageIntent: { primaryGoal: `goal-${n}-${index}`, audience: "the site's audience", desiredAction: index === 0 ? "take the primary action" : null },
    artDirection: { concept: `concept-${index}`, mood: "considered", visualMotifs: [], densityRhythm: "alternating", mediaStrategy: "restrained" },
    sections: makeSection(index, count),
    responsiveStrategy: "mobile first",
    continuity: { sharedSiteLanguage: ["navbar", "footer"], deliberatePageDifferences: [`difference-${index}`] },
    originalityRationale: `composed for this page's job, variant ${index}`,
  });
  // Distinct section counts (3/4/5) and per-candidate trait tokens keep the three
  // candidates well apart for the diversity assertion; the selected one stays at 3.
  return {
    schemaVersion: DESIGN_PLAN_SCHEMA_VERSION,
    candidates: [candidate(0, 3), candidate(1, 4), candidate(2, 5)],
    selectedCandidateId: "cand-0",
    selectionRationale: "the three-section composition fits this page best",
  };
}

function isPlanningRequest(request: AIRequest) {
  return request.responseSchema === pageDesignPlanBundleJsonSchema;
}

/** Wraps a page/block fixture provider so it also answers the design-planning call. */
export function planAwareFixtureProvider(inner: AIProvider): AIProvider {
  return {
    get name() { return inner.name; },
    get model() { return inner.model; },
    get capabilities() { return inner.capabilities; },
    generateText: (request) => inner.generateText(request),
    async generateStructured<T>(request: AIRequest, validator: StructuredValidator<T>): Promise<AIResponse<T>> {
      if (isPlanningRequest(request)) {
        const value = fixturePlanBundleValue(planCallCounter++);
        return { text: JSON.stringify(value), structuredData: validator.parse(value), provider: inner.name, model: inner.model, usage: { totalTokens: 8 } };
      }
      return inner.generateStructured(request, validator);
    },
    listModels: inner.listModels ? () => inner.listModels!() : undefined,
    cancel: inner.cancel ? (id: string) => inner.cancel!(id) : undefined,
  };
}

/** A provider resolver that returns a fake adapter for a real account selection. */
export function fixtureProviderResolver(provider: AIProvider | (() => AIProvider), database: Database = db, options: Parameters<typeof ensureFixtureConnection>[2] = {}) {
  return async (actorUserId: string): Promise<{ resolved: ResolvedActorModel; provider: AIProvider }> => {
    const { connection, model } = await ensureFixtureConnection(actorUserId, database, options);
    const inner = typeof provider === "function" ? provider() : provider;
    return { resolved: { actorUserId, connection, model }, provider: planAwareFixtureProvider(inner) };
  };
}
