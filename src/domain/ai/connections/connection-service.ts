import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, auditEvents, userAISettings } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";
import { credentialHint, decryptCredential, encryptCredential, CREDENTIAL_KEY_VERSION } from "@/server/security/credential-cipher";
import { AIError, type AIProviderKind, type ModelCapabilities, type ProviderModelDescriptor } from "@/domain/ai/provider";
import { createProvider, providerDescriptor, providerTimeoutMs } from "@/server/ai/provider-registry";
import { emit } from "@/server/observability/telemetry";
import { addModelSchema, createConnectionSchema, updateConnectionSchema, updateModelSchema, AI_CONNECTION_LIMITS } from "./schemas";

/** The only shape of a connection that ever leaves the server. Never the credential. */
export type ConnectionView = {
  id: string;
  provider: AIProviderKind;
  name: string;
  baseUrl: string | null;
  credentialHint: string;
  credentialUpdatedAt: string;
  lastTestStatus: "untested" | "passed" | "failed";
  lastTestedAt: string | null;
  lastTestError: string | null;
  supportsModelListing: boolean;
  models: ModelView[];
};

export type ModelView = {
  id: string;
  modelId: string;
  displayName: string;
  source: "discovered" | "manual";
  enabled: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  pricingCurrency: string | null;
  pricingVersion: number;
};

function money(value: string | null) { return value === null ? null : Number(value); }
function money6(value: number | null | undefined) { return value === null || value === undefined ? null : value.toFixed(6); }

export function toModelView(row: typeof aiConnectionModels.$inferSelect): ModelView {
  return {
    id: row.id, modelId: row.modelId, displayName: row.displayName, source: row.source, enabled: row.enabled,
    supportsStructuredOutput: row.supportsStructuredOutput, supportsVision: row.supportsVision,
    contextWindow: row.contextWindow, maxOutputTokens: row.maxOutputTokens,
    inputPricePerMillion: money(row.inputPricePerMillion), outputPricePerMillion: money(row.outputPricePerMillion),
    pricingCurrency: row.pricingCurrency, pricingVersion: row.pricingVersion,
  };
}

export function modelCapabilities(row: Pick<typeof aiConnectionModels.$inferSelect, "supportsStructuredOutput" | "supportsVision" | "contextWindow" | "maxOutputTokens">): ModelCapabilities {
  return {
    structuredOutput: row.supportsStructuredOutput,
    vision: row.supportsVision,
    contextWindow: row.contextWindow ?? undefined,
    maxOutputTokens: row.maxOutputTokens ?? undefined,
  };
}

/**
 * Account AI connections.
 *
 * Every method here operates on the caller's own connections and nobody else's: there is
 * no parameter by which one account can name another's, so there is no path — accidental
 * or deliberate — from a project, a workspace, or a collaborator to someone else's
 * credential. Credentials are encrypted before they reach the database and are decrypted
 * only inside this service for the duration of one provider call; no method returns a
 * credential and no view type has a field for one.
 *
 * Jobs reach the right credential through `model-resolution.ts`, which resolves the
 * account of the person who created the job.
 */
export class AIConnectionService {
  constructor(private readonly database: Database = db) {}

  /**
   * Loads a connection that belongs to this account.
   *
   * A connection owned by anyone else is reported as missing rather than forbidden: from
   * this account's point of view it does not exist, and saying otherwise would confirm
   * that some other account holds a connection with that id.
   */
  private async requireOwnedConnection(userId: string, connectionId: string) {
    const [connection] = await this.database.select().from(aiConnections)
      .where(and(eq(aiConnections.id, connectionId), eq(aiConnections.userId, userId), isNull(aiConnections.deletedAt))).limit(1);
    if (!connection) throw new DomainError("NOT_FOUND", "AI connection not found.");
    return connection;
  }

  async list(userId: string): Promise<ConnectionView[]> {
    const connections = await this.database.select().from(aiConnections)
      .where(and(eq(aiConnections.userId, userId), isNull(aiConnections.deletedAt)))
      .orderBy(asc(aiConnections.createdAt));
    if (!connections.length) return [];
    const models = await this.database.select().from(aiConnectionModels)
      .where(eq(aiConnectionModels.userId, userId))
      .orderBy(asc(aiConnectionModels.displayName));
    return connections.map((connection) => this.view(connection, models.filter((model) => model.connectionId === connection.id)));
  }

  private view(connection: typeof aiConnections.$inferSelect, models: typeof aiConnectionModels.$inferSelect[]): ConnectionView {
    return {
      id: connection.id, provider: connection.provider, name: connection.name,
      baseUrl: connection.baseUrl, credentialHint: connection.credentialHint,
      credentialUpdatedAt: connection.credentialUpdatedAt.toISOString(),
      lastTestStatus: connection.lastTestStatus, lastTestedAt: connection.lastTestedAt?.toISOString() ?? null,
      lastTestError: connection.lastTestError,
      supportsModelListing: providerDescriptor(connection.provider).supportsModelListing,
      models: models.map(toModelView),
    };
  }

  async create(userId: string, input: unknown): Promise<ConnectionView> {
    const parsed = createConnectionSchema.parse(input);
    const descriptor = providerDescriptor(parsed.provider);
    if (descriptor.baseUrl.required && !parsed.baseUrl) throw new DomainError("VALIDATION", "This provider needs a base URL.");
    if (!descriptor.baseUrl.supported && parsed.baseUrl) throw new DomainError("VALIDATION", "This provider does not use a base URL.");

    return this.database.transaction(async (transaction) => {
      // The ciphertext is bound to the connection id, so the row is inserted with a
      // placeholder and immediately sealed with its own identity as additional data.
      const [created] = await transaction.insert(aiConnections).values({
        userId, provider: parsed.provider, name: parsed.name,
        baseUrl: parsed.baseUrl, credentialCiphertext: "", credentialHint: credentialHint(parsed.apiKey),
        credentialKeyVersion: CREDENTIAL_KEY_VERSION, createdByUserId: userId,
      }).returning().catch((error: unknown) => {
        if ((error as { cause?: { code?: string } }).cause?.code === "23505") throw new DomainError("CONFLICT", "You already have a connection with that name.");
        throw error;
      });
      if (!created) throw new Error("AI connection insert failed.");
      const ciphertext = encryptCredential(parsed.apiKey, { connectionId: created.id, userId });
      const [sealed] = await transaction.update(aiConnections).set({ credentialCiphertext: ciphertext }).where(eq(aiConnections.id, created.id)).returning();
      await transaction.insert(auditEvents).values({ userId, action: "ai.connection_created", entityType: "ai_connection", entityId: created.id, metadata: { provider: parsed.provider } });
      return this.view(sealed!, []);
    });
  }

  async update(userId: string, input: unknown): Promise<ConnectionView> {
    const parsed = updateConnectionSchema.parse(input);
    const connection = await this.requireOwnedConnection(userId, parsed.connectionId);
    const descriptor = providerDescriptor(connection.provider);
    const baseUrl = parsed.baseUrl === undefined ? connection.baseUrl : parsed.baseUrl;
    if (descriptor.baseUrl.required && !baseUrl) throw new DomainError("VALIDATION", "This provider needs a base URL.");
    if (!descriptor.baseUrl.supported && baseUrl) throw new DomainError("VALIDATION", "This provider does not use a base URL.");

    const credential = parsed.apiKey
      ? {
          credentialCiphertext: encryptCredential(parsed.apiKey, { connectionId: connection.id, userId: connection.userId }),
          // Rotating the key re-seals it against the account, so a legacy workspace
          // binding stops being needed the moment anyone saves a new one.
          legacyWorkspaceId: null,
          credentialHint: credentialHint(parsed.apiKey),
          credentialKeyVersion: CREDENTIAL_KEY_VERSION,
          credentialUpdatedAt: new Date(),
          lastTestStatus: "untested" as const, lastTestedAt: null, lastTestError: null,
        }
      : {};
    const [updated] = await this.database.update(aiConnections)
      .set({ name: parsed.name ?? connection.name, baseUrl, updatedAt: new Date(), ...credential })
      .where(eq(aiConnections.id, connection.id)).returning();
    await this.database.insert(auditEvents).values({ userId, action: "ai.connection_updated", entityType: "ai_connection", entityId: connection.id, metadata: { credentialRotated: Boolean(parsed.apiKey) } });
    const models = await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.connectionId, connection.id));
    return this.view(updated!, models);
  }

  /**
   * Removes a connection. Websites this account has worked on keep every page they have:
   * the account's selection is cleared and the next job this person starts fails with a
   * normalized configuration error rather than silently falling back to anyone else's
   * credential.
   */
  async remove(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    await this.database.transaction(async (transaction) => {
      await transaction.update(aiConnections).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(aiConnections.id, connection.id));
      await transaction.update(userAISettings).set({ connectionId: null, modelId: null, updatedAt: new Date() }).where(eq(userAISettings.connectionId, connection.id));
      await transaction.insert(auditEvents).values({ userId, action: "ai.connection_removed", entityType: "ai_connection", entityId: connection.id });
    });
    return { id: connection.id };
  }

  /** Decrypts a credential for exactly one provider call. Never returned to a caller. */
  private credential(connection: typeof aiConnections.$inferSelect) {
    return decryptCredential(connection.credentialCiphertext, { connectionId: connection.id, userId: connection.userId, legacyWorkspaceId: connection.legacyWorkspaceId });
  }

  /**
   * Live connection check. Uses model discovery where the provider supports it, and a
   * minimal generation otherwise, so a passing test proves the credential really works.
   */
  async test(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const descriptor = providerDescriptor(connection.provider);
    const models = await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.connectionId, connection.id));
    const probeModel = models.find((model) => model.enabled) ?? models[0];
    const provider = createProvider({
      provider: connection.provider, apiKey: this.credential(connection), baseUrl: connection.baseUrl,
      model: probeModel?.modelId ?? "probe", capabilities: probeModel ? modelCapabilities(probeModel) : { structuredOutput: true, vision: false },
      timeoutMs: Math.min(providerTimeoutMs(), 30_000),
    });

    const started = performance.now();
    try {
      if (descriptor.supportsModelListing && provider.listModels) await provider.listModels();
      else if (probeModel) await provider.generateText({ systemInstructions: "Reply with the single word OK.", messages: [{ role: "user", parts: [{ type: "text", text: "OK" }] }], maxOutputTokens: 16 });
      else throw new AIError("AI_NOT_CONFIGURED", "Add at least one model ID before testing this connection.", false, undefined, "no model to probe");
      const latencyMs = Math.round(performance.now() - started);
      await this.database.update(aiConnections).set({ lastTestStatus: "passed", lastTestedAt: new Date(), lastTestError: null }).where(eq(aiConnections.id, connection.id));
      emit("ai.connection_tested", { connectionId: connection.id, provider: connection.provider, outcome: "passed", latencyMs });
      return { status: "passed" as const, latencyMs, error: null };
    } catch (error) {
      const failure = error instanceof AIError ? error : new AIError("AI_PROVIDER_UNAVAILABLE", "This connection could not be reached.");
      await this.database.update(aiConnections).set({ lastTestStatus: "failed", lastTestedAt: new Date(), lastTestError: failure.message.slice(0, 300) }).where(eq(aiConnections.id, connection.id));
      emit("ai.connection_tested", { connectionId: connection.id, provider: connection.provider, outcome: "failed", reason: failure.code }, "warn");
      return { status: "failed" as const, latencyMs: Math.round(performance.now() - started), error: failure.message, code: failure.code };
    }
  }

  /**
   * Model discovery. Discovered models arrive disabled: the account holder decides which
   * of them Canvas may use. Capability and pricing edits they already made are preserved
   * across a re-discovery.
   */
  async discoverModels(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    if (!providerDescriptor(connection.provider).supportsModelListing) throw new AIError("AI_MODEL_LISTING_UNSUPPORTED", "This provider does not list models. Add model IDs manually.");
    const provider = createProvider({
      provider: connection.provider, apiKey: this.credential(connection), baseUrl: connection.baseUrl,
      model: "discovery", capabilities: { structuredOutput: true, vision: false }, timeoutMs: Math.min(providerTimeoutMs(), 30_000),
    });
    if (!provider.listModels) throw new AIError("AI_MODEL_LISTING_UNSUPPORTED", "This provider does not list models. Add model IDs manually.");
    const discovered = await provider.listModels();
    await this.upsertDiscovered(connection, discovered.slice(0, AI_CONNECTION_LIMITS.modelsPerConnection));
    const models = await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.connectionId, connection.id)).orderBy(asc(aiConnectionModels.displayName));
    return { models: models.map(toModelView) };
  }

  private async upsertDiscovered(connection: typeof aiConnections.$inferSelect, models: ProviderModelDescriptor[]) {
    if (!models.length) return;
    const defaults = providerDescriptor(connection.provider).defaultCapabilities;
    await this.database.transaction(async (transaction) => {
      for (const model of models) {
        await transaction.insert(aiConnectionModels).values({
          connectionId: connection.id, userId: connection.userId,
          modelId: model.modelId, displayName: model.displayName || model.modelId, source: "discovered", enabled: false,
          supportsStructuredOutput: model.capabilities?.structuredOutput ?? defaults.structuredOutput,
          supportsVision: model.capabilities?.vision ?? defaults.vision,
          contextWindow: model.capabilities?.contextWindow ?? null,
          maxOutputTokens: model.capabilities?.maxOutputTokens ?? null,
        }).onConflictDoUpdate({
          target: [aiConnectionModels.connectionId, aiConnectionModels.modelId],
          // Only provider-supplied facts are refreshed. Enablement, pricing, and any
          // capability the account holder corrected by hand are theirs, not the provider's.
          set: { displayName: model.displayName || model.modelId, updatedAt: new Date() },
        });
      }
    });
  }

  /** Manual model entry, for providers or endpoints with no usable model list. */
  async addModel(userId: string, input: unknown) {
    const parsed = addModelSchema.parse(input);
    const connection = await this.requireOwnedConnection(userId, parsed.connectionId);
    const defaults = providerDescriptor(connection.provider).defaultCapabilities;
    const existing = await this.database.select({ id: aiConnectionModels.id }).from(aiConnectionModels).where(eq(aiConnectionModels.connectionId, connection.id));
    if (existing.length >= AI_CONNECTION_LIMITS.modelsPerConnection) throw new DomainError("VALIDATION", "This connection already has the maximum number of models.");
    const [model] = await this.database.insert(aiConnectionModels).values({
      connectionId: connection.id, userId: connection.userId,
      modelId: parsed.modelId, displayName: parsed.displayName?.trim() || parsed.modelId, source: "manual",
      enabled: parsed.enabled ?? true,
      supportsStructuredOutput: parsed.supportsStructuredOutput ?? defaults.structuredOutput,
      supportsVision: parsed.supportsVision ?? defaults.vision,
      contextWindow: parsed.contextWindow ?? null, maxOutputTokens: parsed.maxOutputTokens ?? null,
      inputPricePerMillion: money6(parsed.inputPricePerMillion), outputPricePerMillion: money6(parsed.outputPricePerMillion),
      pricingCurrency: parsed.pricingCurrency ?? (parsed.inputPricePerMillion || parsed.outputPricePerMillion ? "USD" : null),
    }).returning().catch((error: unknown) => {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505") throw new DomainError("CONFLICT", "That model is already on this connection.");
      throw error;
    });
    return toModelView(model!);
  }

  /**
   * Edits a model. A pricing change bumps `pricingVersion`, and usage rows keep the
   * pricing they were costed with, so historical estimates never move underneath anyone.
   */
  async updateModel(userId: string, input: unknown) {
    const parsed = updateModelSchema.parse(input);
    const [current] = await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.id, parsed.modelRecordId)).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Model not found.");
    await this.requireOwnedConnection(userId, current.connectionId);
    const nextInput = parsed.inputPricePerMillion === undefined ? current.inputPricePerMillion : money6(parsed.inputPricePerMillion);
    const nextOutput = parsed.outputPricePerMillion === undefined ? current.outputPricePerMillion : money6(parsed.outputPricePerMillion);
    const pricingChanged = nextInput !== current.inputPricePerMillion || nextOutput !== current.outputPricePerMillion;
    const [updated] = await this.database.update(aiConnectionModels).set({
      displayName: parsed.displayName?.trim() || current.displayName,
      enabled: parsed.enabled ?? current.enabled,
      supportsStructuredOutput: parsed.supportsStructuredOutput ?? current.supportsStructuredOutput,
      supportsVision: parsed.supportsVision ?? current.supportsVision,
      contextWindow: parsed.contextWindow === undefined ? current.contextWindow : parsed.contextWindow ?? null,
      maxOutputTokens: parsed.maxOutputTokens === undefined ? current.maxOutputTokens : parsed.maxOutputTokens ?? null,
      inputPricePerMillion: nextInput, outputPricePerMillion: nextOutput,
      pricingCurrency: parsed.pricingCurrency ?? (nextInput || nextOutput ? current.pricingCurrency ?? "USD" : null),
      pricingVersion: pricingChanged ? current.pricingVersion + 1 : current.pricingVersion,
      updatedAt: new Date(),
    }).where(eq(aiConnectionModels.id, current.id)).returning();
    return toModelView(updated!);
  }

  async removeModel(userId: string, modelRecordId: string) {
    const [current] = await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.id, modelRecordId)).limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "Model not found.");
    await this.requireOwnedConnection(userId, current.connectionId);
    await this.database.transaction(async (transaction) => {
      await transaction.update(userAISettings).set({ modelId: null, updatedAt: new Date() }).where(eq(userAISettings.modelId, current.id));
      await transaction.delete(aiConnectionModels).where(eq(aiConnectionModels.id, current.id));
    });
    return { id: current.id };
  }
}
