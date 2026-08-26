# Canvas Generation Quality, Usability, and UI Output Implementation Plan

## Purpose

Implement the approved Canvas improvements identified in the repository audit.

The central problem is not that the Theme system literally supplies a webpage template. The current Theme data correctly represents visual treatment such as colours, typography, radius, spacing, shadows, and borders. The generation problem comes from the shared runtime design grammar and generation flow. New pages are told to be creative, but they are simultaneously given semantic helpers such as `c-hero`, `c-card`, `c-grid`, `c-navbar`, `c-kicker`, and `c-surface`, and are told to "Build on them first." This creates a strong low-effort path toward the same page composition.

The implementation must establish and enforce this separation:

- **Theme = visual language**
- **Reusable Section / Building Block = intentionally shared composition**
- **Design Plan = page-specific hierarchy and composition**
- **Generated runtime = implementation infrastructure only**

The task is complete only when Canvas can generate websites that are visually creative and appropriate to the page/business while using the selected Theme as a visual language instead of reproducing a familiar Canvas-style layout.

---

# 0. Repository and execution rules

## 0.1 Read project instructions before editing

Before modifying code:

1. Read `CLAUDE.md`.
2. Read `CLAUDE.local.md`.
3. Read `AGENTS.md`.
4. Inspect `git status --short`.
5. Do not overwrite unrelated uncommitted work.
6. Do not create commits, push, deploy, or modify files outside this task unless explicitly requested.

`AGENTS.md` is mandatory. This repository uses a Next.js version with breaking changes. Before writing or changing Next.js-specific code, read the relevant installed documentation under `node_modules/next/dist/docs/`.

## 0.2 Claude-mem policy for this task

**Use claude-mem: YES**, because this task changes long-lived Canvas generation architecture and follows prior decisions about Theme-versus-composition behavior.

At the beginning, if claude-mem is available, retrieve only relevant recent observations concerning:

- Canvas page generation
- `generated-source`
- `design-guide.ts`
- runtime classes
- Theme-versus-composition decisions
- prompt architecture
- generation quality
- workspace usability
- UI audit decisions

Do not retrieve unrelated memories.

If claude-mem is not available:

- skip it cleanly,
- report that it was skipped because the tool was unavailable,
- continue with repository evidence,
- never guess or hallucinate MCP tool names.

At the end, if claude-mem is available, store one concise implementation observation containing:

- architecture changes,
- files changed,
- invariants preserved,
- verification completed,
- genuine remaining limitations.

## 0.3 Skills

Honor repository-local skills and Claude instructions.

For UI work, use the relevant Apple/design skill if available, but do not use a design skill to introduce unrelated visual redesigns.

Do not spend time on animation skills unless a changed interaction actually requires motion review.

## 0.4 Baseline verification

Before implementation, capture the baseline result of:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

If database-backed tests need local PostgreSQL or existing test configuration, use the repository's established setup rather than inventing a new one.

If a baseline command already fails, record the failure and continue only when it is clearly unrelated to this task. Do not silently attribute pre-existing failures to the implementation.

---

# 1. Non-negotiable invariants

The following architecture must remain intact.

Do not weaken or remove:

- provider-independent prompt composition,
- project-scoped AI context,
- account-selected AI provider/model resolution,
- durable generation jobs and retries,
- editing leases,
- immutable Page Versions,
- Change Sets and history,
- Building Block reuse,
- approved Media references,
- deterministic HTML/CSS/JavaScript validation,
- `data-canvas-id` repair and selection behavior,
- preview isolation,
- export safety,
- CSP/security restrictions,
- current support for existing generated documents.

Existing generated pages that use current `c-*` classes must continue to preview and export correctly.

This task changes how **new generation is directed**, not whether old content remains valid.

---

# 2. Current root causes to fix

The implementation should treat these as the actual root causes.

## 2.1 Semantic runtime helpers create a hidden composition template

Current file:

`src/domain/generated-source/runtime-classes.ts`

The current guide says:

> Build on them first

and advertises:

- `c-hero`
- `c-card`
- `c-surface`
- `c-navbar`
- `c-kicker`
- `c-grid`
- `c-section`
- other classes

This encourages the model to repeatedly produce the same structural grammar even though `design-guide.ts` says not to copy a template.

## 2.2 Shared runtime CSS contains strong composition defaults

Current file:

`src/generated-runtime/preview/runtime-css.ts`

The shared runtime provides convenient hero, card, section, grid, navbar, button, surface, spacing, and motion behavior.

The styles are useful for compatibility, but they must stop being the main design path for new page generation.

## 2.3 Source generation starts before a first-class design decision exists

Current flow in:

- `src/domain/page-generation/prompt.ts`
- `src/domain/page-generation/orchestration.ts`
- `src/domain/page-generation/contract.ts`

The model goes from project context and craft instructions directly to HTML/CSS/JS.

There is no persisted, structured decision describing:

- page intent,
- hierarchy,
- section jobs,
- composition,
- art direction,
- density rhythm,
- media role,
- responsive strategy,
- deliberate differences from existing pages.

## 2.4 No structural originality gate exists

The deterministic validators correctly reject unsafe or invalid generated source, but a technically perfect page can still repeat the same layout.

Canvas currently validates correctness, not structural originality.

## 2.5 AI technical constraints contradict the real generated-document contract

Current file:

`src/domain/ai/context.ts`

It currently exposes:

```ts
target: "Next.js + React + TypeScript"
```

while the actual page generation contract produces:

- HTML
- CSS
- optional vanilla browser JavaScript

The exported project can still be Next.js. The generated document itself is not React/TSX.

Remove this contradiction.

## 2.6 Theme UI wording implies a full-page design

Current file:

`src/components/theme/theme-editor.tsx`

The current description calls presets:

> Complete designs

This reinforces the wrong user mental model.

A Theme must be communicated as a **visual style**, not a page layout.

---

# 3. Target generation architecture

Implement this pipeline for **new page generation**:

```text
User request
    ↓
Project / brand / Theme / structure / Media context
    ↓
Page Design Planning
    ↓
3 lightweight composition candidates in one structured planning call
    ↓
Planner selects the strongest candidate with rationale
    ↓
Server validates the selected plan
    ↓
Structural similarity check against existing project pages
    ↓
If too similar: one bounded re-plan attempt
    ↓
Selected PageDesignPlan
    ↓
HTML / CSS / JS generation
    ↓
Existing source schema validation
    ↓
Existing deterministic document/security validation
    ↓
Verify output still represents the selected plan
    ↓
Persist Page Version + composition fingerprint
    ↓
Preview / history / export
```

## 3.1 Scope of the planning stage

The first implementation must apply design planning to:

- `page_generate`
- any generation of an unbuilt page

Do **not** route selected-element edits through the planner.

Do **not** allow the planning work to weaken the existing "preserve unrelated content" rule for modifications.

For full-page modifications, preserve current behavior unless the existing orchestration already treats the request as a rebuild. Do not introduce a brittle keyword classifier in this task.

The primary goal is to fix initial page generation quality without destabilizing reliable edit semantics.

---

# 4. Phase 1: Resolve the technical-target contradiction

## Files

Primary:

- `src/domain/ai/context.ts`
- `src/domain/ai/prompts/operations.ts`
- `src/domain/ai/prompts/prompt-architecture.test.ts`
- relevant page/block prompt tests
- `README.md`

Potentially update documentation where the same contradiction appears.

## Required behavior

Replace the ambiguous single target with an explicit distinction.

Recommended shape:

```ts
export const CANVAS_TECHNICAL_CONSTRAINTS = {
  generationFormat: "Canvas safe static document: HTML + authored CSS + optional vanilla browser JavaScript",
  exportTarget: "Next.js + React + TypeScript project shell",
  frontendOnly: true,
  ...
} as const;
```

If changing the object shape creates unnecessary compatibility churn, keeping `target` is acceptable only if its value clearly describes the generated document and a separate `exportTarget` describes Next.js.

Example:

```ts
target: "Safe HTML + CSS + optional vanilla browser JavaScript",
exportTarget: "Next.js + React + TypeScript project shell",
```

The prompt must make clear:

- the model is generating a Canvas document,
- it must not emit React, JSX, TSX, Next components, route handlers, or server code,
- Canvas later exports the safe document through the project's Next.js export architecture.

## Acceptance criteria

- No generation prompt tells the model to generate React/Next while the schema expects static HTML/CSS/JS.
- Existing export behavior is unchanged.
- Prompt architecture tests assert the distinction.
- README documents internal generation format versus export target.

---

# 5. Phase 2: Demote semantic runtime classes from the default generation path

## Files

Primary:

- `src/domain/generated-source/runtime-classes.ts`
- `src/domain/generated-source/design-guide.ts`
- `src/domain/ai/prompts/operations.ts`
- related prompt tests
- `src/generated-runtime/preview/runtime-css.ts`
- `src/generated-runtime/preview/runtime-css.test.ts`

Inspect validators that use `GENERATED_RUNTIME_CLASSES` before changing exports.

## 5.1 Preserve compatibility

Do **not** delete runtime support for existing classes.

Existing documents may already contain:

- `c-hero`
- `c-card`
- `c-surface`
- `c-navbar`
- `c-kicker`
- other semantic helpers

They must continue to render.

The validator allowlist can continue to recognize them.

The runtime CSS can continue to define them.

## 5.2 Split "supported" from "recommended"

Refactor the runtime class definition into two conceptual tiers.

### Recommended infrastructure helpers

New generation may be told about low-level helpers such as:

- `c-page`
- `c-container`
- `c-stack`
- `c-row`
- `c-cluster`
- `c-actions`
- `c-button`
- `c-button-secondary`
- `c-link`
- `c-media`
- `c-logo`

`c-section` may remain available where needed for base vertical flow, but it must not imply that every page is a stack of identical Canvas section bands.

### Compatibility / semantic helpers

Keep support for, but do not promote as the first-choice composition vocabulary:

- `c-hero`
- `c-card`
- `c-surface`
- `c-navbar`
- `c-kicker`
- other semantic composition shortcuts

A practical implementation is:

```ts
export const GENERATED_RUNTIME_INFRASTRUCTURE_CLASSES = [...]
export const GENERATED_RUNTIME_COMPATIBILITY_CLASSES = [...]
export const GENERATED_RUNTIME_CLASSES = [
  ...GENERATED_RUNTIME_INFRASTRUCTURE_CLASSES,
  ...GENERATED_RUNTIME_COMPATIBILITY_CLASSES,
] as const;
```

Exact naming can follow repository conventions.

## 5.3 Rewrite the generation-facing class guide

Remove:

> Build on them first

Replace the concept with:

> Canvas provides optional theme-aware infrastructure helpers. Use only the helpers that naturally implement the selected Page Design Plan. They do not define section type, hierarchy, composition, or page structure. Your document CSS is the normal place for page-specific composition.

Do not present `c-hero`, `c-card`, `c-navbar`, `c-kicker`, or `c-surface` as the default path for new pages.

For existing documents, preserve semantic classes already present unless the user explicitly asks to redesign that region.

## 5.4 Refactor `design-guide.ts`

Keep the strong existing Theme-versus-composition rules.

Remove or rewrite portions of `CLASS_MECHANICS` that effectively teach the model a menu of Canvas page archetypes.

The guide should teach:

- Theme variables,
- safe infrastructure helpers,
- responsive composition,
- content hierarchy,
- Media usage,
- design quality,
- continuity,

without giving the model a ready-made page vocabulary that competes with the new Page Design Plan.

## Acceptance criteria

- Existing generated pages using old semantic classes still render.
- New page prompts no longer say to build on semantic Canvas classes first.
- New page prompts make authored CSS a normal tool for composition, not a fallback.
- Prompt tests assert that semantic classes are not advertised as a default page skeleton.
- Runtime CSS compatibility tests continue passing.

---

# 6. Phase 3: Add `PageDesignPlan`

Create a first-class, structured design-planning contract.

## New files

Recommended:

- `src/domain/page-generation/design-plan.ts`
- `src/domain/page-generation/design-plan-prompt.ts`
- `src/domain/page-generation/design-plan.test.ts`

If naming conventions suggest a different split, follow existing repository structure.

## 6.1 Design principle

The schema must structure **design reasoning** without becoming another template library.

Do not create a finite enum such as:

```text
hero = centered | split | image-left | image-right
```

That would simply move the template problem into a new schema.

Use open descriptive fields for composition, supported by a small number of generic structural traits used only for comparison and validation.

## 6.2 Required plan model

Implement an equivalent to:

```ts
type PageDesignPlan = {
  id: string;
  pageIntent: {
    primaryGoal: string;
    audience: string;
    desiredAction: string | null;
  };
  artDirection: {
    concept: string;
    mood: string;
    visualMotifs: string[];
    densityRhythm: string;
    mediaStrategy: string;
  };
  sections: Array<{
    id: string;
    role: string;
    contentGoal: string;
    composition: string;
    focalPoint: string;
    responsiveBehavior: string;
    mediaRole: string | null;

    structuralTraits: {
      widthTreatment: "contained" | "full_bleed" | "mixed";
      alignment: "left" | "center" | "right" | "asymmetric" | "mixed";
      density: "compact" | "balanced" | "airy";
      mediaEmphasis: "none" | "supporting" | "dominant" | "background";
      repetition: "none" | "list" | "grid" | "sequence" | "table" | "custom";
      approximateColumns: number | null;
    };
  }>;
  responsiveStrategy: string;
  continuity: {
    sharedSiteLanguage: string[];
    deliberatePageDifferences: string[];
  };
  originalityRationale: string;
};
```

The exact field names can be adjusted for code style, but preserve the semantics.

### Important

`structuralTraits` exist to support deterministic fingerprinting.

They are **not** instructions to limit the design to predefined layout templates.

The free-text `composition` field remains the primary design description.

## 6.3 Candidate bundle

One planning call should return exactly three lightweight candidate plans for a new page.

Recommended response shape:

```ts
type PageDesignPlanBundle = {
  schemaVersion: 1;
  candidates: [
    PageDesignPlan,
    PageDesignPlan,
    PageDesignPlan
  ];
  selectedCandidateId: string;
  selectionRationale: string;
};
```

Do not make three full website-generation calls.

The point is to create diversity cheaply at the planning level.

## 6.4 Planning prompt

The planning prompt must receive:

- project identity,
- company/brand context,
- selected Theme constraints,
- page route/name,
- site structure,
- available Building Blocks,
- approved Media metadata,
- persistent project instructions,
- user request,
- relevant recent conversation.

If image attachments were explicitly selected for the request and the provider supports multimodal input, the planning call may receive them so it can decide whether the page should genuinely be image-led.

The prompt must explicitly state:

- Theme defines visual treatment only.
- Reusable global navbar/footer define intentional shared composition.
- Page structure must be invented for this page's job.
- The three candidates must be meaningfully different in hierarchy and composition, not recolours of the same layout.
- A candidate whose sequence is the familiar "hero, feature cards, testimonial, CTA" without a content-specific reason is weak.
- The selected candidate must be the one that best fits the page/business, not the safest or most conventional.

## 6.5 Planning model settings

Use the same user-selected provider/model as page generation.

Do not add another credential or provider selection path.

Planning should be cheaper than source generation.

Use a bounded structured response with a substantially smaller token budget than the final document generation.

Prefer a higher creativity temperature for planning than source generation.

Do not change selected-element edit temperature behavior.

## Acceptance criteria

- New page generation produces a structured design plan before HTML/CSS/JS.
- Exactly three candidate plans are produced in one planning request.
- The selected plan is validated server-side.
- Candidate plans are structurally distinguishable.
- The final source prompt receives only the selected plan, not all rejected candidates.
- Planning usage is included in existing AI usage/analytics accounting.

---

# 7. Phase 4: Add deterministic composition fingerprints and similarity control

## New files

Recommended:

- `src/domain/page-generation/composition-fingerprint.ts`
- `src/domain/page-generation/composition-fingerprint.test.ts`

Potential integration:

- `src/domain/page-generation/orchestration.ts`
- generated page manifest typing/validation
- project context queries

Avoid a database migration unless the current JSON manifest cannot safely carry optional metadata.

## 7.1 Fingerprint source

Compute fingerprints **server-side from the validated PageDesignPlan**.

Never trust a fingerprint string generated by the model.

The fingerprint should represent structural decisions, not colours/fonts.

It should include:

- section count,
- ordered section roles,
- ordered structural traits,
- contained versus full-bleed rhythm,
- alignment rhythm,
- density rhythm,
- media emphasis rhythm,
- repetition pattern,
- approximate column pattern.

Do not include:

- Theme colours,
- font names,
- radius,
- shadows,
- global navbar/footer Building Blocks.

Those are visual continuity, not page composition.

## 7.2 Fingerprint persistence

Persist the selected plan's compact composition metadata with the active generated page.

Prefer adding optional fields to the Page Version manifest JSON rather than a new database table if that can be done without weakening current manifest validation.

Recommended persisted metadata:

```ts
designPlan: {
  schemaVersion: 1;
  pageIntent: string;
  sectionRoles: string[];
  compositionFingerprint: {
    version: 1;
    ...
  };
}
```

Do not persist all prompt content or hidden reasoning.

Do not persist rejected candidate plans unless there is a concrete debugging need.

## 7.3 Project comparison

When generating a new page:

1. Load composition fingerprints for the current versions of other built pages in the same project.
2. Ignore the target page.
3. Ignore global Building Blocks and reusable-section structure.
4. Compare the selected plan against those pages.
5. If no prior fingerprint exists for a legacy page, skip that page rather than guessing.

## 7.4 Similarity score

Implement a deterministic weighted score.

A reasonable initial weighting:

- 30% ordered section-role similarity
- 20% width-treatment sequence
- 15% alignment sequence
- 15% density sequence
- 10% media-emphasis sequence
- 10% repetition / column sequence

Use sequence-aware comparison rather than only set overlap.

Centralize the threshold in one named constant with a test.

Suggested starting threshold:

```ts
MAX_ACCEPTABLE_PAGE_COMPOSITION_SIMILARITY = 0.86
```

Do not scatter magic numbers.

## 7.5 Bounded re-plan

If the selected candidate is too similar to an existing non-global page:

1. Do not generate source yet.
2. Perform one additional planning attempt.
3. Include a compact description of the conflicting fingerprint and tell the planner to create a structurally different plan while keeping:
   - the same Theme,
   - the same brand,
   - the same page purpose,
   - the same reusable global furniture.
4. Validate again.
5. If the second selected plan still exceeds the threshold, fail cleanly with a specific quality error rather than silently generating the duplicate layout.

Add an appropriate safe error code, for example:

```text
AI_DESIGN_PLAN_TOO_SIMILAR
```

Follow existing `AIError` conventions.

## 7.6 Internal candidate diversity

Before comparing against the project, verify that the three candidates are meaningfully distinct from one another.

If the planning model returns three near-duplicates, reject the plan bundle and use the existing structured-response repair mechanism or one bounded planning retry.

## Acceptance criteria

- Two pages with the same Theme may share visual language without being forced into the same section sequence.
- Global navbar/footer reuse does not make two pages appear structurally identical to the detector.
- Same-project repeated skeletons above the threshold are prevented before source generation.
- Legacy pages without design-plan metadata remain usable.
- Fingerprints never include Theme values.

---

# 8. Phase 5: Insert planning into `PageGenerationOrchestrationService`

## Primary file

`src/domain/page-generation/orchestration.ts`

This phase must be implemented carefully because the orchestration service controls:

- leases,
- cancellation,
- job lifecycle,
- provider resolution,
- Media,
- usage recording,
- validation,
- persistence,
- history.

Do not duplicate these systems.

## 8.1 Required flow change

Current high-level flow:

```text
context
→ provider
→ assemble source request
→ generateWithRepair
→ document validation
→ commit
```

New flow for an unbuilt page:

```text
context
→ provider
→ planning request
→ plan validation
→ similarity check
→ optional one re-plan
→ selected plan
→ source-generation request
→ current source validation
→ composition conformance check
→ commit
```

## 8.2 Job progress

Add user-visible progress stages that distinguish planning from code generation.

Use concise existing style, for example:

- `Planning page`
- `Generating page`
- `Validating page`
- `Applying page update`

Do not expose chain-of-thought or candidate reasoning.

## 8.3 Provider and usage accounting

Resolve the provider once.

Both the planning call and final source call use that resolved account model.

Extend AI usage/request-kind accounting as needed so analytics can distinguish:

- design planning,
- source generation,
- repair.

Do not break historical usage rows.

If changing the `ProviderCallRecord["requestKind"]` union is necessary, update all exhaustive code/tests.

## 8.4 Cancellation

Cancellation must work while planning.

Use the same job abort signal.

Do not leave a planning request running after the job is cancelled.

## 8.5 Retry behavior

Keep the distinction between:

- durable job retries for provider/transient failures,
- bounded structured-response repair,
- bounded one-time re-plan for composition similarity.

Do not create an unbounded regeneration loop.

## 8.6 Context metadata

Record only useful operational metadata.

Add safe fields such as:

- selected plan id,
- planning prompt version,
- composition fingerprint version,
- re-plan count,
- similarity score that triggered re-plan.

Do not persist credentials or hidden model reasoning.

## Acceptance criteria

- Job cancellation works during planning and source generation.
- Durable retries still work.
- The same selected provider/model is used consistently.
- Planning cost appears in analytics.
- No extra source version is committed for rejected plans.
- Only the final validated page is activated.

---

# 9. Phase 6: Make source generation implement the selected design plan

## Files

Primary:

- `src/domain/page-generation/prompt.ts`
- `src/domain/ai/prompts/composer.ts`
- `src/domain/ai/prompts/operations.ts`
- `src/domain/generated-source/design-guide.ts`
- prompt tests

## 9.1 Prompt section

Add a canonical `design_plan` prompt section to `PROMPT_SECTION_ORDER`.

Place it after general craft direction and before target-state/output execution details, with priority above untrusted project text.

A suitable conceptual order:

```text
platform
operation
craft
design_plan
output_contract
project_instructions
design_system
reusable_sections
site_structure
target_state
media
conversation
closing
```

Keep existing prompt architecture principles.

## 9.2 Page generation request input

Extend `assemblePageGenerationRequest` to receive the selected `PageDesignPlan` for unbuilt page generation.

The source-generation prompt must say:

- implement this plan faithfully,
- do not reinterpret the Theme as layout,
- do not replace the selected composition with a familiar Canvas skeleton,
- use runtime infrastructure only where useful,
- use authored document CSS for page-specific composition,
- reuse existing Building Blocks where explicitly appropriate.

## 9.3 Do not turn the plan into exact markup

The plan is a design contract, not source code.

The model remains responsible for producing the actual semantic HTML/CSS/JS.

## 9.4 Closing verification

Update the closing prompt so the model checks:

- each section performs the planned job,
- order matches the plan,
- visual hierarchy matches the plan,
- Media placement matches the planned role,
- responsive behavior respects the plan,
- Theme tokens control treatment,
- no generic Canvas skeleton replaced the plan.

Keep all current security/source-contract checks.

## Acceptance criteria

- Final source prompt contains a validated selected PageDesignPlan.
- Rejected candidate plans do not pollute the final prompt.
- Theme remains available as design constraints.
- Existing Building Block reuse remains authoritative.
- The model is no longer encouraged to default to semantic Canvas classes.

---

# 10. Phase 7: Add output-versus-plan conformance checks

The similarity gate prevents a bad plan. Canvas should also make sure the generated source did not ignore the good plan.

## New file

Recommended:

- `src/domain/page-generation/design-plan-conformance.ts`
- corresponding tests

## Required checks

Do not attempt visual computer vision in this task.

Use deterministic source/manifest checks where reliable.

Examples:

- expected number of major page regions is reasonably represented,
- planned dominant Media exists when the plan says Media is dominant,
- planned full-bleed regions are not all collapsed into identical contained cards,
- repeated structures roughly match the plan's repetition traits,
- plan section order can be associated with top-level editable regions,
- final fingerprint is not dramatically different from selected plan fingerprint.

Be conservative.

Do not reject creative valid output based on brittle CSS parsing.

If exact conformance cannot be deterministically established, prefer:

- strong plan-aware prompt tests,
- structural manifest checks,
- manual generation regression tests,

over inventing fragile rules.

## Acceptance criteria

- A model cannot completely ignore the selected plan and still trivially pass.
- Conformance checks do not reject legitimate custom CSS merely because it uses different class names.
- Security validator remains the final authority on allowed source.

---

# 11. Phase 8: Fix the Theme usability mental model

## Files

Primary:

- `src/components/theme/theme-editor.tsx`
- `src/components/theme/theme-presets.tsx`
- related UI tests
- possibly `docs/ui-usability-audit.md`
- README if terminology is documented

## Required UI change

Replace "Ready-made themes" / "Complete designs" language with clear visual-language wording.

Recommended:

### Section title

`Visual styles`

### Description

`Colours, typography, corners, spacing and surfaces. A style changes how your site looks, not its page layout or section order.`

The exact copy can be polished, but it must explicitly communicate:

- style controls visual treatment,
- page structure is generated from the content and purpose,
- selecting a style does not choose a webpage template.

Keep:

- staged preview,
- Apply behavior,
- editable colour/type/scale controls,
- light/dark preview.

Do not reintroduce miniature page-layout previews.

## Acceptance criteria

A user looking at the Design screen should not reasonably conclude that selecting a style selects a whole webpage layout.

---

# 12. Phase 9: Add the missing read-only Code View

The approved SRS requires an advanced read-only Code View.

Implement it rather than weakening the requirement.

## Recommended new component

`src/components/workspace/code-view.tsx`

Potential integration files:

- `src/domain/commands/registry.ts`
- `src/components/workspace/panel-names.ts`
- `src/components/workspace/feature-panel.tsx`
- `src/components/workspace/workspace-shell.tsx`
- route/panel mapping files as required by current architecture
- tests

Inspect the current panel system before choosing exact placement.

## Behavior

Code View is:

- advanced/progressive disclosure,
- read-only,
- tied to the currently active generated page,
- not a source editor.

Provide tabs or segmented controls for:

- HTML
- CSS
- JavaScript

Optional metadata may be shown separately.

Provide:

- syntax-friendly monospaced presentation,
- copy button,
- empty-state messaging when no active generated version exists.

Do not provide:

- editing,
- Save,
- direct source mutation,
- bypass around AI/history/change-set workflows.

If the currently active source is already available to the workspace, reuse it.

Do not add a redundant API only to support Code View.

If source is not available, add the smallest read-only endpoint/service that uses existing project access controls.

## Command

Add an advanced command such as:

`View code`

Do not make Code View a dominant primary navigation item for non-technical users.

## Acceptance criteria

- User can inspect active HTML/CSS/JS.
- User cannot edit it.
- Access control is enforced.
- It does not bypass versions/history.
- Command palette tests include the new action.

---

# 13. Phase 10: Clarify Agent / Tasks / Change Review / History responsibilities

Do not redesign these surfaces wholesale.

Ensure their copy and behavior preserve this mental model:

- **Agent**: where the user asks for work.
- **Tasks**: work currently queued or in progress.
- **Change Review**: one completed AI result before/around applying/reviewing it.
- **History**: committed website state and past versions.

Inspect current labels and empty states.

Where wording is ambiguous, update the smallest amount of UI copy necessary.

Do not merge the systems.

Add/adjust tests if visible labels change.

---

# 14. Phase 11: Refactor `workspace-shell.tsx` by behavior, not appearance

Current file:

`src/components/workspace/workspace-shell.tsx`

It currently coordinates too many unrelated concerns.

Perform this only after the generation behavior is stable.

## Goal

Reduce regression risk without redesigning the workspace.

## Recommended extraction boundaries

Extract stateful behavior into focused hooks/modules, following current patterns:

- preview navigation
- panel visibility/layout
- panel resizing
- selected preview element
- Agent conversation/draft state
- active generation/task state
- command palette state
- workspace recents/history integration where appropriate

Possible names:

```text
use-preview-navigation.ts
use-workspace-panels.ts
use-workspace-resizing.ts
use-preview-selection.ts
use-agent-workflow.ts
```

Use repository naming conventions rather than these names if existing patterns suggest something better.

## Rules

- No behavior changes as part of extraction.
- No new global state library.
- No dependency added unless clearly required.
- Preserve keyboard behavior.
- Preserve responsive layout.
- Preserve panel show/hide/resizing.
- Preserve Agent interactions.
- Preserve Preview navigation.
- Keep or improve testability.

## Acceptance criteria

- `workspace-shell.tsx` becomes primarily composition/wiring.
- Existing workspace tests pass without weakening assertions.
- No visual differences are introduced by the refactor.

---

# 15. Phase 12: Improve CSS ownership without a risky rewrite

Current large stylesheets include:

- `src/app/workspace.css`
- `src/app/panels.css`

Do not rewrite styling from scratch.

## Goal

Reduce accidental cross-surface coupling.

## Approach

Use a conservative extraction.

Group selectors by actual product surface, for example:

```text
src/app/styles/workspace/shell.css
src/app/styles/workspace/preview.css
src/app/styles/workspace/agent.css
src/app/styles/workspace/panels.css
src/app/styles/workspace/responsive.css
```

or another structure consistent with the app.

If cascade layers are appropriate and supported by the current Next/CSS setup, use them deliberately.

Before changing imports, read the relevant installed Next documentation as required by `AGENTS.md`.

## Rules

- Preserve selector specificity unless intentionally fixed and tested.
- Do not combine this with a visual redesign.
- Keep diffs reviewable.
- Keep global Theme tokens in their current appropriate global layer.
- Do not move generated-runtime CSS into application UI CSS.

## Acceptance criteria

- Same visual output before/after extraction.
- Existing responsive/accessibility tests still pass.
- Workspace and panel styling has clearer ownership.

---

# 16. Phase 13: Update documentation and repository hygiene

## 16.1 README

Update `README.md` so it accurately describes:

- supported AI provider architecture,
- account-level provider/model selection,
- internal safe generated-document format,
- Next.js export target,
- Page Design Planning,
- Theme as visual language,
- Building Blocks as intentional reusable composition,
- generation quality validation.

Remove outdated wording that suggests Canvas is fundamentally tied to one provider if that is no longer true.

## 16.2 SRS / implementation documentation

Do not rewrite the approved SRS unnecessarily.

If implementation documentation describes the old direct-generation flow, update it.

Code View should now satisfy the existing requirement rather than removing it.

## 16.3 `.DS_Store`

A root `.DS_Store` is currently tracked even though `.gitignore` excludes it.

Remove it from the working tree/index as appropriate.

Do not modify `.gitignore` unless another missing ignore rule is found.

---

# 17. Phase 14: Add GitHub Actions CI

Create:

`.github/workflows/ci.yml`

## Required checks

At minimum:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Use Node 22 to match `package.json`.

## Database-backed tests

The repository has integration tests that require PostgreSQL.

Configure a PostgreSQL service container using the version compatible with current local development/tests.

Inspect:

- `vitest.global-setup.ts`
- `vitest.integration.config.ts`
- `.env.example`
- database test helpers

and use the repository's expected environment variable names.

Use test-only deterministic values for required cryptographic/config secrets.

Do not put real credentials in CI.

Do not run paid provider smoke tests in ordinary CI.

## Caching

Standard npm caching is acceptable.

Do not add excessive CI complexity.

## Acceptance criteria

A clean branch can validate lint, typecheck, tests, and build automatically on pull request and push.

---

# 18. Generation-quality regression suite

This is a critical part of the task.

Prompt/schema unit tests alone are not enough.

## 18.1 Automated structural tests

Add tests covering:

### Theme isolation

Given identical Theme tokens but different page/business contexts:

- generated design plans are not expected to have identical fingerprints,
- Theme values do not appear in the composition fingerprint.

### Same-project page diversity

Generate/construct plans representing:

- Home
- Services
- About
- Contact

and verify that non-global composition fingerprints above the similarity threshold are rejected/replanned.

### Building Block exclusion

Two pages using the same global navbar/footer must not be considered duplicates solely because those Building Blocks are shared.

### Candidate diversity

Three returned plan candidates that are structurally identical must fail plan validation.

### Legacy compatibility

Pages created before design-plan metadata exists:

- still preview,
- still export,
- still edit,
- are skipped safely by fingerprint comparison if no fingerprint can be recovered.

### Semantic runtime compatibility

Existing source containing legacy `c-hero`, `c-card`, `c-navbar`, etc. remains valid.

### New-generation prompt

Assert that new-page prompts:

- include selected `PageDesignPlan`,
- distinguish Theme from composition,
- do not say "Build on them first",
- do not advertise semantic runtime helpers as the default page skeleton,
- preserve Building Block reuse rules,
- preserve security/source rules.

---

# 19. Manual generation review

After automated tests pass, run real representative generations using an available configured provider.

If provider credentials are unavailable, state that manual AI generation review could not be performed. Do not invent results.

Use the **same Theme** for at least these four unrelated businesses:

1. accounting / professional services firm
2. architecture or design studio
3. restaurant
4. developer/SaaS tool

Use comparable request detail.

## 19.1 What to inspect

For each generation record:

- page intent,
- selected plan,
- section sequence,
- composition fingerprint,
- whether a re-plan occurred,
- major layout pattern,
- Media role,
- density rhythm,
- final rendered result,
- Theme fidelity.

## 19.2 Passing result

The four sites should clearly share:

- colours,
- typography,
- corner language,
- spacing rhythm,
- button/link treatment,
- surface language,

while clearly differing in:

- opening composition,
- section order,
- content hierarchy,
- density,
- use of grids/lists/prose/media,
- CTA placement,
- section geometry.

They must not look like four recolours of the same Canvas page.

## 19.3 Same-project review

Create or inspect multiple pages in one project.

Navbar/footer may stay consistent.

Home, Services, About, and Contact should not all use the same internal skeleton.

## 19.4 Theme-change review

Apply a different Theme to one generated project.

Verify:

- the visual language changes,
- page composition remains substantially unchanged,
- no source regeneration is required solely to apply Theme values,
- the Theme is still functioning as design tokens rather than a layout template.

---

# 20. Quality gates and failure behavior

The new system must fail safely.

## Planning failure

If the provider cannot return a valid planning bundle after the bounded repair/retry behavior:

- fail the job with a useful error,
- do not generate source without a plan as a silent fallback.

A silent fallback would reintroduce the exact problem this task is fixing.

## Similarity failure

If the selected plan is too similar:

- re-plan once,
- if still too similar, fail with a specific quality error,
- do not silently accept the duplicate layout.

## Source failure

Keep current validation/repair behavior.

Do not weaken source validation to make more creative layouts pass.

If legitimate creative CSS is blocked by an unnecessarily narrow validator, fix that validator deliberately with tests while preserving its security boundary.

---

# 21. Performance and cost constraints

The improvement must not make normal page generation disproportionately expensive.

## Required strategy

- one planning call returns all three candidates,
- only the selected candidate proceeds to source generation,
- at most one similarity-driven re-plan attempt,
- no three-full-page tournament,
- no visual screenshot judge provider loop,
- no background endless critique loop.

Record planning latency and usage separately enough to diagnose cost.

The final report should mention any measurable latency increase if manual measurements are available.

---

# 22. Files expected to change

This is a guide, not a forced list. Claude must inspect before editing.

Likely files:

## Generation architecture

- `src/domain/ai/context.ts`
- `src/domain/ai/generation-runner.ts` if request-kind accounting must expand
- `src/domain/ai/prompts/composer.ts`
- `src/domain/ai/prompts/operations.ts`
- `src/domain/ai/prompts/versions.ts`
- `src/domain/ai/prompts/prompt-architecture.test.ts`
- `src/domain/page-generation/prompt.ts`
- `src/domain/page-generation/contract.ts`
- `src/domain/page-generation/orchestration.ts`
- `src/domain/page-generation/validator.ts`
- new design-plan files
- new composition-fingerprint files
- new conformance files

## Generated runtime

- `src/domain/generated-source/runtime-classes.ts`
- `src/domain/generated-source/design-guide.ts`
- related generated-source tests
- `src/generated-runtime/preview/runtime-css.ts`
- `src/generated-runtime/preview/runtime-css.test.ts`

## Persistence / manifest

- current generated page manifest types/services as required
- avoid migration unless necessary

## Theme UX

- `src/components/theme/theme-editor.tsx`
- `src/components/theme/theme-presets.tsx`
- related tests/CSS only if required

## Code View

- `src/domain/commands/registry.ts`
- workspace panel routing/names
- new `code-view.tsx`
- workspace tests

## Workspace refactor

- `src/components/workspace/workspace-shell.tsx`
- new focused hooks/modules
- existing workspace tests

## CSS organization

- `src/app/workspace.css`
- `src/app/panels.css`
- new extracted CSS files if used

## Repository quality

- `README.md`
- `.github/workflows/ci.yml`
- root `.DS_Store` removal

---

# 23. Required tests

At the end, run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Also run targeted tests during implementation so failures are localized.

At minimum, add/update tests for:

- technical constraint target
- prompt section order
- PageDesignPlan schema
- candidate diversity
- fingerprint determinism
- fingerprint Theme-independence
- similarity threshold
- Building Block exclusion
- bounded re-plan
- planning cancellation
- planning usage recording
- source prompt receives selected plan
- runtime class compatibility
- Theme wording
- Code View read-only behavior
- command registry
- workspace refactor behavior
- CI configuration where practical

Do not weaken existing security tests or remove assertions merely to make new code pass.

---

# 24. Implementation order

Follow this order to reduce risk:

1. Baseline tests and repository evidence.
2. Resolve generated-document versus export-target contradiction.
3. Refactor runtime class guidance while preserving compatibility.
4. Add PageDesignPlan schema and tests.
5. Add planning prompt and candidate validation.
6. Add composition fingerprint and similarity tests.
7. Persist optional fingerprint/plan metadata.
8. Integrate planning into page generation orchestration.
9. Feed selected plan into source generation.
10. Add bounded re-plan behavior.
11. Add source-versus-plan conformance checks.
12. Run P0 generation tests.
13. Fix Theme wording.
14. Implement read-only Code View.
15. Clarify Agent / Tasks / Change Review / History wording if needed.
16. Refactor workspace shell without visual changes.
17. Split CSS ownership conservatively.
18. Update README/docs and remove tracked `.DS_Store`.
19. Add CI.
20. Run full verification.
21. Perform manual generation review.
22. Save concise claude-mem observation if available.
23. Produce final report.

Do not start the workspace/CSS refactor before the generation pipeline passes its targeted tests.

---

# 25. Definition of done

This task is **not complete** merely because:

- prompts contain stronger "be creative" wording,
- Theme previews look different,
- source validates,
- tests pass while real generations still use the same skeleton.

It is complete when all of the following are true:

## Generation behavior

- New pages receive a first-class PageDesignPlan before source generation.
- Three cheap candidate plans are generated in one planning call.
- A selected plan is validated.
- Same-project structural similarity is checked before source generation.
- One bounded re-plan happens when necessary.
- The final source prompt implements the selected plan.
- Theme values never determine page composition.
- Existing Building Blocks remain the mechanism for intentional shared composition.
- Existing semantic `c-*` classes remain compatible but are no longer the default design path.

## Product usability

- Design/Theme UI clearly says visual styles do not control layout.
- Read-only advanced Code View exists.
- Agent / Tasks / Change Review / History retain distinct roles.
- Workspace behavior remains stable after refactor.

## Engineering

- no generated-document/Next.js prompt contradiction remains,
- full tests pass,
- build passes,
- CI exists,
- README reflects current providers/architecture,
- `.DS_Store` is no longer tracked,
- no security boundary was weakened,
- no unrelated files were modified,
- no commit/push/deploy occurred unless separately requested.

## Manual output quality

Using one identical Theme across unrelated representative businesses must produce clearly different page compositions while preserving the same visual language.

That is the decisive acceptance test.

---

# 26. Final Claude Code report format

Return a concise implementation report using exactly these sections.

## Verdict

State whether the implementation is ready based on the verification gates.

## Claude-mem

State:

- used and what relevant context was retrieved, or
- skipped because unavailable.

Do not report guessed tool names.

## Root cause addressed

Explain how the implementation removed the hidden composition-template pressure rather than merely adding prompt wording.

## Generation architecture

Summarize:

- PageDesignPlan,
- candidate planning,
- selection,
- fingerprint,
- similarity/re-plan,
- final source generation.

## UI change

Explain how Theme / Visual Style is now communicated as style-only.

Mention Code View if implemented in this pass.

## Files changed

List each changed/new file with one short purpose.

## Tests

List:

- tests added/updated,
- targeted results,
- `npm run lint`,
- `npm run typecheck`,
- `npm test`,
- `npm run build`.

Do not say a command passed unless it was actually run successfully.

## Manual generation review

Summarize real results across the representative website types.

If provider credentials prevented manual review, state that explicitly.

## Performance / cost

Report planning-call overhead and any measured latency/token impact if available.

## Remaining limitations

Only genuine remaining issues.

Do not include work that is actually complete.

---

# 27. Explicit prohibitions

Do not solve this by:

- adding a larger generic "be creative" prompt only,
- adding more visual templates,
- randomizing layouts without page-purpose reasoning,
- making Theme presets contain page markup,
- generating three full websites and picking one,
- adding screenshot-based provider judging loops,
- weakening HTML/CSS/JS security validation,
- removing legacy runtime classes and breaking old pages,
- replacing the safe document format with unrestricted React/TSX,
- letting new pages silently fall back to the old direct-generation path,
- using hard-coded colours/fonts/radius values to create variation,
- making different pages inconsistent with the same brand,
- changing existing selected-element edit semantics,
- creating commits or pushing without explicit permission.

---

# Final product principle

Canvas should make pages feel like they were designed for their specific purpose.

Two unrelated businesses using the exact same Theme should feel like they belong to the same **visual language**, not the same **website template**.

Two pages in the same project should share brand furniture and visual rules, but each page should have a composition that is appropriate to its own job.

That principle must be enforced by architecture, validation, tests, and UI language, not by prompt wording alone.
