import { and, eq, sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlocks, changeSets, pageNodes, projectBrandSettings, projectThemeSettings, projects } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { ChangeSetService, recordChangeSet, type TransactionLike } from "./change-set-service";
import { applyRestorePlan, validateRestorePlan, type RestorePlan } from "./restore-engine";
import { nothingToRedo, nothingToUndo, redoConflict, undoConflict } from "./errors";
import type { ChangeSetItem } from "@/server/db/schema";
import { observe } from "@/server/observability/events";

type Direction = "undo" | "redo";
type Expectation = { entityType: "page" | "building_block" | "project"; entityId: string | null; versionId: string | null; state: Record<string, unknown> | null };

function stateOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Builds the target state and the expected current state for a Change Set replay.
 * Undo moves each entity to its `before` reference; Redo moves it back to `after`.
 */
function planFrom(items: ChangeSetItem[], direction: Direction) {
  const plan: RestorePlan = { pages: [], blocks: [] };
  const expectations: Expectation[] = [];
  for (const item of items) {
    const target = direction === "undo" ? { versionId: item.beforeVersionId, state: stateOf(item.beforeState) } : { versionId: item.afterVersionId, state: stateOf(item.afterState) };
    const expected = direction === "undo" ? { versionId: item.afterVersionId, state: stateOf(item.afterState) } : { versionId: item.beforeVersionId, state: stateOf(item.beforeState) };
    expectations.push({ entityType: item.entityType, entityId: item.entityId, versionId: expected.versionId, state: expected.state });
    if (item.entityType === "page" && item.entityId) plan.pages.push({ pageId: item.entityId, versionId: target.versionId });
    else if (item.entityType === "building_block" && item.entityId) {
      plan.blocks.push({
        blockId: item.entityId, versionId: target.versionId,
        isGlobal: typeof target.state?.isGlobal === "boolean" ? target.state.isGlobal : undefined,
        archived: typeof target.state?.archived === "boolean" ? target.state.archived : undefined,
      });
    } else if (item.entityType === "project" && target.state) {
      plan.project = {
        ...(("currentInstructionId" in target.state) ? { currentInstructionId: (target.state.currentInstructionId ?? null) as string | null } : {}),
        ...(target.state.theme ? { theme: target.state.theme as Record<string, unknown> } : {}),
        ...(target.state.brand ? { brand: target.state.brand as Record<string, unknown> } : {}),
      };
    }
  }
  return { plan, expectations };
}

/** Optimistic expected-state check: newer collaborator work is never overwritten. */
async function assertExpectedState(transaction: TransactionLike, projectId: string, expectations: Expectation[], onConflict: () => never) {
  for (const expectation of expectations) {
    if (expectation.entityType === "page" && expectation.entityId) {
      const [page] = await transaction.select().from(pageNodes).where(and(eq(pageNodes.id, expectation.entityId), eq(pageNodes.projectId, projectId))).for("update");
      // A page removed by a collaborator can never be silently revived by history.
      if (!page || page.deletedAt || page.currentVersionId !== expectation.versionId) onConflict();
    } else if (expectation.entityType === "building_block" && expectation.entityId) {
      const [block] = await transaction.select().from(buildingBlocks).where(and(eq(buildingBlocks.id, expectation.entityId), eq(buildingBlocks.projectId, projectId))).for("update");
      if (!block || block.currentVersionId !== expectation.versionId) onConflict();
      if (typeof expectation.state?.isGlobal === "boolean" && block.isGlobal !== expectation.state.isGlobal) onConflict();
      const expectedArchived = typeof expectation.state?.archived === "boolean" ? expectation.state.archived : false;
      if (Boolean(block.deletedAt) !== expectedArchived) onConflict();
    } else if (expectation.entityType === "project" && expectation.state) {
      const [project] = await transaction.select().from(projects).where(eq(projects.id, projectId)).for("update");
      if (!project) onConflict();
      if ("currentInstructionId" in expectation.state && project.currentInstructionId !== (expectation.state.currentInstructionId ?? null)) onConflict();
      const theme = stateOf(expectation.state.theme); const brand = stateOf(expectation.state.brand);
      if (typeof theme?.revision === "number") {
        const [row] = await transaction.select({ revision: projectThemeSettings.revision }).from(projectThemeSettings).where(eq(projectThemeSettings.projectId, projectId)).limit(1);
        if (row?.revision !== theme.revision) onConflict();
      }
      if (typeof brand?.revision === "number") {
        const [row] = await transaction.select({ revision: projectBrandSettings.revision }).from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1);
        if (row?.revision !== brand.revision) onConflict();
      }
    }
  }
}

export class HistoryService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService(), private readonly changeSets = new ChangeSetService(database)) {}

  /** Undo/Redo availability plus recent project history for the Builder. */
  async state(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [undo, redo, history] = await Promise.all([
      this.changeSets.undoCandidate(projectId),
      this.changeSets.redoCandidate(projectId),
      this.changeSets.list(projectId),
    ]);
    return {
      undo: undo ? { id: undo.id, summary: undo.summary, operation: undo.operation } : null,
      redo: redo ? { id: redo.id, summary: redo.summary, operation: redo.operation } : null,
      history,
    };
  }

  undo(userId: string, projectId: string) { return this.replay(userId, projectId, "undo"); }
  redo(userId: string, projectId: string) { return this.replay(userId, projectId, "redo"); }

  private async replay(userId: string, projectId: string, direction: Direction) {
    await this.access.requireProjectAccess(userId, projectId);
    return this.database.transaction(async (transaction) => {
      // History operations are serialized per project so two collaborators cannot
      // interleave an Undo and a Redo over the same Change Sets.
      await transaction.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const candidate = direction === "undo" ? await this.changeSets.undoCandidate(projectId, transaction) : await this.changeSets.redoCandidate(projectId, transaction);
      if (!candidate) throw direction === "undo" ? nothingToUndo() : nothingToRedo();
      const items = await this.changeSets.items(candidate.id, projectId, transaction);
      const { plan, expectations } = planFrom(items, direction);
      await assertExpectedState(transaction, projectId, expectations, () => { throw direction === "undo" ? undoConflict() : redoConflict(); });
      await validateRestorePlan(transaction, projectId, plan);
      await applyRestorePlan(transaction, projectId, plan);

      const summary = direction === "undo" ? `Undid: ${candidate.summary}` : `Redid: ${candidate.summary}`;
      const record = await recordChangeSet(transaction, {
        projectId, actorUserId: userId, operation: direction, summary, sourceChangeSetId: candidate.id,
        items: items.map((item) => ({
          entityType: item.entityType, entityId: item.entityId,
          beforeVersionId: direction === "undo" ? item.afterVersionId : item.beforeVersionId,
          afterVersionId: direction === "undo" ? item.beforeVersionId : item.afterVersionId,
          beforeState: direction === "undo" ? item.afterState : item.beforeState,
          afterState: direction === "undo" ? item.beforeState : item.afterState,
        })),
      });
      await transaction.update(changeSets)
        .set(direction === "undo" ? { undoneAt: new Date(), undoneByChangeSetId: record.id } : { undoneAt: null, undoneByChangeSetId: null })
        .where(and(eq(changeSets.id, candidate.id), eq(changeSets.projectId, projectId)));
      observe.historyAction(direction, { projectId, changeSetId: candidate.id });
      return { changeSet: record, source: { id: candidate.id, summary: candidate.summary, operation: candidate.operation } };
    });
  }
}
