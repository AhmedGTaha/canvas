import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, auditEvents, userAISettings } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";
import { accountModelSelectionSchema } from "./schemas";
import { toModelView, type ModelView } from "./connection-service";

/**
 * What an account may choose from, and what it has chosen.
 *
 * This is the selection side of AI configuration, kept separate from connection
 * management so it can be read cheaply — it returns connection names, provider kinds and
 * model capabilities, and no credential, hint, or base URL.
 */
export type AccountModelOption = { connectionId: string; connectionName: string; provider: string; models: ModelView[] };
export type AccountModelSelection = {
  connectionId: string | null;
  modelRecordId: string | null;
  connectionName: string | null;
  provider: string | null;
  model: ModelView | null;
  /** Set when a selection exists but can no longer be used. */
  unavailableReason: string | null;
  options: AccountModelOption[];
  /** False when this account has no usable connection at all. */
  configured: boolean;
};

export class AccountModelService {
  constructor(private readonly database: Database = db) {}

  async read(userId: string): Promise<AccountModelSelection> {
    const connections = await this.database.select().from(aiConnections)
      .where(and(eq(aiConnections.userId, userId), isNull(aiConnections.deletedAt)))
      .orderBy(asc(aiConnections.createdAt));
    const models = connections.length
      ? await this.database.select().from(aiConnectionModels)
          .where(and(eq(aiConnectionModels.userId, userId), eq(aiConnectionModels.enabled, true)))
          .orderBy(asc(aiConnectionModels.displayName))
      : [];
    const options = connections.map((connection) => ({
      connectionId: connection.id, connectionName: connection.name, provider: connection.provider,
      models: models.filter((model) => model.connectionId === connection.id).map(toModelView),
    }));

    const [settings] = await this.database.select().from(userAISettings).where(eq(userAISettings.userId, userId)).limit(1);
    const connection = settings?.connectionId ? connections.find((entry) => entry.id === settings.connectionId) : undefined;
    const selectedRow = settings?.modelId ? (await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.id, settings.modelId)).limit(1))[0] : undefined;
    const selectedModel = selectedRow && connection && selectedRow.connectionId === connection.id ? selectedRow : undefined;
    const unavailableReason = !settings?.connectionId
      ? null
      : !connection ? "The connection you were using was removed."
      : !selectedModel ? "The model you were using is no longer on that connection."
      : !selectedModel.enabled ? "The model you were using is no longer enabled."
      : null;

    return {
      connectionId: settings?.connectionId ?? null,
      modelRecordId: settings?.modelId ?? null,
      connectionName: connection?.name ?? null,
      provider: connection?.provider ?? null,
      model: selectedModel ? toModelView(selectedModel) : null,
      unavailableReason,
      options,
      configured: Boolean(selectedModel && !unavailableReason),
    };
  }

  /** Sets this account's connection and model. There is no other account to set. */
  async select(userId: string, input: unknown): Promise<AccountModelSelection> {
    const parsed = accountModelSelectionSchema.parse(input);

    if (parsed.connectionId && parsed.modelRecordId) {
      const [connection] = await this.database.select().from(aiConnections)
        .where(and(eq(aiConnections.id, parsed.connectionId), eq(aiConnections.userId, userId), isNull(aiConnections.deletedAt))).limit(1);
      // Another account's connection is not a validation slip; it is an attempt to use
      // someone else's credential, so it is refused as a missing connection.
      if (!connection) throw new DomainError("NOT_FOUND", "That AI connection is not on your account.");
      const [model] = await this.database.select().from(aiConnectionModels)
        .where(and(eq(aiConnectionModels.id, parsed.modelRecordId), eq(aiConnectionModels.connectionId, connection.id))).limit(1);
      if (!model) throw new DomainError("NOT_FOUND", "That model is not available on this connection.");
      if (!model.enabled) throw new DomainError("VALIDATION", "Enable that model before selecting it.");
    } else if (parsed.connectionId || parsed.modelRecordId) {
      throw new DomainError("VALIDATION", "Choose both a connection and a model.");
    }

    await this.database.insert(userAISettings)
      .values({ userId, connectionId: parsed.connectionId, modelId: parsed.modelRecordId })
      .onConflictDoUpdate({ target: userAISettings.userId, set: { connectionId: parsed.connectionId, modelId: parsed.modelRecordId, updatedAt: new Date() } });
    await this.database.insert(auditEvents).values({ userId, action: "ai.account_model_selected", entityType: "user", entityId: userId, metadata: { connectionId: parsed.connectionId, modelRecordId: parsed.modelRecordId } });
    return this.read(userId);
  }

  /**
   * Whether this person can start an AI job right now.
   *
   * Used by project surfaces to explain *before* a request is made that the actor has no
   * credentials — the check is about the person, never about the project.
   */
  async isConfigured(userId: string) {
    const [settings] = await this.database.select().from(userAISettings).where(eq(userAISettings.userId, userId)).limit(1);
    if (!settings?.connectionId || !settings.modelId) return false;
    const [row] = await this.database.select({ id: aiConnectionModels.id })
      .from(aiConnectionModels)
      .innerJoin(aiConnections, eq(aiConnections.id, aiConnectionModels.connectionId))
      .where(and(
        eq(aiConnectionModels.id, settings.modelId),
        eq(aiConnectionModels.enabled, true),
        eq(aiConnections.id, settings.connectionId),
        eq(aiConnections.userId, userId),
        isNull(aiConnections.deletedAt),
      )).limit(1);
    return Boolean(row);
  }
}
