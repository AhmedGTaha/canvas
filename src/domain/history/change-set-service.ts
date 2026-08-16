import { and, desc, eq, gt, inArray, isNotNull, isNull, notInArray, sql as drizzleSql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { auditEvents, changeSetItems, changeSets, users } from "@/server/db/schema";

export type ChangeSetOperation = typeof changeSets.$inferSelect.operation;
export type ChangeSetEntityType = typeof changeSetItems.$inferSelect.entityType;
export type TransactionLike = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Operations that Undo/Redo can replay. Everything else is auditable but one-way. */
export const REVERSIBLE_OPERATIONS: ChangeSetOperation[] = [
  "page_generate", "page_modify", "block_generate", "block_modify",
  "block_global_toggle", "block_archive",
  // Composing a page from sections moves the page's active version, which is exactly
  // what the restore engine replays, so both directions are ordinary Undo/Redo.
  "page_section_add", "page_section_remove",
  "page_version_restore", "block_version_restore", "checkpoint_restore",
];
const HISTORY_OPERATIONS: ChangeSetOperation[] = ["undo", "redo"];

export type ChangeSetItemDraft = {
  entityType: ChangeSetEntityType;
  entityId: string | null;
  beforeVersionId?: string | null;
  afterVersionId?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
};

export type RecordChangeSetInput = {
  projectId: string;
  actorUserId: string;
  operation: ChangeSetOperation;
  summary: string;
  items: ChangeSetItemDraft[];
  generationJobId?: string | null;
  sourceChangeSetId?: string | null;
};

/**
 * Writes one Change Set and its items. Always called inside the transaction that applies
 * the change, so a multi-entity operation is recorded and applied atomically. Items hold
 * version/reference IDs rather than copies of generated source.
 */
export async function recordChangeSet(transaction: TransactionLike, input: RecordChangeSetInput) {
  const reversible = REVERSIBLE_OPERATIONS.includes(input.operation);
  const [changeSet] = await transaction.insert(changeSets).values({
    projectId: input.projectId, actorUserId: input.actorUserId, operation: input.operation,
    summary: input.summary.slice(0, 300) || input.operation, reversible,
    generationJobId: input.generationJobId ?? null, sourceChangeSetId: input.sourceChangeSetId ?? null,
  }).returning();
  if (!changeSet) throw new Error("Change Set insert did not return a record.");
  if (input.items.length) {
    await transaction.insert(changeSetItems).values(input.items.map((item, position) => ({
      changeSetId: changeSet.id, projectId: input.projectId, entityType: item.entityType, entityId: item.entityId,
      beforeVersionId: item.beforeVersionId ?? null, afterVersionId: item.afterVersionId ?? null,
      beforeState: item.beforeState ?? null, afterState: item.afterState ?? null, position,
    })));
  }
  await transaction.insert(auditEvents).values({
    projectId: input.projectId, userId: input.actorUserId, action: `history.${input.operation}`,
    entityType: "change_set", entityId: changeSet.id, metadata: { itemCount: input.items.length, reversible },
  });
  return changeSet;
}

export class ChangeSetService {
  constructor(private readonly database: Database = db) {}

  items(changeSetId: string, projectId: string, transaction: TransactionLike | Database = this.database) {
    return transaction.select().from(changeSetItems)
      .where(and(eq(changeSetItems.changeSetId, changeSetId), eq(changeSetItems.projectId, projectId)))
      .orderBy(changeSetItems.position);
  }

  /** Newest reversible Change Set that has not already been undone. */
  async undoCandidate(projectId: string, transaction: TransactionLike | Database = this.database) {
    const [candidate] = await transaction.select().from(changeSets)
      .where(and(eq(changeSets.projectId, projectId), eq(changeSets.reversible, true), isNull(changeSets.undoneAt), notInArray(changeSets.operation, HISTORY_OPERATIONS)))
      .orderBy(desc(changeSets.sequence)).limit(1);
    return candidate ?? null;
  }

  /**
   * Most recently undone Change Set, valid only while no forward work has landed since
   * the Undo that reverted it — new work invalidates Redo.
   */
  async redoCandidate(projectId: string, transaction: TransactionLike | Database = this.database) {
    const [candidate] = await transaction.select({ changeSet: changeSets, undoSequence: drizzleSql<number>`undo_set.sequence`.as("undo_sequence") })
      .from(changeSets)
      .innerJoin(drizzleSql`change_sets AS undo_set`, drizzleSql`undo_set.id = ${changeSets.undoneByChangeSetId}`)
      .where(and(eq(changeSets.projectId, projectId), isNotNull(changeSets.undoneAt)))
      .orderBy(desc(changeSets.undoneAt)).limit(1);
    if (!candidate) return null;
    const [newer] = await transaction.select({ id: changeSets.id }).from(changeSets)
      .where(and(eq(changeSets.projectId, projectId), notInArray(changeSets.operation, HISTORY_OPERATIONS), drizzleSql`${changeSets.sequence} > ${candidate.undoSequence}`))
      .limit(1);
    return newer ? null : candidate.changeSet;
  }

  /** Recent project history for the Builder, newest first. */
  async list(projectId: string, limit = 25) {
    const rows = await this.database.select({ changeSet: changeSets, actor: users.displayName })
      .from(changeSets).innerJoin(users, eq(users.id, changeSets.actorUserId))
      .where(eq(changeSets.projectId, projectId))
      .orderBy(desc(changeSets.sequence)).limit(limit);
    return rows.map(({ changeSet, actor }) => ({
      id: changeSet.id, operation: changeSet.operation, summary: changeSet.summary, reversible: changeSet.reversible,
      undone: Boolean(changeSet.undoneAt), actor, createdAt: changeSet.createdAt,
    }));
  }

  /**
   * How many changes this project has recorded since `since`, or in total when
   * there is no `since`. Counted in the database rather than over `list()`,
   * whose window is capped: a client counting rows would silently under-report
   * once a project has more recent changes than that window holds.
   *
   * The caller has already authorized access to the project; the projectId
   * filter here is what keeps the count inside that project.
   */
  async countSince(projectId: string, since: Date | null) {
    const [row] = await this.database.select({ total: drizzleSql<number>`count(*)::int` })
      .from(changeSets)
      .where(since ? and(eq(changeSets.projectId, projectId), gt(changeSets.createdAt, since)) : eq(changeSets.projectId, projectId));
    return row?.total ?? 0;
  }

  async entityHistory(projectId: string, entityType: ChangeSetEntityType, entityIds: string[]) {
    if (!entityIds.length) return [];
    return this.database.select().from(changeSetItems)
      .where(and(eq(changeSetItems.projectId, projectId), eq(changeSetItems.entityType, entityType), inArray(changeSetItems.entityId, entityIds)));
  }
}
