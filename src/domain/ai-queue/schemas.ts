import { z } from "zod";
import { AI_LIMITS } from "@/domain/ai/limits";
import { elementSelectionSchema } from "@/domain/generated-source/selection";

export const queueFollowUpSchema = z.object({
  projectId: z.uuid(), targetType: z.enum(["page", "building_block"]), targetId: z.uuid(),
  prompt: z.string().trim().min(1).max(AI_LIMITS.userMessageCharacters), selectedMediaIds: z.array(z.uuid()).max(5).default([]),
  selection: elementSelectionSchema.nullish().transform((value) => value ?? null),
});
export const editFollowUpSchema = z.object({ prompt: z.string().trim().min(1).max(AI_LIMITS.userMessageCharacters), selectedMediaIds: z.array(z.uuid()).max(5).default([]), selection: elementSelectionSchema.nullish().transform((value) => value ?? null) });
