import { z } from "zod";
import { CANVAS_ID_PATTERN, CANVAS_LABEL_MAX_LENGTH, USAGE_KEY_PATTERN } from "@/domain/generated-source/limits";

const canvasId = z.string().regex(CANVAS_ID_PATTERN);

export const parentPreviewMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CANVAS_NAVIGATE"), sessionId: z.string(), instanceId: z.uuid(), route: z.string().startsWith("/") }).strict(),
  z.object({ type: z.literal("CANVAS_REFRESH"), sessionId: z.string(), instanceId: z.uuid() }).strict(),
  z.object({ type: z.literal("CANVAS_SET_THEME"), sessionId: z.string(), instanceId: z.uuid(), mode: z.enum(["light", "dark"]) }).strict(),
  z.object({ type: z.literal("CANVAS_SET_SELECT_MODE"), sessionId: z.string(), instanceId: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("CANVAS_SELECT_ELEMENT"), sessionId: z.string(), instanceId: z.uuid(), canvasId, blockId: z.uuid().nullable() }).strict(),
  z.object({ type: z.literal("CANVAS_CLEAR_SELECTION"), sessionId: z.string(), instanceId: z.uuid() }).strict(),
]);
export const previewParentMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CANVAS_PREVIEW_READY"), sessionId: z.string(), instanceId: z.uuid(), route: z.string().startsWith("/") }).strict(),
  z.object({ type: z.literal("CANVAS_ROUTE_CHANGED"), sessionId: z.string(), instanceId: z.uuid(), route: z.string().startsWith("/"), pageId: z.uuid().nullable() }).strict(),
  z.object({ type: z.literal("CANVAS_PREVIEW_ERROR"), sessionId: z.string(), instanceId: z.uuid(), code: z.string(), route: z.string().startsWith("/"), pageId: z.uuid().nullable(), message: z.string().max(200) }).strict(),
  // Selection metadata is a controlled, minimal shape: no DOM, markup, or source escapes
  // the sandbox, and the parent still re-resolves the target server-side.
  z.object({
    type: z.literal("CANVAS_ELEMENT_SELECTED"), sessionId: z.string(), instanceId: z.uuid(),
    canvasId, elementType: z.string().max(60), label: z.string().max(CANVAS_LABEL_MAX_LENGTH).nullable(),
    blockId: z.uuid().nullable(), usageKey: z.string().regex(USAGE_KEY_PATTERN).nullable(),
    pageId: z.uuid().nullable(),
  }).strict(),
  z.object({ type: z.literal("CANVAS_ELEMENT_CLEARED"), sessionId: z.string(), instanceId: z.uuid() }).strict(),
]);

export type ParentPreviewMessage = z.infer<typeof parentPreviewMessageSchema>;
export type PreviewParentMessage = z.infer<typeof previewParentMessageSchema>;
export type PreviewElementSelection = Extract<PreviewParentMessage, { type: "CANVAS_ELEMENT_SELECTED" }>;

export function parsePreviewParentMessage(data: unknown, origin: string, sourceMatches: boolean, sessionId: string, instanceId: string) {
  if (origin !== "null" || !sourceMatches) return null;
  const parsed = previewParentMessageSchema.safeParse(data);
  if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.instanceId !== instanceId) return null;
  return parsed.data;
}

export function parseParentPreviewMessage(data: unknown, origin: string, expectedOrigin: string, sessionId: string, instanceId: string) {
  if (origin !== expectedOrigin) return null;
  const parsed = parentPreviewMessageSchema.safeParse(data);
  if (!parsed.success || parsed.data.sessionId !== sessionId || parsed.data.instanceId !== instanceId) return null;
  return parsed.data;
}
