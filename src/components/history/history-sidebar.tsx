"use client";

import { ChevronDown, ChevronRight, History, Save } from "lucide-react";
import { useEffect } from "react";
import { ActivityList, CheckpointList, HistoryMessages, UndoRedoControls, VersionList } from "./history-controls";
import type { HistoryController } from "./use-history-controller";

export type HistorySection = "versions" | "checkpoints" | null;

/**
 * History as a sidebar activity rather than a floating dialog.
 *
 * Recent changes and Checkpoints expand in place, next to the website they
 * describe, the way source control reads in an editor. The section that is open
 * is owned by the workspace so a keyboard shortcut or the command palette can
 * open the right one — see WorkspaceShell.
 */
export function HistorySidebar({ controller, section, onSection }: { controller: HistoryController; section: HistorySection; onSection: (section: HistorySection) => void }) {
  const { loadVersions, loadCheckpoints } = controller;
  // Each list is fetched when it is first shown, and again whenever the thing
  // being edited changes underneath an open section.
  useEffect(() => { if (section === "versions") loadVersions(); }, [loadVersions, section]);
  useEffect(() => { if (section === "checkpoints") loadCheckpoints(); }, [loadCheckpoints, section]);

  const toggle = (next: Exclude<HistorySection, null>) => onSection(section === next ? null : next);
  const pending = controller.pendingChanges;

  return <>
    <div className="ws-pane-hd">
      <h2>History</h2>
      <div className="ws-pane-hd-acts"><UndoRedoControls controller={controller} dense /></div>
    </div>
    <div className="ws-side-body">
      <HistoryMessages controller={controller} />
      <div className="ws-side-sections">
        <Section
          open={section === "versions"}
          icon={<History size={17} />}
          title="Recent changes"
          text={controller.target?.name ? `Versions of ${controller.target.name}, and everything Canvas has committed` : "Review, undo, and restore committed work"}
          onToggle={() => toggle("versions")}
        >
          <VersionList controller={controller} />
          <h3 className="ws-side-subhead">Project activity</h3>
          <ActivityList controller={controller} />
        </Section>
        <Section
          open={section === "checkpoints"}
          icon={<Save size={17} />}
          title="Checkpoints"
          badge={pending ? String(pending) : undefined}
          text={pending
            ? `${pending} ${pending === 1 ? "change" : "changes"} since ${controller.hasCheckpoint ? "your last checkpoint" : "you started"}`
            : controller.hasCheckpoint ? "Everything is saved in a checkpoint" : "Save or restore the whole website"}
          onToggle={() => toggle("checkpoints")}
        >
          <CheckpointList controller={controller} />
        </Section>
      </div>
    </div>
    <p className="wsx-foot">Immutable versions and checkpoints</p>
  </>;
}

function Section({ open, icon, title, text, badge, onToggle, children }: { open: boolean; icon: React.ReactNode; title: string; text: string; badge?: string; onToggle: () => void; children: React.ReactNode }) {
  return <div className={`ws-side-section${open ? " open" : ""}`}>
    <button type="button" className="ws-side-link" aria-expanded={open} onClick={onToggle}>
      {icon}
      <span><strong>{title}{badge ? <em className="ws-side-badge">{badge}</em> : null}</strong><small>{text}</small></span>
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </button>
    {open ? <div className="ws-side-section-body">{children}</div> : null}
  </div>;
}
