# Canvas UI Fix Plan
**Source:** `problems 1.docx` (Ahmed, screenshots + notes) cross-referenced against the `AhmedGTaha/canvas` repo (`main`) and `docs/Canvas_Implementation_Grade_SRS.md`.
**Audience:** Claude Code, working directly in the repo.
**Ground rule from the SRS to enforce throughout:** *"If an action can be done in the left sidebar then no need for the pop-up, just keep pop-ups for large wizards like Building Blocks and Theme/Identity."* Every workstream below either implements or is constrained by that rule.

---

## 0. How to use this document

Each workstream is independent enough to ship as its own PR, but they touch the same panel system, so do them in the order listed — later workstreams assume earlier ones landed. Every workstream ends with concrete acceptance criteria; treat those as the definition of done, not the prose above them. Per SRS rule 21, every workstream needs test coverage added alongside the change, not deferred.

Relevant existing test files to extend rather than duplicate: `src/components/workspace/workspace.test.tsx`, `src/components/workspace/workbench-ui.test.tsx`, `src/components/history/history-api.test.tsx`, `src/components/accessibility.test.tsx`.

---

## 1. Remove the standalone panel page — fix the post-upload redirect at the root

**Problem:** Uploading images in the Media panel (and potentially other panels) drops the user out of the in-app overlay and onto a separate full-page `/projects/[projectId]/panel/media` screen. Decision from Ahmed: **remove the standalone page entirely** — every project tool (Media, Blocks, Brand, Export, Collaborators, Settings, Pages, Shortcuts) should only ever be reachable as an overlay on top of the workspace, never as its own page, regardless of how the URL is reached (in-app click, hard reload, bookmark, shared link).

**Current architecture (why the bug exists):**
- `src/app/(workspace)/projects/[projectId]/@panel/(.)panel/[name]/page.tsx` — Next.js *intercepted* route. Renders `FeaturePanel` (a `<dialog>` overlay) when you arrive via client-side (soft) navigation from elsewhere in the app.
- `src/app/(workspace)/projects/[projectId]/panel/[name]/page.tsx` — the *real* route Next.js falls back to on any hard navigation (reload, direct URL, or apparently some soft-nav paths too, since that's what's happening after upload). Renders `StandalonePanel`, a totally separate full-page layout.
- Both call the same `resolvePanel()` in `src/components/workspace/project-panel.tsx`, so data-fetching isn't duplicated — only presentation is.
- Interception only works for genuine client-side transitions between two different routes. Anything that causes Next to treat the navigation as fresh (a hard reload, or possibly `router.refresh()` in `MediaManager.upload()` in `src/components/media/media-manager.tsx` interacting badly with the intercepted slot) lands the user on the "real" standalone route. This is a known class of Next.js App Router foot-gun, not a one-off bug in the upload code.

**Target architecture:** Stop using a distinct route for "panel open" state. Represent it as a query parameter on the main project URL instead (e.g. `?tool=media&node=<id>`), read by the single project page that always renders the full `WorkspaceShell`. There is then no second route left for any navigation to fall back to — the bug class is eliminated structurally, not patched.

**Concrete steps:**
1. Delete `src/app/(workspace)/projects/[projectId]/panel/[name]/page.tsx`, `src/app/(workspace)/projects/[projectId]/@panel/**`, and `StandalonePanel` from `project-panel.tsx`. Remove the `@panel` parallel-route slot from the project layout.
2. In the main project page/shell (wherever `WorkspaceShell` currently lives — check `src/app/(workspace)/projects/[projectId]/page.tsx` and `workspace-shell.tsx`), read `tool`/`node` from `searchParams`. When `tool` is a valid `PanelName`, call `resolvePanel()` server-side (or via a small route handler if the shell is a client component and needs to fetch on demand) and render `FeaturePanel` with the result, on top of the normal workspace content — same component, same code path, whether this is the first server render (hard reload / bookmark) or a client-side param update.
3. Update every place that currently opens a panel by navigating to `/projects/[id]/panel/[name]` — grep `workspace-shell.tsx`, `context-sidebar.tsx`, `activity-bar.tsx`, `project-panel.tsx`'s internal `Link`s (e.g. the `Agent guidance` / `Collaborators` / `Export website` links inside the `overview` panel body) — to instead set the `tool` (and `node` where relevant) query param on the *current* path, via `router.push`/`router.replace` with `{ scroll: false }`.
4. Update `FeaturePanel.close()` in `feature-panel.tsx` to clear the `tool`/`node` query params (via `router.back()` if history has the prior state, else `router.replace` to the bare project URL) instead of relying on route-level back navigation.
5. Add a redirect (middleware or a thin route handler) from the old `/projects/[projectId]/panel/[name]` path to `/projects/[projectId]?tool=[name]` so any previously-bookmarked/shared links keep working.
6. Regression test: a component/e2e test that opens Media, uploads a file (mock the `/api/projects/[projectId]/media` POST), and asserts the workspace/website preview is still mounted underneath and no navigation to a bare panel-only screen occurred. Extend `workspace.test.tsx` or `workbench-ui.test.tsx`.

**Acceptance criteria:**
- No route in the app renders a project tool without the workspace/website preview visible behind it.
- Uploading one or more images in Media never changes what's visible outside the dialog.
- A hard reload while `?tool=media` is in the URL reopens Media as an overlay, not a bare page.
- Old `/panel/[name]` links redirect correctly.

---

## 2. Popup scrolling audit (Brand & Design, Reusable Sections, and every wide panel)

**Problem:** Screenshots show Brand & Design and Reusable Sections filling the screen with no way to scroll to content below the fold.

**What I found:** `.ws-panel-bd` in `src/app/workspace.css` (line 723) already sets `flex: 1; min-height: 0; overflow: auto`, and `.ws-panel` correctly overrides the `<dialog>` UA stylesheet's `fit-content` sizing (there's even a code comment explaining exactly this gotcha). On paper this should scroll. Two explanations are possible and Claude Code should check both rather than assume the CSS fix already shipped:
1. The screenshots predate this CSS and it's already fixed on `main` — verify by reproducing at typical laptop viewport (1366×768, 1440×900) before writing any fix.
2. A narrower, still-live bug: a descendant element inside Brand (`ThemeEditor`'s two-column grid + sticky "Live Preview" pane, see `.ws-panel-bd .theme-preview-column` override) or Blocks (`BlockLibrary`'s preview iframe area) sets its own `overflow: hidden`/fixed height that clips content before it reaches the scrollable ancestor. Also check the small-viewport override in `src/app/workspace-redesign.css` (`@media (max-width:767px)` block) — it redefines `.ws-panel-wide,.ws-panel-drawer` insets and could plausibly interact badly with a nested scroll container on narrow/short viewports.

**Concrete steps:**
1. Reproduce with Playwright (or manually via `soffice`-free browser tooling already in the env) at 1366×768, 1440×900, and mobile widths, for Media, Blocks, and Brand panels with realistic content lengths (fill Brand's theme editor, add several Building Blocks).
2. Fix whatever is found. Do not touch `.ws-panel-bd`'s core rule unless it's actually implicated — the description above suggests the bug, if any, is in a child.
3. Add a regression test asserting scrollability: either a Playwright test that scrolls `.ws-panel-bd` and checks content below the fold becomes visible, or at minimum a computed-style assertion that `.ws-panel-bd` resolves `overflow-y: auto`/`scroll` in all three wide-panel contexts and at the mobile breakpoint.

**Acceptance criteria:** every wide panel is fully reachable by scrolling at common desktop and mobile viewport sizes, verified by an automated test, not just visual inspection.

---

## 3 & 5. History and Checkpoints move into the sidebar, with a live change-count

Ahmed's decisions: fold History into the left sidebar instead of a floating dialog, **and** add a live "N changes since last checkpoint" badge/notification (VS Code source-control style). These are one workstream because they land in the same component.

**Current state:**
- `src/components/workspace/context-sidebar.tsx` already has a "History" section (`SidebarShell`) with "Recent changes" and "Checkpoints" rows, but both just call `onHistory`, which opens `HistoryControls`' internal `<dialog className="dialog">` (`src/components/history/history-controls.tsx`) — a visually separate, non-`ws-panel`-styled modal. That's the "wtf is that history" reaction: it's the one surface in the redesigned workspace that doesn't look like it belongs.
- `HistoryControls` already has all the logic needed (`loadState`, `loadVersions`, `loadCheckpoints`, `run()`, undo/redo) and exposes it via the `onApi`/`HistoryApi` callback pattern used elsewhere in `workspace-shell.tsx`. Reuse this logic; change only where it renders.
- `/api/projects/[projectId]/history` already returns `{ undo, redo, history: HistoryEntry[] }` — a full timeline of operations with timestamps. `/api/projects/[projectId]/checkpoints` returns existing checkpoints with `createdAt`. A "changes since last checkpoint" count is `state.history.filter(entry => entry.createdAt > lastCheckpoint.createdAt).length` — no new backend endpoint should be needed, this can be computed client-side from data already fetched. Only add a server endpoint if that computation turns out to need pagination or is too slow to do client-side (unlikely at current scale).

**Concrete steps:**
1. Rework `ContextSidebar`'s History section so "Recent changes" and "Checkpoints" expand *inline* (accordion/expand-in-place, matching the sidebar's existing visual language) instead of calling `onHistory` to open a dialog. Move the versions list, checkpoint list, checkpoint-save form, and undo/redo controls from `HistoryControls`' `<dialog>` markup into sidebar-native markup. Keep `HistoryControls`' data/mutation logic (extract into a hook if that makes the split cleaner, e.g. `useHistoryController`) — don't reimplement the fetch/mutation logic.
2. Remove the `<dialog className="dialog">` from `history-controls.tsx` entirely once nothing depends on it. Search for other callers of `HistoryApi.openVersions`/`openCheckpoints` (`workspace-shell.tsx` keyboard shortcuts, command palette) and repoint them to expand the sidebar section instead of opening a dialog.
3. Compute the pending-change count (history entries newer than the most recent checkpoint's `createdAt`) and surface it as a small numeric badge on the "Checkpoints" sidebar row, e.g. "Checkpoints · 6". Update it live using the same `onChanged` refresh plumbing `HistoryControls` already uses after any undo/redo/restore/AI job completion.
4. Add a light, dismissible nudge (not a blocking modal — SRS principle 5 is "safe iteration," not "nag") when the count crosses a reasonable threshold or after a generation job completes, suggesting saving a checkpoint. Reuse whatever toast/notice pattern already exists in the app (check `notice`/`role="status"` usage in `media-manager.tsx` for the existing convention) rather than inventing a new one.
5. Extend `src/components/history/history-api.test.tsx` to cover the pending-count computation and the sidebar-driven open/close behavior in place of the old dialog assertions.

**Acceptance criteria:**
- No floating `<dialog>` for History remains; versions, checkpoints, undo/redo all live in the sidebar.
- The sidebar shows a live, correct count of changes since the last checkpoint.
- Keyboard shortcuts and command palette entries that used to open the History dialog still work, now expanding the sidebar instead.

---

## 4. Building Blocks: per-page attach/detach

**Problem:** The only lever today is `BlockDetails`' block-wide "Share across pages" toggle (`onToggleGlobal` in `src/components/blocks/block-library.tsx`, backed by `BuildingBlockService`'s global-toggle transaction in `src/domain/blocks/service.ts`). The "Used on" list under it shows each page's usage as "Fixed version" or "Always current" but is read-only — confirmed by the usages API route (`src/app/api/projects/[projectId]/blocks/[blockId]/usages/route.ts`) only supporting `GET`. Ahmed's decision: add a per-row pin/unpin control directly in "Used on".

**What backs "pinned" vs "global" today:** `BuildingBlockService.listUsages()` (service.ts line ~54) derives `resolution` from whether `buildingBlockUsages.buildingBlockVersionId` is `null` (`"global"`, always resolves the block's current active version — see `src/domain/blocks/usages.ts`) or set to a specific version id (`"pinned"`, frozen). The existing global-toggle transaction (service.ts lines ~99–106) already does bulk versions of exactly this: setting `buildingBlockVersionId` to `null` for all usages (attach-all) or to `locked.currentVersionId` for all unpinned usages (detach-all, i.e. freeze at today's version). The per-usage feature is the same mutation scoped to one usage row instead of all of them.

**Concrete steps:**
1. Add `BuildingBlockRepository`/`BuildingBlockService` method, e.g. `setUsageResolution(userId, projectId, blockId, usageKey, resolution: "pinned" | "global")`: authorize the user against the project (reuse whatever the existing methods use), load the block to get `currentVersionId`, and update the single `buildingBlockUsages` row identified by `usageKey` — set `buildingBlockVersionId` to `null` for `"global"`, or to `block.currentVersionId` for `"pinned"` (matching the existing bulk-toggle semantics exactly, including the "no active version" guard already present at service.ts line ~103 for the case where the block has never been generated).
2. Add `PATCH /api/projects/[projectId]/blocks/[blockId]/usages/[usageKey]` (new route file alongside the existing `usages/route.ts`), body `{ resolution: "pinned" | "global" }`, calling the new service method. Follow the existing error-handling convention (`blockErrorResponse`, `blockJsonHeaders`) used by the sibling route.
3. In `BlockDetails` (`block-library.tsx`, the "Used on" `<ul>` around line 272), add a button per row — "Detach" (freeze this page's copy) when `resolution === "global"`, "Reattach" (follow the shared block again) when `resolution === "pinned"` — calling the new endpoint and refreshing `usages` (the existing `loadDetail`/state-refresh pattern already used after `onToggleGlobal`).
4. Add an audit event for the per-usage change, matching the existing `block.made_global`/`block.made_local` events emitted by the bulk toggle (service.ts line ~116), so this shows up in the history/checkpoint activity feed built in workstream 3.
5. Unit-test the new service method (authorization, both directions, the "no active version" guard) and a component test for the new button in `BlockDetails`.

**Acceptance criteria:**
- From "Used on," a user can freeze an individual page's copy of a block, or reattach it to the shared/global version, without affecting other pages using the same block.
- The action is reflected immediately in the UI and in the History activity feed.

---

## 6. Full UI usability pass

Ahmed's ask: "run a complete UI usability test and fix the UI... ensure it's very easy to use and fun to interact with. Observe existing similar systems to improve Canvas." Scope this as a systematic audit applying the same two rules used above — sidebar-first, popups reserved for genuine wizards (Building Blocks and Theme/Identity are the SRS's own examples) — across every panel, not just the four screenshotted:

Pages/Page Settings, Media, Building Blocks, Brand & Design, Export, Collaborators, Project Settings, Shortcuts (`PANEL_NAMES` in `project-panel.tsx` is the authoritative list).

For each: does it currently need to be a modal, or could its common actions live in the sidebar with the modal reserved for the deep/rare cases (mirroring what workstream 3 does for History)? Where reference points help (VS Code's source control panel already cited by Ahmed for checkpoints; Figma/Notion/Vercel-style side panels are reasonable comparables per the SRS's own UI-direction note), use them for interaction patterns and spacing rhythm, not for copying branding or layout wholesale.

**Deliverable for this workstream specifically:** a short written audit (a markdown doc, e.g. `docs/ui-usability-audit.md`, or the PR description if the team prefers) listing, per panel, what was found and what was changed — plus the actual fixes, landed as focused commits per panel rather than one giant diff. Do this workstream last, once 1–5 have changed the panel system underneath it.

**Acceptance criteria:** every panel in `PANEL_NAMES` has been explicitly reviewed against the sidebar-first rule with a documented decision (fixed, or intentionally left as a modal with a one-line reason — e.g. Blocks and Brand stay modals because they're the SRS's own named wizard exceptions).

---

## Suggested delivery order

1. Workstream 1 (standalone-page removal) — foundational; 3, 4, 6 all touch the same panel-opening mechanism, so land this first.
2. Workstream 2 (scrolling audit) — small, isolated, can run in parallel with 1's review.
3. Workstream 3 + 5 (History/Checkpoints → sidebar, change badge) — one PR.
4. Workstream 4 (Blocks attach/detach) — backend + frontend, independent of the above once 1 has landed.
5. Workstream 6 (full usability pass) — last, informed by everything above.
