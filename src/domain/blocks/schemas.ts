import { z } from "zod";
import { projectIdSchema } from "@/domain/projects/schemas";
import { AI_LIMITS } from "@/domain/ai/limits";
import { elementSelectionSchema } from "@/domain/generated-source/selection";

/**
 * Suggested semantic categories. The stored `kind` is an open slug so new categories
 * never require a migration; these values only drive friendly labels in the UI.
 */
export const SUGGESTED_BLOCK_KINDS = ["navbar", "footer", "hero", "section", "card", "pricing", "testimonial", "contact", "custom"] as const;
export const BLOCK_KIND_LABELS: Record<string, string> = {
  navbar: "Navbar", footer: "Footer", hero: "Hero", section: "Section", card: "Card",
  pricing: "Pricing", testimonial: "Testimonial", contact: "Contact", custom: "Custom",
};
export function blockKindLabel(kind: string) {
  return BLOCK_KIND_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

export const blockIdSchema = z.uuid("Building Block not found.");
export const blockNameSchema = z.string().trim().min(1, "Enter a name.").max(120, "Name must be 120 characters or fewer.");
export const blockKindSchema = z.string().trim().toLowerCase().max(40, "Category must be 40 characters or fewer.").regex(/^[a-z][a-z0-9_]*$/, "Use lowercase letters, numbers, and underscores only.");

export const createBlockSchema = z.object({
  projectId: projectIdSchema,
  name: blockNameSchema,
  kind: blockKindSchema.default("custom"),
  isGlobal: z.boolean().default(false),
});
export const blockReferenceSchema = z.object({ projectId: projectIdSchema, blockId: blockIdSchema });
export const updateBlockSchema = blockReferenceSchema.extend({
  name: blockNameSchema.optional(),
  kind: blockKindSchema.optional(),
});
export const setBlockGlobalSchema = blockReferenceSchema.extend({ isGlobal: z.boolean() });
export const listBlocksSchema = z.object({ projectId: projectIdSchema, search: z.string().trim().max(120).optional(), includeArchived: z.boolean().default(false) });

export const createBlockJobSchema = z.object({
  projectId: projectIdSchema,
  blockId: blockIdSchema,
  content: z.string().trim().min(1, "Describe what you want Canvas to build.").max(AI_LIMITS.userMessageCharacters),
  selectedMediaIds: z.array(z.uuid()).max(5).default([]),
  selection: elementSelectionSchema.nullish().transform((value) => value ?? null),
});
