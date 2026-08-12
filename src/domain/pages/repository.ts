import { and, asc, eq, isNull } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { pageNodes } from "@/server/db/schema";

export class PageTreeRepository {
  constructor(private readonly database: Database = db) {}

  listActive(projectId: string) {
    return this.database.select().from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))).orderBy(asc(pageNodes.position), asc(pageNodes.createdAt));
  }
}
