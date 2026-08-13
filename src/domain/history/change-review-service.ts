import { and, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiMessages, auditEvents, buildingBlocks, changeSetItems, changeSets, generationJobs, pageNodes } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { HistoryService } from "./undo-service";
import { ChangeSetService } from "./change-set-service";

export class ChangeReviewService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}
  async get(userId: string, projectId: string, jobId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [job] = await this.database.select().from(generationJobs).where(and(eq(generationJobs.id, jobId), eq(generationJobs.projectId, projectId), eq(generationJobs.status, "completed"))).limit(1);
    if (!job?.resultChangeSetId || (!job.resultPageVersionId && !job.resultBlockVersionId)) throw new DomainError("NOT_FOUND", "A committed change review is not available for this task.");
    const [changeSet] = await this.database.select().from(changeSets).where(and(eq(changeSets.id, job.resultChangeSetId), eq(changeSets.projectId, projectId))).limit(1);
    if (!changeSet) throw new DomainError("NOT_FOUND", "A committed change review is not available for this task.");
    const [prompt, items] = await Promise.all([
      job.promptMessageId ? this.database.select({ content: aiMessages.content }).from(aiMessages).where(eq(aiMessages.id, job.promptMessageId)).limit(1) : [],
      this.database.select({ item: changeSetItems, pageName: pageNodes.name, pageRoute: pageNodes.routePath, blockName: buildingBlocks.name, blockGlobal: buildingBlocks.isGlobal })
        .from(changeSetItems).leftJoin(pageNodes, and(eq(pageNodes.id, changeSetItems.entityId), eq(pageNodes.projectId, projectId)))
        .leftJoin(buildingBlocks, and(eq(buildingBlocks.id, changeSetItems.entityId), eq(buildingBlocks.projectId, projectId)))
        .where(and(eq(changeSetItems.changeSetId, changeSet.id), eq(changeSetItems.projectId, projectId))).orderBy(changeSetItems.position),
    ]);
    const undo = await new ChangeSetService(this.database).undoCandidate(projectId);
    await this.database.insert(auditEvents).values({ projectId, userId, action: "ai.change_review_accessed", entityType: "change_set", entityId: changeSet.id });
    return { jobId: job.id, changeSetId: changeSet.id, request: prompt[0]?.content ?? "AI update", summary: changeSet.summary, completedAt: job.finishedAt, activeVersionId: job.resultPageVersionId ?? job.resultBlockVersionId,
      reusableContentAffected: items.some(({ blockGlobal }) => Boolean(blockGlobal)), canUndo: undo?.id === changeSet.id,
      entities: items.filter(({ item }) => item.entityId).map(({ item, pageName, pageRoute, blockName, blockGlobal }) => ({ type: item.entityType, id: item.entityId!, name: pageName ?? blockName ?? "Project", route: pageRoute, global: Boolean(blockGlobal), beforeVersionId: item.beforeVersionId, afterVersionId: item.afterVersionId })) };
  }
  async undo(userId: string, projectId: string, jobId: string) { const review = await this.get(userId, projectId, jobId); if (!review.canUndo) throw new DomainError("CONFLICT", "This update cannot be undone directly because newer work exists. Open Version history to review it safely."); return new HistoryService(this.database).undo(userId, projectId); }
}
