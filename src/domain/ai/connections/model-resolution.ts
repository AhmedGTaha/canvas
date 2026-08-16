import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, userAISettings } from "@/server/db/schema";
import { AIError, type AIProvider, type ProviderConnectionConfig } from "@/domain/ai/provider";
import { decryptCredential } from "@/server/security/credential-cipher";
import { createProvider, providerTimeoutMs } from "@/server/ai/provider-registry";
import { modelCapabilities } from "./connection-service";

export type ResolvedActorModel = {
  actorUserId: string;
  connection: typeof aiConnections.$inferSelect;
  model: typeof aiConnectionModels.$inferSelect;
};

/** What a job row and analytics record about a request. Never a credential. */
export type ActorModelDescriptor = { provider: string; model: string; connectionId: string; actorUserId: string };

function notConfigured(diagnostic: string): never {
  throw new AIError("AI_NOT_CONFIGURED", "Your account has no AI model selected. Choose a provider and model in AI settings.", false, undefined, diagnostic);
}

/**
 * Resolves the model an AI request must use: **the actor's** account → their selected
 * connection → their selected enabled model.
 *
 * The actor is the person who created the job, not the project's owner and not whoever
 * happens to run the worker. That is the whole credential-ownership rule in one function:
 * a collaborator's generation spends the collaborator's credit, and the owner's key is
 * never reachable from it.
 *
 * Every failure here is a configuration failure, never a transient one: a removed
 * connection, a disabled model, or a selection that no longer belongs to this account all
 * fail fast and leave existing website state untouched. There is deliberately no fallback
 * to another member's credential and no fallback to an environment key.
 */
export async function resolveActorModel(actorUserId: string, database: Database = db): Promise<ResolvedActorModel> {
  const [settings] = await database.select().from(userAISettings).where(eq(userAISettings.userId, actorUserId)).limit(1);
  if (!settings?.connectionId || !settings.modelId) notConfigured("no account model selection");

  const [connection] = await database.select().from(aiConnections)
    .where(and(eq(aiConnections.id, settings.connectionId), isNull(aiConnections.deletedAt))).limit(1);
  if (!connection) notConfigured("selected connection removed");
  // Ownership boundary: an account may only use a credential it holds itself.
  if (connection.userId !== actorUserId) notConfigured("connection belongs to another account");

  const [model] = await database.select().from(aiConnectionModels)
    .where(and(eq(aiConnectionModels.id, settings.modelId), eq(aiConnectionModels.connectionId, connection.id))).limit(1);
  if (!model) notConfigured("selected model removed");
  if (!model.enabled) notConfigured("selected model disabled");

  return { actorUserId, connection, model };
}

/** Provider/model identity for a job row, resolved without touching the credential. */
export async function actorModelDescriptor(actorUserId: string, database: Database = db): Promise<ActorModelDescriptor | null> {
  try {
    const resolved = await resolveActorModel(actorUserId, database);
    return { provider: resolved.connection.provider, model: resolved.model.modelId, connectionId: resolved.connection.id, actorUserId };
  } catch { return null; }
}

/**
 * Builds the adapter for a resolved selection. This is the only place a stored credential
 * is decrypted, it happens inside the worker at execution time, and the plaintext never
 * leaves this call's stack — it is not written to a job payload, a queue row, a prompt, a
 * log, a telemetry field, generation metadata, or an export.
 */
export function providerForResolvedModel(resolved: ResolvedActorModel): AIProvider {
  const config: ProviderConnectionConfig = {
    provider: resolved.connection.provider,
    apiKey: decryptCredential(resolved.connection.credentialCiphertext, {
      connectionId: resolved.connection.id,
      userId: resolved.connection.userId,
      legacyWorkspaceId: resolved.connection.legacyWorkspaceId,
    }),
    baseUrl: resolved.connection.baseUrl,
    model: resolved.model.modelId,
    capabilities: modelCapabilities(resolved.model),
    timeoutMs: providerTimeoutMs(),
  };
  return createProvider(config);
}

/** Resolution and adapter construction in one step, for the generation worker. */
export async function resolveActorProvider(actorUserId: string, database: Database = db) {
  const resolved = await resolveActorModel(actorUserId, database);
  return { resolved, provider: providerForResolvedModel(resolved) };
}
