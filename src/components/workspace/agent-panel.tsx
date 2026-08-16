"use client";

import { Blocks, ChevronRight, Clock, FileText, History, LoaderCircle, MousePointerClick, Plus, Sparkles, Unlink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chip } from "@/components/ui/feedback";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
import { PAGE_MEDIA_ATTACHMENT_LIMIT } from "@/domain/page-generation/contract";
import { AgentComposer, AgentError, AgentMessage as AgentMessageView, AgentProgress } from "./agent-parts";
import { jobLabel } from "./work-state";

export type AgentMessage = { id: string; role: "user" | "assistant" | "system_internal"; content: string; createdAt: string };
export type AgentJob = null | { id: string; status: string; progressStage: string; errorMessage: string | null };
export type AgentTarget = { kind: "page"; id: string; name: string } | { kind: "block"; id: string; name: string } | null;
export type AgentQueueItem = { id: string; prompt: string; status: "queued" | "paused" | "claimed" | "completed" | "cancelled"; pauseReason: string | null; editable: boolean; selectedMediaIds: string[]; selectedElement: unknown };
export type AgentSelection = { canvasId: string; elementType: string; label: string | null; blockId: string | null } | null;

const STARTERS = [
  "A homepage with a hero, three services, and a way to get in touch.",
  "An about page that explains who we are and what we believe.",
  "A contact page with our address, opening hours and a map.",
];

/**
 * The Canvas agent.
 *
 * Six states, each one visibly different: nothing asked yet, your request,
 * the agent working, a follow-up waiting its turn, changes applied and
 * reviewable, and a failure you can act on. The panel's job is that you never
 * have to guess which of the six you are in.
 */
export function AgentPanel({
  target, selection, selectMode, messages, job, activeJob, loading, error, prompt, selectedMediaIds, assets, folders, built,
  sectionUsage, sectionBusy, sectionError, onRemoveSection, onAddSection,
  queue, onPrompt, onMedia, onClearSelection, onSubmit, onCancel, onCancelQueued, onEditQueued, onReview, onHide, onOpenHistory,
}: {
  /** Set when the selected element is a page's usage of a shared Building Block. */
  sectionUsage: { blockId: string; usageKey: string; name: string } | null;
  sectionBusy: boolean;
  sectionError?: string;
  onRemoveSection: () => void;
  onAddSection: () => void;
  target: AgentTarget;
  selection: AgentSelection;
  selectMode: boolean;
  messages: AgentMessage[] | null;
  job: AgentJob;
  activeJob: AgentJob;
  loading: boolean;
  error?: string;
  prompt: string;
  selectedMediaIds: string[];
  assets: MediaAsset[];
  folders: MediaFolder[];
  built: boolean;
  queue: AgentQueueItem[];
  onPrompt: (value: string) => void;
  onMedia: (ids: string[]) => void;
  onClearSelection: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  onCancelQueued: (id: string) => void;
  onEditQueued: (item: AgentQueueItem, prompt: string) => void;
  onReview: (jobId: string) => void;
  onHide: () => void;
  onOpenHistory: () => void;
}) {
  const thread = useRef<HTMLDivElement>(null);
  // The workspace restores client-only state immediately after mount. Keep the
  // first browser render aligned with SSR so a restored composer value cannot
  // make the send button disagree with the server during hydration.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setHydrated(true), 0); return () => window.clearTimeout(timer); }, []);
  const editingBlock = target?.kind === "block";
  const visible = (messages ?? []).filter((message) => message.role !== "system_internal");

  // Follow the conversation as it grows, the way a chat panel should.
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [visible.length, activeJob?.progressStage]);

  const placeholder = selection
    ? "Make this part smaller, or change its wording…"
    : built
      ? (editingBlock ? "Change the spacing in this shared section…" : "Make the hero shorter, and tidy the spacing on phones…")
      : "Describe the page you want — for example, a services page with three cards…";
  /*
   * Sending and queueing are different acts, so they do not quietly share one
   * button label. While the agent is working the composer says so above the
   * field, and the button names the queue rather than the change — nothing is
   * applied to the website until this request's turn comes.
   */
  const sendLabel = activeJob ? "Add to the queue" : selection ? "Update this part" : built ? (editingBlock ? "Update section" : "Update page") : "Create page";
  const canSend = hydrated && Boolean(target) && Boolean(prompt.trim()) && !loading;
  const waiting = queue.filter((item) => item.status === "queued" || item.status === "paused");
  const queueNotice = activeJob
    ? <p className="wsa-composer-note" role="status">
        <Clock size={12} aria-hidden="true" />
        Canvas is still working. Your next request waits its turn{waiting.length ? ` behind ${waiting.length === 1 ? "one other" : `${waiting.length} others`}` : ""}.
      </p>
    : undefined;

  return <>
    <div className="ws-pane-hd">
      <h2>Canvas Agent</h2>
      <div className="ws-pane-hd-acts">
        <button type="button" className="ws-icon-btn" title="What changed and when" aria-label="What changed and when" onClick={onOpenHistory}><History size={14} /></button>
        <button type="button" className="ws-icon-btn" title="Hide the agent" aria-label="Hide the agent" onClick={onHide}><ChevronRight size={14} /></button>
      </div>
    </div>

    {/* What the agent will change, stated before you type rather than inferred. */}
    <div className="wsa-context">
      {editingBlock ? <Blocks size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
      <span className="wsa-context-label">{selection ? "Editing" : editingBlock ? "Section" : "Page"}</span>
      <strong>{target ? target.name : "No page open"}</strong>
      {selection ? <span style={{ marginLeft: "auto" }}>
        <Chip accent icon={<MousePointerClick size={10} aria-hidden="true" />} removeLabel="Stop editing this part" onRemove={onClearSelection}>
          {selection.label ?? selection.elementType}
        </Chip>
      </span> : null}
    </div>

    {/* Composing the page, not talking to the agent: adding a section and taking one
        off are direct acts with immediate results, so they sit above the thread and
        never go through a prompt. */}
    <div className="wsa-sections">
      <button type="button" className="wsa-section-btn" disabled={!target || target.kind !== "page" || sectionBusy} onClick={onAddSection}>
        <Plus size={13} aria-hidden="true" />Add section
      </button>
      {sectionUsage ? <button type="button" className="wsa-section-btn wsa-section-remove" disabled={sectionBusy} onClick={onRemoveSection}>
        {sectionBusy ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : <Unlink size={13} aria-hidden="true" />}
        Remove {sectionUsage.name} from this page
      </button> : null}
    </div>
    {sectionError ? <p className="wsa-section-error" role="alert">{sectionError}</p> : null}

    <div className="wsa-thread" ref={thread}>
      {loading && !messages ? <p className="wsa-empty"><LoaderCircle className="spin" size={16} aria-hidden="true" />Opening this conversation…</p>
        : !visible.length ? <div className="wsa-empty">
            <Sparkles size={20} aria-hidden="true" style={{ color: "var(--focus)" }} />
            <h3>{built ? "Ask for a change" : "Let's build this page"}</h3>
            <p>{built ? "Describe what you want different, in your own words." : "Describe the page in your own words. You can change anything about it afterwards."}</p>
            {!built ? <div className="wsa-suggestions">{STARTERS.map((starter) => <button key={starter} type="button" onClick={() => onPrompt(starter)}>{starter}</button>)}</div> : null}
          </div>
        : visible.map((message) => <AgentMessageView key={message.id} role={message.role} content={message.content} />)}

      {activeJob ? <AgentProgress stage={jobLabel(activeJob.status, activeJob.progressStage)} busy={loading} onCancel={onCancel} /> : null}
      {waiting.map((item, index) => <QueuedFollowUp key={item.id} item={item} position={index + 1} onCancel={onCancelQueued} onEdit={onEditQueued} />)}

      {job?.status === "failed" ? <AgentError>{job.errorMessage || "The agent could not make that change, and nothing on your website was altered. Try describing it a different way."}</AgentError> : null}
      {job?.status === "completed" ? <button type="button" className="wsa-review-link" onClick={() => onReview(job.id)}>See what changed</button> : null}
      {error ? <AgentError>{error}</AgentError> : null}
      {selectMode && !selection ? <span style={{ alignSelf: "flex-start" }}><Chip icon={<MousePointerClick size={11} aria-hidden="true" />}>Click a part of the website to edit just that</Chip></span> : null}
    </div>

    <AgentComposer
      label={selection ? "Ask the agent to change the selected part" : built ? "Ask the agent to change this page" : "Describe the page you want"}
      placeholder={placeholder}
      sendLabel={sendLabel}
      prompt={prompt}
      disabled={!target}
      busy={loading && !activeJob}
      canSend={canSend}
      selectedMediaIds={selectedMediaIds}
      assets={assets}
      folders={folders}
      mediaLimit={PAGE_MEDIA_ATTACHMENT_LIMIT}
      before={queueNotice}
      onPrompt={onPrompt}
      onMedia={onMedia}
      onSubmit={onSubmit}
    />
  </>;
}

/**
 * A request waiting its turn.
 *
 * It is deliberately quieter than the work in progress — grey rather than the
 * agent's blue — so the one thing happening now stays the loudest thing in the
 * panel. Paused means Canvas needs an answer before it can continue.
 */
function QueuedFollowUp({ item, position, onCancel, onEdit }: { item: AgentQueueItem; position: number; onCancel: (id: string) => void; onEdit: (item: AgentQueueItem, prompt: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.prompt);
  const paused = item.status === "paused";
  return <div className={`wsa-progress ${paused ? "wsa-error" : "wsa-queued"}`} role="status">
    {paused ? null : <Clock size={13} aria-hidden="true" />}
    <span>{paused ? "Needs your attention" : `Next up · ${position}`}</span>
    <p>{paused ? item.pauseReason : item.prompt}</p>
    {item.editable && editing
      ? <><textarea aria-label="Edit this queued request" value={value} onChange={(event) => setValue(event.target.value)} />
          <button type="button" className="button button-secondary button-sm" onClick={() => { onEdit(item, value); setEditing(false); }}>Save</button></>
      : null}
    {item.editable && !editing ? <button type="button" className="button button-secondary button-sm" onClick={() => setEditing(true)}>Edit</button> : null}
    {item.editable ? <button type="button" className="button button-secondary button-sm" onClick={() => onCancel(item.id)}>Remove</button> : null}
  </div>;
}
