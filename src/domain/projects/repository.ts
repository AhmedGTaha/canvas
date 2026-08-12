import { and, asc, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { projects } from "@/server/db/schema";

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

  async findById(id: string) {
    const [project] = await this.database.select().from(projects).where(eq(projects.id, id)).limit(1);
    return project;
  }

  async create(workspaceId: string, ownerUserId: string, name: string, description: string | null) {
    const [project] = await this.database.insert(projects).values({ workspaceId, ownerUserId, name, description }).returning();
    if (!project) throw new Error("Project insert did not return a record.");
    return project;
  }

  async rename(id: string, ownerUserId: string, name: string) {
    const [project] = await this.database.update(projects).set({ name, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.ownerUserId, ownerUserId), eq(projects.status, "active"))).returning();
    return project;
  }
}
