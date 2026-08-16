import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, userAISettings } from "@/server/db/schema";
import { encryptCredential, credentialHint } from "@/server/security/credential-cipher";
import type { AIProvider, AIProviderKind, ModelCapabilities } from "@/domain/ai/provider";
import type { ResolvedActorModel } from "@/domain/ai/connections/model-resolution";

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

/** A provider resolver that returns a fake adapter for a real account selection. */
export function fixtureProviderResolver(provider: AIProvider | (() => AIProvider), database: Database = db, options: Parameters<typeof ensureFixtureConnection>[2] = {}) {
  return async (actorUserId: string): Promise<{ resolved: ResolvedActorModel; provider: AIProvider }> => {
    const { connection, model } = await ensureFixtureConnection(actorUserId, database, options);
    return { resolved: { actorUserId, connection, model }, provider: typeof provider === "function" ? provider() : provider };
  };
}
