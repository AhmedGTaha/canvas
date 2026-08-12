import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db, type Database } from "@/server/db/client";
import { aiConversations, aiMessages, auditEvents, pageNodes } from "@/server/db/schema";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DomainError } from "@/domain/shared/errors";
import { AI_LIMITS } from "./limits";
import { conversationReferenceSchema, createConversationSchema } from "./schemas";

export class AIConversationService {
  constructor(private readonly database: Database = db, private readonly access = new ProjectAccessService()) {}

  private async scoped(userId: string, projectId: string, conversationId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const [conversation] = await this.database.select().from(aiConversations).where(and(eq(aiConversations.id, conversationId), eq(aiConversations.projectId, projectId))).limit(1);
    if (!conversation) throw new DomainError("NOT_FOUND", "Conversation not found.");
    return conversation;
  }

  async create(userId: string, input: unknown) {
    const parsed = createConversationSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    if (parsed.pageId) {
      const [page] = await this.database.select({ id: pageNodes.id }).from(pageNodes).where(and(eq(pageNodes.id, parsed.pageId), eq(pageNodes.projectId, parsed.projectId), eq(pageNodes.type, "page"), isNull(pageNodes.deletedAt))).limit(1);
      if (!page) throw new DomainError("NOT_FOUND", "Page not found in this project.");
    }
    const [conversation] = await this.database.insert(aiConversations).values({ projectId: parsed.projectId, pageId: parsed.pageId ?? null, createdByUserId: userId }).returning();
    if (!conversation) throw new Error("Conversation insert failed.");
    await this.database.insert(auditEvents).values({ projectId: parsed.projectId, userId, action: "ai.conversation_created", entityType: "ai_conversation", entityId: conversation.id });
    return conversation;
  }

  async get(userId: string, input: unknown) { const parsed = conversationReferenceSchema.parse(input); return this.scoped(userId, parsed.projectId, parsed.conversationId); }
  async list(userId: string, projectId: string) { await this.access.requireProjectAccess(userId, projectId); return this.database.select().from(aiConversations).where(and(eq(aiConversations.projectId, projectId), isNull(aiConversations.archivedAt))).orderBy(desc(aiConversations.updatedAt)); }

  async history(userId: string, input: unknown) {
    const parsed = conversationReferenceSchema.parse(input);
    await this.scoped(userId, parsed.projectId, parsed.conversationId);
    const recent = await this.database.select().from(aiMessages).where(and(eq(aiMessages.conversationId, parsed.conversationId), ne(aiMessages.role, "system_internal"))).orderBy(desc(aiMessages.createdAt)).limit(AI_LIMITS.conversationMessages);
    return recent.reverse();
  }
}
