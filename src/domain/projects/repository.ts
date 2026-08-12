import { and, asc, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { projectBrandSettings, projectMembers, projects, projectThemeSettings, users } from "@/server/db/schema";
import { DEFAULT_THEME } from "@/domain/theme/defaults";

export class ProjectRepository {
  constructor(private readonly database: Database = db) {}

  listActiveInWorkspace(workspaceId: string, ownerUserId: string) {
    return this.database.select().from(projects).where(and(
      eq(projects.workspaceId, workspaceId),
      eq(projects.ownerUserId, ownerUserId),
      eq(projects.status, "active"),
    )).orderBy(asc(projects.createdAt));
  }

  listActiveOwned(ownerUserId: string) {
    return this.database.select().from(projects).where(and(eq(projects.ownerUserId, ownerUserId), eq(projects.status, "active"))).orderBy(asc(projects.updatedAt));
  }

  listActiveShared(userId: string) {
    return this.database.select({ project: projects }).from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, "collaborator"), eq(projects.status, "active")))
      .orderBy(asc(projects.updatedAt));
  }

  async findById(id: string) {
    const [project] = await this.database.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project;
  }

  async findOwnerProfile(projectId: string) {
    const [owner] = await this.database.select({ id: users.id, displayName: users.displayName }).from(projects)
      .innerJoin(users, eq(users.id, projects.ownerUserId))
      .where(eq(projects.id, projectId))
      .limit(1);
    return owner;
  }

  async create(workspaceId: string, ownerUserId: string, name: string, description: string | null) {
    return this.database.transaction(async (transaction) => {
      const [project] = await transaction.insert(projects).values({ workspaceId, ownerUserId, name, description }).returning();
      if (!project) throw new Error("Project insert did not return a record.");
      await transaction.insert(projectBrandSettings).values({ projectId: project.id, companyName: project.name });
      await transaction.insert(projectThemeSettings).values({ projectId: project.id, ...DEFAULT_THEME });
      return project;
    });
  }

  async rename(id: string, ownerUserId: string, name: string) {
    const [project] = await this.database.update(projects).set({ name, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.ownerUserId, ownerUserId), eq(projects.status, "active"))).returning();
    return project;
  }
}
