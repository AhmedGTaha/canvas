import { and, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, projectAISettings, projects } from "@/server/db/schema";
import { AIError, type AIProvider, type ProviderConnectionConfig } from "@/domain/ai/provider";
import { decryptCredential } from "@/server/security/credential-cipher";
import { createProvider, providerTimeoutMs } from "@/server/ai/provider-registry";
import { modelCapabilities } from "./connection-service";

export type ResolvedProjectModel = {
  projectId: string;
  workspaceId: string;
  connection: typeof aiConnections.$inferSelect;
  model: typeof aiConnectionModels.$inferSelect;
};

/** What a job row and analytics record about a request. Never a credential. */
export type ProjectModelDescriptor = { provider: string; model: string; connectionId: string; workspaceId: string };

function notConfigured(diagnostic: string): never {
  throw new AIError("AI_NOT_CONFIGURED", "This website has no AI model selected. Choose a connection and model in AI settings.", false, undefined, diagnostic);
}

/**
 * Resolves the model a project's AI requests must use:
 * project → selected AI connection → selected enabled model.
 *
 * Every failure here is a configuration failure, never a transient one: a removed
 * connection, a disabled model, or a selection pointing outside the project's own
 * workspace all fail fast and leave existing website state untouched.
 */
export async function resolveProjectModel(projectId: string, database: Database = db): Promise<ResolvedProjectModel> {
  const [project] = await database.select({ id: projects.id, workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) notConfigured("project not found");
  const [settings] = await database.select().from(projectAISettings).where(eq(projectAISettings.projectId, projectId)).limit(1);
  if (!settings?.connectionId || !settings.modelId) notConfigured("no project model selection");

  const [connection] = await database.select().from(aiConnections)
    .where(and(eq(aiConnections.id, settings.connectionId), isNull(aiConnections.deletedAt))).limit(1);
  if (!connection) notConfigured("selected connection removed");
  // Tenant boundary: a project may only use a credential owned by its own workspace.
  if (connection.workspaceId !== project.workspaceId) notConfigured("connection belongs to another workspace");

  const [model] = await database.select().from(aiConnectionModels)
    .where(and(eq(aiConnectionModels.id, settings.modelId), eq(aiConnectionModels.connectionId, connection.id))).limit(1);
  if (!model) notConfigured("selected model removed");
  if (!model.enabled) notConfigured("selected model disabled");

  return { projectId, workspaceId: project.workspaceId, connection, model };
}

/** Provider/model identity for a job row, resolved without touching the credential. */
export async function projectModelDescriptor(projectId: string, database: Database = db): Promise<ProjectModelDescriptor | null> {
  try {
    const resolved = await resolveProjectModel(projectId, database);
    return { provider: resolved.connection.provider, model: resolved.model.modelId, connectionId: resolved.connection.id, workspaceId: resolved.workspaceId };
  } catch { return null; }
}

/**
 * Builds the adapter for a resolved selection. This is the only place a stored
 * credential is decrypted, it happens inside the worker at execution time, and the
 * plaintext never leaves this call's stack — it is not written to a job payload, a log,
 * a telemetry field, or generation metadata.
 */
export function providerForResolvedModel(resolved: ResolvedProjectModel): AIProvider {
  const config: ProviderConnectionConfig = {
    provider: resolved.connection.provider,
    apiKey: decryptCredential(resolved.connection.credentialCiphertext, { connectionId: resolved.connection.id, workspaceId: resolved.connection.workspaceId }),
    baseUrl: resolved.connection.baseUrl,
    model: resolved.model.modelId,
    capabilities: modelCapabilities(resolved.model),
    timeoutMs: providerTimeoutMs(),
  };
  return createProvider(config);
}

/** Resolution and adapter construction in one step, for the generation worker. */
export async function resolveProjectProvider(projectId: string, database: Database = db) {
  const resolved = await resolveProjectModel(projectId, database);
  return { resolved, provider: providerForResolvedModel(resolved) };
}
