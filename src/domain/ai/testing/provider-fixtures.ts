import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, projectAISettings, projects } from "@/server/db/schema";
import { encryptCredential, credentialHint } from "@/server/security/credential-cipher";
import type { AIProvider, AIProviderKind, ModelCapabilities } from "@/domain/ai/provider";
import type { ResolvedProjectModel } from "@/domain/ai/connections/model-resolution";

/**
 * Test support for the BYOK path.
 *
 * Suites that exercise generation still need a project with a real, selected workspace
 * connection, because that is what production does. This creates one — encrypted with
 * the same cipher, selected through the same table — and hands back a resolver that uses
 * a fake adapter instead of a real provider call. Nothing here is imported by
 * application code.
 */
export const FIXTURE_API_KEY = "test-fixture-api-key-0000";

export async function ensureFixtureConnection(projectId: string, database: Database = db, options: {
  provider?: AIProviderKind;
  modelId?: string;
  capabilities?: Partial<ModelCapabilities>;
  pricing?: { input: number; output: number; currency?: string };
} = {}) {
  const [project] = await database.select({ id: projects.id, workspaceId: projects.workspaceId, ownerUserId: projects.ownerUserId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("Fixture connection needs an existing project.");
  const provider = options.provider ?? "gemini";
  const modelId = options.modelId ?? "fixture-model";

  const [existing] = await database.select().from(aiConnections)
    .where(and(eq(aiConnections.workspaceId, project.workspaceId), isNull(aiConnections.deletedAt))).limit(1);
  let connection = existing;
  if (!connection) {
    const [created] = await database.insert(aiConnections).values({
      workspaceId: project.workspaceId, provider, name: `Fixture ${provider}`,
      credentialCiphertext: "", credentialHint: credentialHint(FIXTURE_API_KEY), createdByUserId: project.ownerUserId,
    }).returning();
    const ciphertext = encryptCredential(FIXTURE_API_KEY, { connectionId: created!.id, workspaceId: project.workspaceId });
    [connection] = await database.update(aiConnections).set({ credentialCiphertext: ciphertext }).where(eq(aiConnections.id, created!.id)).returning();
  }

  const [model] = await database.insert(aiConnectionModels).values({
    connectionId: connection!.id, workspaceId: project.workspaceId, modelId, displayName: modelId, source: "manual", enabled: true,
    supportsStructuredOutput: options.capabilities?.structuredOutput ?? true,
    supportsVision: options.capabilities?.vision ?? true,
    inputPricePerMillion: options.pricing ? options.pricing.input.toFixed(6) : null,
    outputPricePerMillion: options.pricing ? options.pricing.output.toFixed(6) : null,
    pricingCurrency: options.pricing ? options.pricing.currency ?? "USD" : null,
  }).onConflictDoUpdate({
    target: [aiConnectionModels.connectionId, aiConnectionModels.modelId],
    set: { enabled: true },
  }).returning();

  await database.insert(projectAISettings).values({ projectId, connectionId: connection!.id, modelId: model!.id, updatedByUserId: project.ownerUserId })
    .onConflictDoUpdate({ target: projectAISettings.projectId, set: { connectionId: connection!.id, modelId: model!.id, updatedAt: new Date() } });

  return { connection: connection!, model: model!, workspaceId: project.workspaceId };
}

/** A provider resolver that returns a fake adapter for a real project selection. */
export function fixtureProviderResolver(provider: AIProvider | (() => AIProvider), database: Database = db, options: Parameters<typeof ensureFixtureConnection>[2] = {}) {
  return async (projectId: string): Promise<{ resolved: ResolvedProjectModel; provider: AIProvider }> => {
    const { connection, model, workspaceId } = await ensureFixtureConnection(projectId, database, options);
    return { resolved: { projectId, workspaceId, connection, model }, provider: typeof provider === "function" ? provider() : provider };
  };
}
