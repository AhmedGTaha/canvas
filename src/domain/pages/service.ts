import { and, asc, eq, inArray, isNull, sql as drizzleSql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { DomainError } from "@/domain/shared/errors";
import { pageNodes, type PageNode } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { copyName, copySlug, generateSlug } from "./slug";
import { computePageRoutes, descendantIds } from "./routes";
import { createNodeSchema, moveNodeSchema, pageMutationSchema, renameNodeSchema, reorderNodeSchema, updateSeoSchema, updateSlugSchema } from "./schemas";
import { PageTreeRepository } from "./repository";

type ActiveNode = PageNode;

export class PageTreeService {
  constructor(
    private readonly repository = new PageTreeRepository(),
    private readonly access = new ProjectAccessService(),
  ) {}

  async listTree(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    return (await this.repository.listActive(projectId)).filter((node) => !node.deletedAt);
  }

  private async mutate<T>(userId: string, projectId: string, operation: (context: { nodes: ActiveNode[]; transaction: Parameters<Parameters<typeof db.transaction>[0]>[0] }) => Promise<T>) {
    await this.access.requireProjectAccess(userId, projectId);
    return db.transaction(async (transaction) => {
      await transaction.execute(drizzleSql`select pg_advisory_xact_lock(hashtext(${projectId}))`);
      const nodes = await transaction.select().from(pageNodes).where(and(eq(pageNodes.projectId, projectId), isNull(pageNodes.deletedAt))).orderBy(asc(pageNodes.position)).for("update");
      return operation({ nodes, transaction });
    });
  }

  private node(nodes: ActiveNode[], id: string) {
    const node = nodes.find((candidate) => candidate.id === id);
    if (!node) throw new DomainError("NOT_FOUND", "Page or folder not found.");
    return node;
  }

  private validateParent(nodes: ActiveNode[], parentId: string | null) {
    return parentId ? this.node(nodes, parentId) : null;
  }

  private nextPosition(nodes: ActiveNode[], parentId: string | null) {
    const siblings = nodes.filter((node) => node.parentId === parentId);
    return siblings.length ? Math.max(...siblings.map((node) => node.position)) + 1 : 0;
  }

  private async persistRoutes(transaction: Parameters<Parameters<typeof db.transaction>[0]>[0], nodes: ActiveNode[]) {
    const routes = computePageRoutes(nodes);
    const pages = nodes.filter((node) => node.type === "page").sort((a, b) => Number(a.isHomepage) - Number(b.isHomepage));
    for (const node of pages) {
      const routePath = routes.get(node.id);
      node.routePath = routePath ?? null;
      await transaction.update(pageNodes).set({ routePath, updatedAt: new Date() }).where(eq(pageNodes.id, node.id));
    }
  }

  async create(userId: string, input: unknown) {
    const parsed = createNodeSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      this.validateParent(nodes, parsed.parentId);
      const isHomepage = parsed.type === "page" && !nodes.some((node) => node.type === "page");
      const slug = parsed.type === "page" ? (parsed.slug ?? generateSlug(parsed.name)) : null;
      const draft: ActiveNode = {
        id: crypto.randomUUID(), projectId: parsed.projectId, parentId: parsed.parentId, type: parsed.type, name: parsed.name,
        slug, routePath: null, position: this.nextPosition(nodes, parsed.parentId), isHomepage, pageTitle: null, metaDescription: null,
        createdByUserId: userId, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
        currentVersionId: null,
      };
      const routes = computePageRoutes([...nodes, draft]);
      draft.routePath = routes.get(draft.id) ?? null;
      const [created] = await transaction.insert(pageNodes).values(draft).returning();
      if (!created) throw new Error("Page node insert did not return a record.");
      return created;
    });
  }

  async rename(userId: string, input: unknown) {
    const parsed = renameNodeSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const node = this.node(nodes, parsed.nodeId);
      const [updated] = await transaction.update(pageNodes).set({ name: parsed.name, updatedAt: new Date() }).where(eq(pageNodes.id, node.id)).returning();
      return updated;
    });
  }

  async updateSlug(userId: string, input: unknown) {
    const parsed = updateSlugSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const node = this.node(nodes, parsed.nodeId);
      if (node.type !== "page") throw new DomainError("VALIDATION", "Folders do not have website URLs.");
      node.slug = parsed.slug;
      await transaction.update(pageNodes).set({ slug: parsed.slug, updatedAt: new Date() }).where(eq(pageNodes.id, node.id));
      await this.persistRoutes(transaction, nodes);
      return node;
    });
  }

  async updateSeo(userId: string, input: unknown) {
    const parsed = updateSeoSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const node = this.node(nodes, parsed.nodeId);
      if (node.type !== "page") throw new DomainError("VALIDATION", "SEO settings are available for pages only.");
      const [updated] = await transaction.update(pageNodes).set({ pageTitle: parsed.pageTitle, metaDescription: parsed.metaDescription, updatedAt: new Date() }).where(eq(pageNodes.id, node.id)).returning();
      return updated;
    });
  }

  async move(userId: string, input: unknown) {
    const parsed = moveNodeSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const node = this.node(nodes, parsed.nodeId);
      this.validateParent(nodes, parsed.newParentId);
      const descendants = descendantIds(nodes, node.id);
      if (parsed.newParentId && descendants.has(parsed.newParentId)) throw new DomainError("VALIDATION", parsed.newParentId === node.id ? "A page or folder cannot be moved inside itself." : "This item cannot be moved inside one of its children.");

      const oldParentId = node.parentId;
      const oldSiblings = nodes.filter((item) => item.parentId === oldParentId && item.id !== node.id).sort((a, b) => a.position - b.position);
      const newSiblings = (oldParentId === parsed.newParentId ? oldSiblings : nodes.filter((item) => item.parentId === parsed.newParentId && item.id !== node.id).sort((a, b) => a.position - b.position));
      const position = Math.min(parsed.newPosition, newSiblings.length);
      newSiblings.splice(position, 0, node);
      node.parentId = parsed.newParentId;
      oldSiblings.forEach((item, index) => { item.position = index; });
      newSiblings.forEach((item, index) => { item.position = index; });
      computePageRoutes(nodes);

      const affected = new Map([...oldSiblings, ...newSiblings].map((item) => [item.id, item]));
      for (const item of affected.values()) await transaction.update(pageNodes).set({ parentId: item.parentId, position: item.position, updatedAt: new Date() }).where(eq(pageNodes.id, item.id));
      await this.persistRoutes(transaction, nodes);
      return node;
    });
  }

  async reorder(userId: string, input: unknown) {
    const parsed = reorderNodeSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const node = this.node(nodes, parsed.nodeId);
      const siblings = nodes.filter((item) => item.parentId === node.parentId).sort((a, b) => a.position - b.position);
      const current = siblings.findIndex((item) => item.id === node.id);
      const target = parsed.direction === "up" ? current - 1 : current + 1;
      if (target < 0 || target >= siblings.length) return node;
      [siblings[current], siblings[target]] = [siblings[target]!, siblings[current]!];
      for (const [position, item] of siblings.entries()) {
        item.position = position;
        await transaction.update(pageNodes).set({ position, updatedAt: new Date() }).where(eq(pageNodes.id, item.id));
      }
      return node;
    });
  }

  async setHomepage(userId: string, input: unknown) {
    const parsed = pageMutationSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const next = this.node(nodes, parsed.nodeId);
      if (next.type !== "page") throw new DomainError("VALIDATION", "A folder cannot be the homepage.");
      const previous = nodes.find((node) => node.isHomepage);
      if (previous?.id === next.id) return next;
      if (previous) previous.isHomepage = false;
      next.isHomepage = true;
      computePageRoutes(nodes);
      if (previous) await transaction.update(pageNodes).set({ isHomepage: false }).where(eq(pageNodes.id, previous.id));
      await this.persistRoutes(transaction, nodes);
      await transaction.update(pageNodes).set({ isHomepage: true, routePath: "/", updatedAt: new Date() }).where(eq(pageNodes.id, next.id));
      next.routePath = "/";
      return next;
    });
  }

  async duplicatePage(userId: string, input: unknown) {
    const parsed = pageMutationSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      const source = this.node(nodes, parsed.nodeId);
      if (source.type !== "page") throw new DomainError("VALIDATION", "Only pages can be duplicated.");
      let copyNumber = 1;
      let draft: ActiveNode;
      while (true) {
        draft = { ...source, id: crypto.randomUUID(), name: copyName(source.name, copyNumber), slug: copySlug(source.slug!, copyNumber), routePath: null, isHomepage: false, position: source.position + 1, createdByUserId: userId, createdAt: new Date(), updatedAt: new Date() };
        try { computePageRoutes([...nodes, draft]); break; } catch (error) { if (error instanceof DomainError && error.code === "CONFLICT") { copyNumber++; continue; } throw error; }
      }
      const siblings = nodes.filter((node) => node.parentId === source.parentId && node.position > source.position);
      for (const sibling of siblings) await transaction.update(pageNodes).set({ position: sibling.position + 1 }).where(eq(pageNodes.id, sibling.id));
      draft.routePath = computePageRoutes([...nodes, draft]).get(draft.id)!;
      const [created] = await transaction.insert(pageNodes).values(draft).returning();
      if (!created) throw new Error("Page duplication did not return a record.");
      return created;
    });
  }

  async deleteSubtree(userId: string, input: unknown) {
    const parsed = pageMutationSchema.parse(input);
    return this.mutate(userId, parsed.projectId, async ({ nodes, transaction }) => {
      this.node(nodes, parsed.nodeId);
      const ids = descendantIds(nodes, parsed.nodeId);
      if (nodes.some((node) => ids.has(node.id) && node.isHomepage)) throw new DomainError("CONFLICT", "Choose another homepage before deleting this page.");
      const now = new Date();
      await transaction.update(pageNodes).set({ deletedAt: now, updatedAt: now }).where(inArray(pageNodes.id, [...ids]));
      const survivors = nodes.filter((node) => !ids.has(node.id));
      const parentIds = new Set(nodes.filter((node) => ids.has(node.id)).map((node) => node.parentId));
      for (const parentId of parentIds) {
        const siblings = survivors.filter((node) => node.parentId === parentId).sort((a, b) => a.position - b.position);
        for (const [position, sibling] of siblings.entries()) await transaction.update(pageNodes).set({ position }).where(eq(pageNodes.id, sibling.id));
      }
      return { deletedCount: ids.size };
    });
  }
}
