# Canvas UI usability audit

**Scope:** every entry in `PANEL_NAMES` (`src/components/workspace/panel-names.ts`), reviewed against the
rule this whole round of work was held to, from the SRS and from Ahmed's notes:

> If an action can be done in the left sidebar then no need for the pop-up, just keep pop-ups for large
> wizards like Building Blocks and Theme/Identity.

**Method.** Each panel was opened in a real browser (Chrome, 1366×768, 1440×900 and 390×844) against a
seeded project with realistic content — 35 images, 20 reusable sections, a page tree three levels deep.
For each panel a script recorded its heading structure, every control and whether it had an accessible
name, duplicate control names, where focus landed on open, whether every control was reachable by
scrolling, and any nested scroll region. The findings below are what that pass turned up, not a reading
of the source.

**Date:** August 2026, after workstreams 1–5 of `docs/plans/Canvas_UI_Fix_Plan.md` landed.

---

## Per-panel decisions

| Panel | Surface | Decision |
| --- | --- | --- |
| `overview` — Project Settings | Drawer | **Stays a modal.** A read-mostly summary plus three cross-references, opened from the activity bar's gear. There is no Project activity in the sidebar, and adding one for four facts would spend a permanent slot to save a click on a rare surface. |
| `pages` — Page/Folder Settings | Drawer | **Stays a modal.** Everything done often — browse, rename, reorder, create, delete — is already inline in the Website tree. This drawer holds the rest: slug, page title, meta description. It is only ever opened from the row it edits. |
| `media` — Images | Wide | **Partly moved.** Uploading, the one thing anyone does with media constantly, now happens in the Assets sidebar with no popup. Organising into folders and editing alt text stay in the panel, which now opens on the image that was picked. |
| `blocks` — Reusable Sections | Wide | **Stays a modal — the SRS's own named wizard exception.** It carries a live preview, an AI composer and version history; it cannot be a 286px column. The sidebar now opens it on the section that was clicked rather than on whichever sorted first. |
| `brand` — Brand & design | Wide | **Stays a modal — the SRS's other named exception (Theme/Identity).** Two colour modes, seven scales and a live preview. The sidebar's two rows now open it at the part each names. |
| `export` — Export website | Drawer | **Stays a modal.** A rare, sequential task — validate, build, download — with a result to come back to. Progress stays visible with it closed through the task centre, so nothing is lost by not having a sidebar slot. |
| `collaborators` | Drawer | **Stays a modal.** Opened from Share in the title bar, used a handful of times per project. Owner-only actions; keeping them off a permanent surface keeps the destructive ones out of the way. |
| `settings` — Agent guidance | Drawer | **Stays a modal.** One long instruction field with its own autosave. Renamed from "Project settings", which collided with the `overview` panel's heading while the command and the sidebar row that open it both said "Agent guidance". |
| `shortcuts` — Keyboard shortcuts | Drawer | **Stays a modal.** Reference material, read once and dismissed. |
| History (was a `<dialog>`) | **Now the sidebar** | Done in workstream 3+5. Versions, checkpoints, undo/redo and the activity feed expand in place in the History activity; no floating History dialog remains anywhere in the app. |

Four surfaces changed behaviour; five were reviewed and deliberately left as modals for the reasons above.

---

## Defects found and fixed

**Every wide panel grew past the viewport instead of scrolling** (workstream 2). Brand rendered 1972px
tall into a 900px window with nothing scrollable. The panel insets are written as
`calc(var(--ws-title-h) + 10px)`, and those custom properties were declared on `.ws-shell` — but a panel
is a fixed-position *sibling* of the shell, so it could not resolve them, the insets fell back to `auto`,
and the dialog sized itself to its content. Phones escaped because that breakpoint hard-codes `inset: 0`.
Fixed by declaring the chrome heights at `:root`.

**A column inside Reusable Sections capped itself at 900px** — taller than the panel body it sits in, so
its own scrollbar started below the fold, and reaching the composer under the block list took two
scrolls. That cap is lifted inside a panel.

**Two fields on one screen shared an id.** `Input`/`Textarea`/`Select` fell back to the literal id
`"input"`/`"textarea"`/`"select"` when a field had neither an explicit id nor a form name. Brand renders
three such fields; all three labels pointed at the first control and the other two had no accessible name
at all. Ids are now generated per instance.

**Opening a tool parked focus on its close button.** `showModal()` moves focus to the first focusable
descendant, which in every panel is the close button — so the first thing a screen reader announced on
opening a tool was how to leave it. Focus now goes to the panel, which announces its heading.

**Controls with no name, or the same name twice.** The new-folder box in Images had only a placeholder.
Brand had two `Light` buttons, two `Dark` buttons and two `Reset theme` buttons with nothing to tell them
apart by name.

**Sidebar rows that did not open what they named.** Design's "Brand identity" and "Theme" both opened
Brand at the top. Reusable Sections' rows all opened the panel on the same block. Assets' thumbnails all
opened the library at the top. Each now opens what it names.

**Two panels headed "Project settings".** `overview` and `settings` used near-identical titles while the
command and sidebar row that open `settings` both called it "Agent guidance". Renamed to match.

---

## Left alone, on purpose

- **`pages` with nothing selected** shows "No page selected — close this drawer and choose a page or
  folder from Website". It is only reachable by editing the URL by hand, and the copy says what to do.
- **Two "Cancel" buttons in Reusable Sections.** One belongs to the closed create dialog, one to the AI
  progress row; only one is ever visible. Renaming either would make the visible one worse.
- **Export has no sidebar slot.** It is in the command palette and in Project Settings, and its progress
  is visible with every panel closed through the task centre. SRS Definition of Done 24 is satisfied
  without spending a permanent activity slot on a once-per-project action.

---

## Known limitation, recorded rather than fixed

Per-page attach/detach (workstream 4) writes a usage's resolution directly. Activating a Page Version
rebuilds that page's usage rows from the block's own global flag, so a per-page freeze on a shared block
lasts until that page is next rebuilt. This is the rule the block-wide "Share across pages" toggle has
always had; changing it would change generation semantics and was out of scope here. It is asserted in
`src/domain/blocks/phase9.integration.test.ts` so it stays a decision on record rather than a surprise.

---

## What guards this

- `src/components/workspace/workspace.test.tsx` — no route renders a tool without the workspace behind
  it; every custom property a panel is styled from is declared where a panel can see it; no column inside
  a panel caps itself in pixels; sidebar rows open what they name; uploading from the sidebar opens
  nothing.
- `src/components/workspace/feature-panel.test.tsx` — focus placement, close semantics, scrollable body.
- `src/components/accessibility.test.tsx` — every field gets its own id.
- `src/components/history/history-api.test.tsx` — History has no dialog, and its lists expand in place.
- `src/app/responsive.test.ts` — dialogs and panels stay inside the viewport on phones.
