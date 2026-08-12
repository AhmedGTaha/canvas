import { and, asc, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { workspaces } from "@/server/db/schema";

export class WorkspaceRepository {
  constructor(private readonly database: Database = db) {}

  listOwned(userId: string) {
    return this.database.select().from(workspaces).where(eq(workspaces.ownerUserId, userId)).orderBy(asc(workspaces.createdAt));
  }

  async findById(id: string) {
    const [workspace] = await this.database.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return workspace;
  }

  async findOwned(id: string, userId: string) {
    const [workspace] = await this.database.select().from(workspaces).where(and(eq(workspaces.id, id), eq(workspaces.ownerUserId, userId))).limit(1);
    return workspace;
  }

  async create(ownerUserId: string, name: string) {
    const [workspace] = await this.database.insert(workspaces).values({ ownerUserId, name }).returning();
    if (!workspace) throw new Error("Workspace insert did not return a record.");
    return workspace;
  }

  async rename(id: string, ownerUserId: string, name: string) {
    const [workspace] = await this.database.update(workspaces).set({ name, updatedAt: new Date() }).where(and(eq(workspaces.id, id), eq(workspaces.ownerUserId, ownerUserId))).returning();
    return workspace;
  }
}
