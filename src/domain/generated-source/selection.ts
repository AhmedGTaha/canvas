import { z } from "zod";
import { AIError } from "@/domain/ai/provider";
import { CANVAS_ID_PATTERN, CANVAS_LABEL_MAX_LENGTH, USAGE_KEY_PATTERN } from "./limits";

/** One selectable region of a generated Page or Building Block Version. */
export type EditableElement = { canvasId: string; elementType: string; label: string | null };

/**
 * Untrusted selection metadata from the sandboxed Preview. It is only ever a lookup key:
 * the server resolves the real target from the active version manifest it already trusts.
 */
export const elementSelectionSchema = z.object({
  canvasId: z.string().regex(CANVAS_ID_PATTERN, "This selection is no longer valid."),
  blockId: z.uuid().nullish().transform((value) => value ?? null),
  usageKey: z.string().regex(USAGE_KEY_PATTERN).nullish().transform((value) => value ?? null),
}).strict();
export type ElementSelection = z.infer<typeof elementSelectionSchema>;

/** Selection resolved against a stored manifest, safe to persist and prompt with. */
export type ResolvedElementSelection = EditableElement & { ownerType: "page" | "building_block"; ownerId: string };

export const resolvedElementSelectionSchema = z.object({
  canvasId: z.string().regex(CANVAS_ID_PATTERN),
  elementType: z.string().max(60),
  label: z.string().max(CANVAS_LABEL_MAX_LENGTH).nullable(),
  ownerType: z.enum(["page", "building_block"]),
  ownerId: z.uuid(),
}).strict();

export function elementNotFound(): never {
  throw new AIError("AI_ELEMENT_NOT_FOUND", "That selection is no longer part of this page. Select the element again.");
}
export function elementStale(): never {
  throw new AIError("AI_ELEMENT_STALE", "This element changed while Canvas was working. Select it again and retry.");
}
export function elementInvalid(detail?: string): never {
  throw new AIError("AI_ELEMENT_INVALID", "Canvas could not apply this change to the selected element. Try again.", false, undefined, detail);
}

/** Reads the editable-element map out of a stored Page/Block Version manifest. */
export function manifestEditableElements(manifest: unknown): EditableElement[] {
  if (!manifest || typeof manifest !== "object") return [];
  const entries = (manifest as { editableElements?: unknown }).editableElements;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as { canvasId?: unknown; elementType?: unknown; label?: unknown };
    if (typeof item.canvasId !== "string" || !CANVAS_ID_PATTERN.test(item.canvasId)) return [];
    return [{ canvasId: item.canvasId, elementType: typeof item.elementType === "string" ? item.elementType : "element", label: typeof item.label === "string" ? item.label : null }];
  });
}

export function findEditableElement(manifest: unknown, canvasId: string) {
  return manifestEditableElements(manifest).find((element) => element.canvasId === canvasId) ?? null;
}

/** Short human-readable description used in prompts and the composer. */
export function describeElement(element: EditableElement) {
  return element.label ? `${element.label} (${element.elementType})` : element.elementType;
}

/** Restores a persisted selection, ignoring anything that no longer parses. */
export function readResolvedSelection(value: unknown): ResolvedElementSelection | null {
  if (!value || typeof value !== "object") return null;
  const parsed = resolvedElementSelectionSchema.safeParse((value as { selectedElement?: unknown }).selectedElement ?? value);
  return parsed.success ? parsed.data : null;
}
