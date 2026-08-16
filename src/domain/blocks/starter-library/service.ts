import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type Database } from "@/server/db/client";
import { auditEvents, buildingBlocks, buildingBlockVersions, mediaAssets, pageNodes, projectBrandSettings, projects } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { recordChangeSet } from "@/domain/history/change-set-service";
import { projectIdSchema } from "@/domain/projects/schemas";
import { validateGeneratedBlockSource } from "@/domain/blocks/validation";
import { compileGeneratedBlock } from "@/domain/blocks/validation";
import { uniqueBlockName } from "@/domain/blocks/duplication";
import { findStarterSection, type StarterContext } from "./catalog";

export const useStarterSectionSchema = z.object({
  projectId: projectIdSchema,
  starterId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120).optional(),
  isGlobal: z.boolean().optional(),
}).strict();

/**
 * Copying a built-in starter into a project.
 *
 * The catalog entry is never referenced afterwards: what the project gets is a normal
 * Building Block with a normal first Block Version, created by this user, with an
 * ordinary Change Set behind it. From that moment it behaves like a block someone
 * generated — the agent can edit it, it can be duplicated, made global, versioned again,
 * archived — and updating the catalog never touches it.
 *
 * The template's output is validated by the same authority as AI-generated block source,
 * so a starter cannot smuggle anything past the generated-source policy.
 */
export class StarterSectionService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  async use(userId: string, input: unknown) {
    const parsed = useStarterSectionSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    return this.database.transaction((transaction) => this.createWithin(transaction, userId, parsed));
  }

  /**
   * Builds a starter only for the sandboxed Preview. The template source and its bundle
   * remain server-side; the browser receives the same opaque preview document that an
   * installed Building Block uses. This lets someone inspect the real layout without
   * creating an unwanted block just to look at it.
   */
  async preview(userId: string, input: unknown) {
    const parsed = useStarterSectionSchema.pick({ projectId: true, starterId: true }).parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const starter = findStarterSection(parsed.starterId);
    if (!starter) throw new DomainError("NOT_FOUND", "That starter section is not in the Canvas library.");

    const [context, scope] = await Promise.all([this.context(parsed.projectId), this.validationScope(parsed.projectId)]);
    const sourceCode = starter.build(context);
    await validateGeneratedBlockSource({ sourceCode, approvedMediaIds: scope.approvedMediaIds, activeRoutes: scope.activeRoutes })
      .catch((error: unknown) => {
        throw new DomainError("VALIDATION", error instanceof Error && error.message ? error.message : "That starter section could not be prepared.");
      });
    return { starter, bundle: await compileGeneratedBlock(sourceCode) };
  }

  /**
   * The whole instantiation, inside a caller's transaction.
   *
   * Adding a starter to a page is one act to the person doing it, so it has to be one
   * act to the database too: before this existed, the client created the block and then
   * attached it in a second request, and any failure of the second left an orphan block
   * in the library that nobody had asked for.
   */
  async createWithin(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    userId: string,
    parsed: { projectId: string; starterId: string; name?: string; isGlobal?: boolean },
  ) {
    const starter = findStarterSection(parsed.starterId);
    if (!starter) throw new DomainError("NOT_FOUND", "That starter section is not in the Canvas library.");

    const context = await this.context(parsed.projectId);
    const sourceCode = starter.build(context);
    const scope = await this.validationScope(parsed.projectId);
    const manifest = await validateGeneratedBlockSource({ sourceCode, approvedMediaIds: scope.approvedMediaIds, activeRoutes: scope.activeRoutes })
      .catch((error: unknown) => {
        // A starter that cannot pass the shared policy is a defect in the catalog, not
        // something to route around by relaxing the policy.
        throw new DomainError("VALIDATION", error instanceof Error && error.message ? error.message : "That starter section could not be prepared.");
      });

    {
      const existing = await transaction.select({ name: buildingBlocks.name }).from(buildingBlocks)
        .where(and(eq(buildingBlocks.projectId, parsed.projectId), isNull(buildingBlocks.deletedAt)));
      const name = uniqueBlockName(parsed.name?.trim() || starter.name, existing.map((item) => item.name));
      const [block] = await transaction.insert(buildingBlocks).values({
        projectId: parsed.projectId, name, kind: starter.kind, isGlobal: parsed.isGlobal ?? false, createdByUserId: userId,
      }).returning();
      if (!block) throw new DomainError("VALIDATION", "That section could not be created.");

      const versionId = randomUUID();
      const changeSummary = { headline: `Added ${starter.name} from the Canvas library`, changes: [starter.description], limitations: [] };
      const changeSet = await recordChangeSet(transaction, {
        projectId: parsed.projectId, actorUserId: userId, operation: "block_generate",
        summary: `${name}: added from the Canvas library`,
        items: [{ entityType: "building_block", entityId: block.id, beforeVersionId: null, afterVersionId: versionId, afterState: { isGlobal: block.isGlobal, archived: false } }],
      });
      const [version] = await transaction.insert(buildingBlockVersions).values({
        id: versionId, changeSetId: changeSet.id, projectId: parsed.projectId, buildingBlockId: block.id,
        versionNumber: 1, sourceCode, manifest, changeSummary, sourceHash: manifest.sourceHash, createdByUserId: userId,
      }).returning();
      if (!version) throw new DomainError("VALIDATION", "That section's first version could not be created.");
      await transaction.update(buildingBlocks).set({ currentVersionId: version.id, updatedAt: new Date() }).where(eq(buildingBlocks.id, block.id));
      await transaction.insert(auditEvents).values([
        { projectId: parsed.projectId, userId, action: "block.created", entityType: "building_block", entityId: block.id, metadata: { kind: block.kind, isGlobal: block.isGlobal, starterId: starter.id } },
        { projectId: parsed.projectId, userId, action: "block.version_created", entityType: "building_block_version", entityId: version.id, metadata: { blockId: block.id, versionNumber: 1, starterId: starter.id } },
      ]);
      return { ...block, currentVersionId: version.id, starterId: starter.id };
    }
  }

  /** The little a template is allowed to know: the company's name and its real routes. */
  private async context(projectId: string): Promise<StarterContext> {
    const [[project], [brand], nodes] = await Promise.all([
      this.database.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).limit(1),
      this.database.select({ companyName: projectBrandSettings.companyName }).from(projectBrandSettings).where(eq(projectBrandSettings.projectId, projectId)).limit(1),
      this.database.select({ name: pageNodes.name, routePath: pageNodes.routePath, type: pageNodes.type, position: pageNodes.position, isHomepage: pageNodes.isHomepage })
        .from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))).orderBy(pageNodes.position),
    ]);
    const links = nodes
      .filter((node) => node.type === "page" && node.routePath)
      .sort((a, b) => Number(b.isHomepage) - Number(a.isHomepage) || a.position - b.position)
      .map((node) => ({ name: node.name, href: node.routePath! }));
    return { companyName: brand?.companyName || project?.name || "Your company", links };
  }

  private async validationScope(projectId: string) {
    const [media, pages] = await Promise.all([
      this.database.select({ id: mediaAssets.id }).from(mediaAssets).where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.deletedAt))),
      this.database.select({ routePath: pageNodes.routePath, type: pageNodes.type }).from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))),
    ]);
    return {
      approvedMediaIds: new Set(media.map(({ id }) => id)),
      activeRoutes: new Set(pages.filter((page) => page.type === "page" && page.routePath).map((page) => page.routePath!)),
    };
  }
}
