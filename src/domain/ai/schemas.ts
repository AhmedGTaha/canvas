import { z } from "zod";
import { AI_LIMITS } from "./limits";

export const updateInstructionsSchema = z.object({ projectId: z.uuid(), expectedRevision: z.number().int().min(0), content: z.string().max(AI_LIMITS.projectInstructionsCharacters) });
export const createConversationSchema = z.object({ projectId: z.uuid(), pageId: z.uuid().nullable().optional() });
export const conversationReferenceSchema = z.object({ projectId: z.uuid(), conversationId: z.uuid() });
export const createAssistantJobSchema = z.object({
  projectId: z.uuid(), conversationId: z.uuid(), content: z.string().trim().min(1).max(AI_LIMITS.userMessageCharacters),
  selectedMediaIds: z.array(z.uuid()).max(AI_LIMITS.mediaEntries).default([]),
});
export const createPageJobSchema = z.object({ projectId: z.uuid(), pageId: z.uuid(), content: z.string().trim().min(1).max(AI_LIMITS.userMessageCharacters), selectedMediaIds: z.array(z.uuid()).max(5).default([]) });
