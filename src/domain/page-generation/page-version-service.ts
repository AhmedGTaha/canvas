import { and, desc, eq } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { pageNodes, pageVersions } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";

export class PageVersionService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}
  async getCurrent(userId: string, projectId: string, pageId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [row] = await this.database.select({ page: pageNodes, version: pageVersions }).from(pageNodes).leftJoin(pageVersions, eq(pageVersions.id, pageNodes.currentVersionId)).where(and(eq(pageNodes.id, pageId), eq(pageNodes.projectId, projectId), eq(pageNodes.type, "page"))).limit(1);
    if (!row) throw new DomainError("NOT_FOUND", "Page not found.");
    return row;
  }
  async get(userId: string, projectId: string, pageId: string, versionId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [version] = await this.database.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId), eq(pageVersions.projectId, projectId))).limit(1);
    if (!version) throw new DomainError("NOT_FOUND", "Page version not found.");
    return version;
  }
  async list(userId: string, projectId: string, pageId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    return this.database.select().from(pageVersions).where(and(eq(pageVersions.projectId, projectId), eq(pageVersions.pageId, pageId))).orderBy(desc(pageVersions.versionNumber));
  }
}

