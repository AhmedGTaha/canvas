"use client";

import { Blocks, Check, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { SegmentedControl } from "@/components/ui/segmented";
import { STARTER_CATEGORY_LABELS, type StarterCategory } from "@/domain/blocks/starter-library/types";

type StarterEntry = { id: string; category: StarterCategory; name: string; description: string; kind: string; interactive: boolean };
export type ProjectSection = { id: string; name: string; isGlobal: boolean; contentStatus?: string };
export type SectionPlacement = { position: "top" } | { position: "bottom" } | { position: "before"; anchor: string } | { position: "after"; anchor: string };

type Source = "project" | "library";

/**
 * Add a reusable section to the page being previewed.
 *
 * Two routes to the same outcome: a section this project already has, or one of the
 * built-in starters, which is copied into the project first and is an ordinary block
 * from that moment on. Placement is expressed the way someone thinks about a page —
 * top, bottom, or beside the thing they have selected — rather than by dragging.
 */
export function AddSectionDialog({ projectId, open, pageId, pageName, selectionAnchor, selectionLabel, projectSections, onClose, onAdded }: {
  projectId: string;
  open: boolean;
  pageId: string | null;
  pageName: string;
  /** The `data-canvas-id` or usage key currently selected in the Preview, if any. */
  selectionAnchor: string | null;
  selectionLabel: string | null;
  projectSections: ProjectSection[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [source, setSource] = useState<Source>(projectSections.length ? "project" : "library");
  const [starters, setStarters] = useState<StarterEntry[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [placement, setPlacement] = useState<SectionPlacement["position"]>("bottom");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Opening is a fresh decision, so the dialog forgets the last one. Adjusting state
  // during render rather than in an effect avoids a visible frame of the previous
  // choice, which is exactly what React recommends this pattern for.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setChosen(null); setError(undefined); setPlacement(selectionAnchor ? "after" : "bottom"); }
  }

  useEffect(() => {
    if (!open || source !== "library" || starters) return;
    let active = true;
    void fetch(`/api/projects/${projectId}/starter-sections`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ starters?: StarterEntry[]; error?: string }>)
      .then((value) => { if (active) { if (value.starters) setStarters(value.starters); else setError(value.error ?? "The starter library could not be loaded."); } })
      .catch(() => { if (active) setError("The starter library could not be loaded."); });
    return () => { active = false; };
  }, [open, projectId, source, starters]);

  const grouped = useMemo(() => {
    const groups = new Map<StarterCategory, StarterEntry[]>();
    for (const entry of starters ?? []) groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
    return [...groups.entries()];
  }, [starters]);

  const usable = projectSections.filter((section) => section.contentStatus !== "unbuilt");

  async function add() {
    if (!pageId || !chosen) return;
    setBusy(true); setError(undefined);
    try {
      // One request, so a library section is copied into the project and placed on the
      // page in a single transaction. Doing it in two left an orphan block behind
      // whenever the second half failed.
      const body = {
        ...(source === "library" ? { starterId: chosen } : { blockId: chosen }),
        placement: placement === "before" || placement === "after" ? { position: placement, anchor: selectionAnchor } : { position: placement },
      };
      const response = await fetch(`/api/projects/${projectId}/pages/${pageId}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || "That section could not be added to this page.");
      onAdded();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "That section could not be added to this page."); }
    finally { setBusy(false); }
  }

  const placementOptions = [
    { value: "top" as const, label: "Top of page" },
    { value: "bottom" as const, label: "Bottom of page" },
    ...(selectionAnchor ? [{ value: "before" as const, label: "Before selection" }, { value: "after" as const, label: "After selection" }] : []),
  ];

  return <Modal
    open={open}
    size="wide"
    title="Add a section"
    description={pageId ? `Choose a reusable section to add to ${pageName}.` : "Open a page first, then add a section to it."}
    onClose={onClose}
    footer={<div className="dialog-footer">
      {error ? <p className="form-error" role="alert">{error}</p> : <p className="text-sm text-muted">{selectionAnchor && (placement === "before" || placement === "after") ? `Placed ${placement} ${selectionLabel ?? "the selected section"}.` : `Placed at the ${placement} of the page.`}</p>}
      <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="button" variant="primary" icon={<Check size={15} />} loading={busy} disabled={!chosen || !pageId} onClick={() => void add()}>Add section</Button>
    </div>}
  >
    <div className="add-section">
      <div className="add-section-controls">
        <SegmentedControl label="Where the section comes from" value={source} onChange={(value) => { setSource(value); setChosen(null); }} options={[
          { value: "project", label: `This website (${usable.length})`, icon: <Blocks size={13} /> },
          { value: "library", label: "Canvas library", icon: <Sparkles size={13} /> },
        ]} />
        <SegmentedControl label="Where to place it" value={placement} onChange={setPlacement} options={placementOptions} />
      </div>

      {source === "project" ? <div className="add-section-list">
        {usable.length ? usable.map((section) => <SectionChoice
          key={section.id}
          id={section.id}
          name={section.name}
          description={section.isGlobal ? "Shared — edits reach every page using it" : "Used on this page only unless you share it"}
          selected={chosen === section.id}
          onSelect={setChosen}
        />) : <p className="text-sm text-muted">This website has no built reusable sections yet. Try the Canvas library.</p>}
      </div> : starters ? <div className="add-section-groups">
        {grouped.map(([category, entries]) => <section key={category}>
          <h3>{STARTER_CATEGORY_LABELS[category]}</h3>
          <div className="add-section-list">
            {entries.map((entry) => <SectionChoice
              key={entry.id}
              id={entry.id}
              name={entry.name}
              description={entry.description}
              badge={entry.interactive ? "Interactive" : undefined}
              selected={chosen === entry.id}
              onSelect={setChosen}
            />)}
          </div>
        </section>)}
      </div> : <p className="text-sm text-muted"><LoaderCircle className="spin" size={14} /> Loading the Canvas library…</p>}
    </div>
  </Modal>;
}

function SectionChoice({ id, name, description, badge, selected, onSelect }: { id: string; name: string; description: string; badge?: string; selected: boolean; onSelect: (id: string) => void }) {
  return <button type="button" className="add-section-choice" aria-pressed={selected} onClick={() => onSelect(id)}>
    <span className="add-section-choice-main">
      <strong>{name}{badge ? <span className="add-section-badge">{badge}</span> : null}</strong>
      <small>{description}</small>
    </span>
    {selected ? <Check size={15} aria-hidden="true" /> : null}
  </button>;
}
