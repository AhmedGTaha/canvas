import { desc, eq, sql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { buildingBlocks, exportJobs, generationJobs, pageNodes, users } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { safeTaskStage, taskStatus, type ProjectTask } from "./model";

export class TaskService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}
  async list(userId: string, projectId: string): Promise<ProjectTask[]> {
    await this.access.requireProjectAccess(userId, projectId);
    const [generations, exports] = await Promise.all([
      this.database.select({ job: generationJobs, actor: users.displayName, pageName: pageNodes.name, blockName: buildingBlocks.name })
        .from(generationJobs).innerJoin(users, eq(users.id, generationJobs.actorUserId))
        .leftJoin(pageNodes, sql`${generationJobs.targetType} = 'page' AND ${pageNodes.id} = ${generationJobs.targetId} AND ${pageNodes.projectId} = ${generationJobs.projectId}`)
        .leftJoin(buildingBlocks, sql`${generationJobs.targetType} = 'building_block' AND ${buildingBlocks.id} = ${generationJobs.targetId} AND ${buildingBlocks.projectId} = ${generationJobs.projectId}`)
        .where(eq(generationJobs.projectId, projectId)).orderBy(desc(generationJobs.createdAt)).limit(30),
      this.database.select({ job: exportJobs, actor: users.displayName }).from(exportJobs).innerJoin(users, eq(users.id, exportJobs.actorUserId)).where(eq(exportJobs.projectId, projectId)).orderBy(desc(exportJobs.createdAt)).limit(20),
    ]);
    const generationTasks = generations.map(({ job, actor, pageName, blockName }): ProjectTask => {
      const status = taskStatus("generation", job.status); const target = pageName ?? blockName ?? "Project assistant";
      return { id: job.id, type: "generation", target, status, stage: safeTaskStage(status, job.progressStage), initiator: actor, startedAt: job.startedAt ?? job.createdAt, completedAt: job.finishedAt, summary: job.errorMessage,
        action: status === "completed" && job.resultChangeSetId ? { kind: "review", id: job.id } : status === "failed" ? { kind: "reopen", id: job.targetId ?? job.id } : null };
    });
    const exportTasks = exports.map(({ job, actor }): ProjectTask => { const status = taskStatus("export", job.status); return { id: job.id, type: "export", target: "Website export", status, stage: safeTaskStage(status, job.progressStage), initiator: actor, startedAt: job.startedAt ?? job.createdAt, completedAt: job.finishedAt, summary: job.errorMessage, action: status === "completed" ? { kind: "export", id: job.id } : status === "failed" ? { kind: "retry", id: job.id } : null }; });
    return [...generationTasks, ...exportTasks].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 40);
  }
}
