import { and, desc, eq, sql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { auditEvents, projectInstructions, projects } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { updateInstructionsSchema } from "./schemas";

export class ProjectInstructionService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  async read(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [record] = await this.database.select().from(projectInstructions).where(eq(projectInstructions.projectId, projectId)).orderBy(desc(projectInstructions.revisionNumber)).limit(1);
    return record ?? { id: null, projectId, content: "", revisionNumber: 0, createdByUserId: null, createdAt: null };
  }

  async history(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    return this.database.select().from(projectInstructions).where(eq(projectInstructions.projectId, projectId)).orderBy(desc(projectInstructions.revisionNumber));
  }

  async update(userId: string, input: unknown) {
    const parsed = updateInstructionsSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`instructions:${parsed.projectId}`}))`);
      const [project] = await transaction.select({ currentInstructionId: projects.currentInstructionId }).from(projects).where(eq(projects.id, parsed.projectId)).for("update");
      if (!project) throw new DomainError("NOT_FOUND", "Project not found.");
      const [current] = project.currentInstructionId
        ? await transaction.select().from(projectInstructions).where(and(eq(projectInstructions.projectId, parsed.projectId), eq(projectInstructions.id, project.currentInstructionId))).limit(1)
        : [];
      const revision = current?.revisionNumber ?? 0;
      if (revision !== parsed.expectedRevision) throw new DomainError("CONFLICT", "Project instructions changed elsewhere. Refresh before saving.");
      if ((current?.content ?? "") === parsed.content) return current ?? { id: null, projectId: parsed.projectId, content: "", revisionNumber: 0, createdByUserId: null, createdAt: null };
      const [created] = await transaction.insert(projectInstructions).values({ projectId: parsed.projectId, content: parsed.content, revisionNumber: revision + 1, createdByUserId: userId }).returning();
      if (!created) throw new Error("Instruction revision insert failed.");
      await transaction.update(projects).set({ currentInstructionId: created.id, updatedAt: new Date() }).where(eq(projects.id, parsed.projectId));
      await transaction.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "project.instructions_updated", entityType: "project_instruction", entityId: created.id, metadata: { revision: created.revisionNumber } });
      return created;
    });
  }
}

