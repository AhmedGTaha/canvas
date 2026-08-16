import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConnectionModels, aiConnections, auditEvents, projectAISettings } from "@/server/db/schema";
import { DomainError } from "@/domain/shared/errors";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { projectModelSelectionSchema } from "./schemas";
import { toModelView, type ModelView } from "./connection-service";

/**
 * What a project may choose from, and what it has chosen.
 *
 * This is the collaborator-facing side of AI configuration: connection names, provider
 * kinds, and model capabilities — never a credential, a masked hint, or a base URL that
 * a collaborator has no business seeing. Only the project owner may change the
 * selection; only the workspace owner may change the connections themselves.
 */
export type ProjectModelOption = { connectionId: string; connectionName: string; provider: string; models: ModelView[] };
export type ProjectModelSelection = {
  projectId: string;
  connectionId: string | null;
  modelRecordId: string | null;
  connectionName: string | null;
  provider: string | null;
  model: ModelView | null;
  /** Set when a selection exists but can no longer be used. */
  unavailableReason: string | null;
  options: ProjectModelOption[];
  canSelect: boolean;
};

export class ProjectModelService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  async read(userId: string, projectId: string): Promise<ProjectModelSelection> {
    const { project, role } = await this.access.requireProjectAccess(userId, projectId);
    const connections = await this.database.select().from(aiConnections)
      .where(and(eq(aiConnections.workspaceId, project.workspaceId), isNull(aiConnections.deletedAt)))
      .orderBy(asc(aiConnections.createdAt));
    const models = connections.length
      ? await this.database.select().from(aiConnectionModels)
          .where(and(eq(aiConnectionModels.workspaceId, project.workspaceId), eq(aiConnectionModels.enabled, true)))
          .orderBy(asc(aiConnectionModels.displayName))
      : [];
    const options = connections.map((connection) => ({
      connectionId: connection.id, connectionName: connection.name, provider: connection.provider,
      models: models.filter((model) => model.connectionId === connection.id).map(toModelView),
    }));

    const [settings] = await this.database.select().from(projectAISettings).where(eq(projectAISettings.projectId, projectId)).limit(1);
    const connection = settings?.connectionId ? connections.find((entry) => entry.id === settings.connectionId) : undefined;
    const selectedModelRow = settings?.modelId ? (await this.database.select().from(aiConnectionModels).where(eq(aiConnectionModels.id, settings.modelId)).limit(1))[0] : undefined;
    const selectedModel = selectedModelRow && connection && selectedModelRow.connectionId === connection.id ? selectedModelRow : undefined;
    const unavailableReason = !settings?.connectionId
      ? null
      : !connection ? "The connection this website used was removed."
      : !selectedModel ? "The model this website used is no longer on that connection."
      : !selectedModel.enabled ? "The model this website used is no longer enabled for projects."
      : null;

    return {
      projectId,
      connectionId: settings?.connectionId ?? null,
      modelRecordId: settings?.modelId ?? null,
      connectionName: connection?.name ?? null,
      provider: connection?.provider ?? null,
      model: selectedModel ? toModelView(selectedModel) : null,
      unavailableReason,
      options,
      canSelect: role === "owner",
    };
  }

  /** Sets the project's connection and model. Project owner only. */
  async select(userId: string, input: unknown): Promise<ProjectModelSelection> {
    const parsed = projectModelSelectionSchema.parse(input);
    const project = await this.access.requireProjectOwner(userId, parsed.projectId);

    if (parsed.connectionId && parsed.modelRecordId) {
      const [connection] = await this.database.select().from(aiConnections)
        .where(and(eq(aiConnections.id, parsed.connectionId), eq(aiConnections.workspaceId, project.workspaceId), isNull(aiConnections.deletedAt))).limit(1);
      // A connection from another workspace is not a validation slip; it is an attempt to
      // use someone else's credential, so it is refused as a missing connection.
      if (!connection) throw new DomainError("NOT_FOUND", "That AI connection is not available to this website.");
      const [model] = await this.database.select().from(aiConnectionModels)
        .where(and(eq(aiConnectionModels.id, parsed.modelRecordId), eq(aiConnectionModels.connectionId, connection.id))).limit(1);
      if (!model) throw new DomainError("NOT_FOUND", "That model is not available on this connection.");
      if (!model.enabled) throw new DomainError("VALIDATION", "That model is not enabled for projects in this workspace.");
    } else if (parsed.connectionId || parsed.modelRecordId) {
      throw new DomainError("VALIDATION", "Choose both a connection and a model.");
    }

    await this.database.insert(projectAISettings)
      .values({ projectId: project.id, connectionId: parsed.connectionId, modelId: parsed.modelRecordId, updatedByUserId: userId })
      .onConflictDoUpdate({ target: projectAISettings.projectId, set: { connectionId: parsed.connectionId, modelId: parsed.modelRecordId, updatedByUserId: userId, updatedAt: new Date() } });
    await this.database.insert(auditEvents).values({ projectId: project.id, userId, action: "ai.project_model_selected", entityType: "project", entityId: project.id, metadata: { connectionId: parsed.connectionId, modelRecordId: parsed.modelRecordId } });
    return this.read(userId, project.id);
  }
}
