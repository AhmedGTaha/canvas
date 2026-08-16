import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { workspaces } from "@/server/db/schema";

export class WorkspaceRepository {
  constructor(private readonly database: Database = db) {}

  listOwned(userId: string) {
    return this.database.select().from(workspaces).where(and(eq(workspaces.ownerUserId, userId), isNull(workspaces.archivedAt))).orderBy(asc(workspaces.createdAt));
  }

  listArchivedOwned(userId: string) {
    return this.database.select().from(workspaces).where(and(eq(workspaces.ownerUserId, userId), isNotNull(workspaces.archivedAt))).orderBy(desc(workspaces.archivedAt));
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
    const [workspace] = await this.database.update(workspaces).set({ name, updatedAt: new Date() }).where(and(eq(workspaces.id, id), eq(workspaces.ownerUserId, ownerUserId), isNull(workspaces.archivedAt))).returning();
    return workspace;
  }

  async archive(id: string, ownerUserId: string) {
    const now = new Date();
    const [workspace] = await this.database.update(workspaces).set({ archivedAt: now, updatedAt: now }).where(and(eq(workspaces.id, id), eq(workspaces.ownerUserId, ownerUserId), isNull(workspaces.archivedAt))).returning();
    return workspace;
  }

  async restore(id: string, ownerUserId: string) {
    const now = new Date();
    const [workspace] = await this.database.update(workspaces).set({ archivedAt: null, updatedAt: now }).where(and(eq(workspaces.id, id), eq(workspaces.ownerUserId, ownerUserId), isNotNull(workspaces.archivedAt))).returning();
    return workspace;
  }
}
