import { z } from "zod";
import { AIError } from "@/domain/ai/provider";

/**
 * PageDesignPlan: a first-class, structured design decision that precedes source
 * generation for a new page.
 *
 * The schema structures design *reasoning* without becoming another template library. The
 * primary design description lives in open free-text fields (`composition`, `concept`,
 * `contentGoal` …). A small set of generic `structuralTraits` exists only so Canvas can
 * fingerprint and compare composition deterministically — they are comparison metadata,
 * never a menu of layouts to pick from. There is deliberately no `hero = centered | split`
 * enum, because that would move the template problem into the schema.
 */

export const DESIGN_PLAN_SCHEMA_VERSION = 1 as const;

export const WIDTH_TREATMENTS = ["contained", "full_bleed", "mixed"] as const;
export const ALIGNMENTS = ["left", "center", "right", "asymmetric", "mixed"] as const;
export const DENSITIES = ["compact", "balanced", "airy"] as const;
export const MEDIA_EMPHASES = ["none", "supporting", "dominant", "background"] as const;
export const REPETITIONS = ["none", "list", "grid", "sequence", "table", "custom"] as const;

const shortText = z.string().trim().min(1).max(400);
const longText = z.string().trim().min(1).max(1200);
const idText = z.string().trim().min(1).max(64);

export const structuralTraitsSchema = z.object({
  widthTreatment: z.enum(WIDTH_TREATMENTS),
  alignment: z.enum(ALIGNMENTS),
  density: z.enum(DENSITIES),
  mediaEmphasis: z.enum(MEDIA_EMPHASES),
  repetition: z.enum(REPETITIONS),
  approximateColumns: z.number().int().min(1).max(12).nullable(),
}).strict();

export const pageDesignSectionSchema = z.object({
  id: idText,
  role: shortText,
  contentGoal: shortText,
  composition: longText,
  focalPoint: shortText,
  responsiveBehavior: shortText,
  mediaRole: shortText.nullable(),
  structuralTraits: structuralTraitsSchema,
}).strict();

export const pageDesignPlanSchema = z.object({
  id: idText,
  pageIntent: z.object({
    primaryGoal: shortText,
    audience: shortText,
    desiredAction: shortText.nullable(),
  }).strict(),
  artDirection: z.object({
    concept: shortText,
    mood: shortText,
    visualMotifs: z.array(shortText).max(8).default([]),
    densityRhythm: shortText,
    mediaStrategy: shortText,
  }).strict(),
  sections: z.array(pageDesignSectionSchema).min(1).max(12),
  responsiveStrategy: shortText,
  continuity: z.object({
    sharedSiteLanguage: z.array(shortText).max(12).default([]),
    deliberatePageDifferences: z.array(shortText).max(12).default([]),
  }).strict(),
  originalityRationale: longText,
}).strict();

export const pageDesignPlanBundleSchema = z.object({
  schemaVersion: z.literal(DESIGN_PLAN_SCHEMA_VERSION),
  candidates: z.array(pageDesignPlanSchema).length(3),
  selectedCandidateId: idText,
  selectionRationale: shortText,
}).strict().superRefine((value, context) => {
  const ids = value.candidates.map((candidate) => candidate.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Candidate plan ids must be unique." });
  }
  if (!ids.includes(value.selectedCandidateId)) {
    context.addIssue({ code: "custom", message: "selectedCandidateId must name one of the candidates." });
  }
});

export type StructuralTraits = z.infer<typeof structuralTraitsSchema>;
export type PageDesignSection = z.infer<typeof pageDesignSectionSchema>;
export type PageDesignPlan = z.infer<typeof pageDesignPlanSchema>;
export type PageDesignPlanBundle = z.infer<typeof pageDesignPlanBundleSchema>;

function designPlanInvalid(detail: string): never {
  throw new AIError("AI_DESIGN_PLAN_INVALID", "Canvas could not produce a usable design plan for this page. Try again.", false, undefined, detail);
}

/**
 * Parses and validates a design-plan bundle returned by the planner. Server-side only —
 * the model's raw response is never trusted. Returns the selected plan together with the
 * full validated bundle. A schema failure is surfaced as a repairable AIError so the
 * generation runner's bounded structured-response repair can attempt a correction.
 */
export function validatePageDesignPlanBundle(data: unknown): { bundle: PageDesignPlanBundle; selected: PageDesignPlan } {
  const parsed = pageDesignPlanBundleSchema.safeParse(data);
  if (!parsed.success) designPlanInvalid(parsed.error.issues.map((issue) => issue.message).join("; ").slice(0, 300));
  const bundle = parsed.data;
  const selected = bundle.candidates.find((candidate) => candidate.id === bundle.selectedCandidateId);
  if (!selected) designPlanInvalid("selected candidate missing after validation");
  return { bundle, selected };
}

/**
 * Compact design-plan metadata persisted alongside an activated Page Version. It carries
 * only what same-project composition comparison needs — never prompt content, hidden
 * reasoning, or rejected candidates. The fingerprint lives here so later pages can be
 * compared against this one without re-running the planner.
 */
export type PersistedDesignPlan<Fingerprint = unknown> = {
  schemaVersion: typeof DESIGN_PLAN_SCHEMA_VERSION;
  pageIntent: string;
  sectionRoles: string[];
  compositionFingerprint: Fingerprint;
};

export function persistedDesignPlanFrom<Fingerprint>(plan: PageDesignPlan, fingerprint: Fingerprint): PersistedDesignPlan<Fingerprint> {
  return {
    schemaVersion: DESIGN_PLAN_SCHEMA_VERSION,
    pageIntent: plan.pageIntent.primaryGoal,
    sectionRoles: plan.sections.map((section) => section.role),
    compositionFingerprint: fingerprint,
  };
}

/** JSON Schema for provider structured output. Zod remains the validation authority. */
const traitsJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["widthTreatment", "alignment", "density", "mediaEmphasis", "repetition", "approximateColumns"],
  properties: {
    widthTreatment: { type: "string", enum: [...WIDTH_TREATMENTS] },
    alignment: { type: "string", enum: [...ALIGNMENTS] },
    density: { type: "string", enum: [...DENSITIES] },
    mediaEmphasis: { type: "string", enum: [...MEDIA_EMPHASES] },
    repetition: { type: "string", enum: [...REPETITIONS] },
    approximateColumns: { type: "integer", description: "Approximate column count for this section, or null when it does not apply." },
  },
} as const;

const sectionJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "role", "contentGoal", "composition", "focalPoint", "responsiveBehavior", "mediaRole", "structuralTraits"],
  properties: {
    id: { type: "string", description: "Stable short id for this section, unique within the plan." },
    role: { type: "string", description: "This section's job on the page, in a few words." },
    contentGoal: { type: "string", description: "What this section must make the visitor understand or do." },
    composition: { type: "string", description: "How this section is laid out — the primary free-text design description. Be specific to this page's content." },
    focalPoint: { type: "string", description: "The one thing the eye should land on first." },
    responsiveBehavior: { type: "string", description: "How this section reflows on small screens." },
    mediaRole: { type: "string", description: "The role imagery plays in this section, or null when it uses none." },
    structuralTraits: traitsJsonSchema,
  },
} as const;

const planJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "pageIntent", "artDirection", "sections", "responsiveStrategy", "continuity", "originalityRationale"],
  properties: {
    id: { type: "string", description: "Stable short id for this candidate plan, unique within the bundle." },
    pageIntent: {
      type: "object", additionalProperties: false, required: ["primaryGoal", "audience", "desiredAction"],
      properties: {
        primaryGoal: { type: "string" }, audience: { type: "string" },
        desiredAction: { type: "string", description: "The primary action for the visitor, or null." },
      },
    },
    artDirection: {
      type: "object", additionalProperties: false, required: ["concept", "mood", "visualMotifs", "densityRhythm", "mediaStrategy"],
      properties: {
        concept: { type: "string" }, mood: { type: "string" },
        visualMotifs: { type: "array", maxItems: 8, items: { type: "string" } },
        densityRhythm: { type: "string" }, mediaStrategy: { type: "string" },
      },
    },
    sections: { type: "array", minItems: 1, maxItems: 12, items: sectionJsonSchema },
    responsiveStrategy: { type: "string" },
    continuity: {
      type: "object", additionalProperties: false, required: ["sharedSiteLanguage", "deliberatePageDifferences"],
      properties: {
        sharedSiteLanguage: { type: "array", maxItems: 12, items: { type: "string" } },
        deliberatePageDifferences: { type: "array", maxItems: 12, items: { type: "string" } },
      },
    },
    originalityRationale: { type: "string", description: "Why this composition fits this page's job rather than a generic shape." },
  },
} as const;

export const pageDesignPlanBundleJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "candidates", "selectedCandidateId", "selectionRationale"],
  properties: {
    schemaVersion: { type: "integer", enum: [DESIGN_PLAN_SCHEMA_VERSION] },
    candidates: { type: "array", minItems: 3, maxItems: 3, items: planJsonSchema, description: "Exactly three meaningfully different candidate plans." },
    selectedCandidateId: { type: "string", description: "The id of the strongest candidate." },
    selectionRationale: { type: "string", description: "Why the selected candidate best fits this page and business." },
  },
} as const;
