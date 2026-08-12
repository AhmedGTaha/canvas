import { and, eq, sql } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { projectBrandSettings, projectThemeSettings } from "@/server/db/schema";
import type { BrandSettingsInput, ThemeSettingsInput } from "./schemas";
import { DEFAULT_THEME } from "./defaults";

export class BrandRepository {
  constructor(private readonly database: Database = db) {}
  async find(projectId: string) {
    const [record] = await this.database.select().from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1);
    return record;
  }
  async ensure(projectId: string, companyName: string) {
    await this.database.insert(projectBrandSettings).values({ projectId, companyName }).onConflictDoNothing();
    return this.find(projectId);
  }
  async update(projectId: string, expectedRevision: number, brand: BrandSettingsInput) {
    const [record] = await this.database.update(projectBrandSettings).set({ ...brand, revision: sql`${projectBrandSettings.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(projectBrandSettings.projectId, projectId), eq(projectBrandSettings.revision, expectedRevision))).returning();
    return record;
  }
}

export class ThemeRepository {
  constructor(private readonly database: Database = db) {}
  async find(projectId: string) {
    const [record] = await this.database.select().from(projectThemeSettings).where(eq(projectThemeSettings.projectId, projectId)).limit(1);
    return record;
  }
  async ensure(projectId: string) {
    await this.database.insert(projectThemeSettings).values({ projectId, ...DEFAULT_THEME }).onConflictDoNothing();
    return this.find(projectId);
  }
  async update(projectId: string, expectedRevision: number, theme: ThemeSettingsInput) {
    const [record] = await this.database.update(projectThemeSettings).set({ ...theme, revision: sql`${projectThemeSettings.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(projectThemeSettings.projectId, projectId), eq(projectThemeSettings.revision, expectedRevision))).returning();
    return record;
  }
}
