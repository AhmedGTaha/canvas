"use client";

import Image from "next/image";
import { Blocks, ChevronRight, CircleAlert, FileText, History, LoaderCircle, MousePointerClick, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { MultiMediaPicker } from "@/components/media/media-picker";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
import { AI_LIMITS } from "@/domain/ai/limits";
import { PAGE_MEDIA_ATTACHMENT_LIMIT } from "@/domain/page-generation/contract";

export type AgentMessage = { id: string; role: "user" | "assistant" | "system_internal"; content: string; createdAt: string };
export type AgentJob = null | { id: string; status: string; progressStage: string; errorMessage: string | null };
export type AgentTarget = { kind: "page"; id: string; name: string } | { kind: "block"; id: string; name: string } | null;
export type AgentSelection = { canvasId: string; elementType: string; label: string | null; blockId: string | null } | null;

const STARTERS = [
  "Create a modern homepage with a hero, services, and a contact call-to-action.",
  "Add an about section that explains what we do.",
  "Give this page a footer that matches the rest of the website.",
];

/**
 * The Website Agent panel.
 *
 * The conversation is the panel's main content and gets the vertical space,
 * rather than being a short scroll box wedged under the page list as it was in
 * the old Builder sidebar. The composer is pinned to the bottom.
 */
export function AgentPanel({
  target, selection, selectMode, messages, job, activeJob, loading, error, prompt, selectedMediaIds, assets, folders, built,
  onPrompt, onMedia, onClearSelection, onSubmit, onCancel, onHide, onOpenHistory,
}: {
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
  onPrompt: (value: string) => void;
  onMedia: (ids: string[]) => void;
  onClearSelection: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  onHide: () => void;
  onOpenHistory: () => void;
}) {
  const thread = useRef<HTMLDivElement>(null);
  const editingBlock = target?.kind === "block";
  const visible = (messages ?? []).filter((message) => message.role !== "system_internal");

  // Follow the conversation as it grows, the way a chat panel should.
  useEffect(() => { thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [visible.length, activeJob?.progressStage]);

  const placeholder = selection
    ? "Make this card more compact…"
    : built
      ? (editingBlock ? "Change the spacing in this shared block…" : "Make the hero shorter and improve the spacing on phones…")
      : "Describe the page you want — for example, a services page with three cards…";
  const sendLabel = selection ? "Update element" : built ? (editingBlock ? "Update block" : "Update page") : "Create page";
  const canSend = Boolean(target) && Boolean(prompt.trim()) && !activeJob && !loading;

  return <>
    <div className="ws-pane-hd">
      <h2>Website Agent</h2>
      <div className="ws-pane-hd-acts">
        <button type="button" className="ws-icon-btn" title="Version history" aria-label="Version history" onClick={onOpenHistory}><History size={14} /></button>
        <button type="button" className="ws-icon-btn" title="Hide the agent panel" aria-label="Hide the agent panel" onClick={onHide}><ChevronRight size={14} /></button>
      </div>
    </div>

    {/* What the agent will change, stated before you type rather than inferred. */}
    <div className="wsa-context">
      {editingBlock ? <Blocks size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}
      <span className="wsa-context-label">Editing</span>
      <strong>{target ? target.name : "nothing yet"}</strong>
      {selection ? <span className="ws-chip" style={{ marginLeft: "auto" }}>
        <MousePointerClick size={10} aria-hidden="true" />
        <span>{selection.label ?? selection.elementType}</span>
        <button type="button" className="ws-chip-x" aria-label="Clear selected element" onClick={onClearSelection}><X size={10} /></button>
      </span> : null}
    </div>

    <div className="wsa-thread" ref={thread}>
      {loading && !messages ? <p className="wsa-empty"><LoaderCircle className="spin" size={16} aria-hidden="true" />Loading this conversation…</p>
        : !visible.length ? <div className="wsa-empty">
            <Sparkles size={20} aria-hidden="true" style={{ color: "var(--focus)" }} />
            <h3>{built ? "Ask for a change" : "Let's build this page"}</h3>
            <p>{built ? "Describe what you want different and the agent will edit this page." : "Describe the page in your own words. You can refine it afterwards."}</p>
            {!built ? <div className="wsa-suggestions">{STARTERS.map((starter) => <button key={starter} type="button" onClick={() => onPrompt(starter)}>{starter}</button>)}</div> : null}
          </div>
        : visible.map((message) => message.role === "user"
            ? <p className="wsa-user" key={message.id}>{message.content}</p>
            : <div className="wsa-agent" key={message.id}>
                <p className="wsa-agent-hd"><Sparkles size={12} aria-hidden="true" />Canvas</p>
                <p>{message.content}</p>
              </div>)}

      {activeJob ? <div className="wsa-progress" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={13} aria-hidden="true" />
        <span>{activeJob.progressStage}</span>
        <button type="button" className="button button-secondary button-sm" onClick={onCancel} disabled={loading}>Cancel</button>
      </div> : null}

      {job?.status === "failed" ? <p className="wsa-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{job.errorMessage || "The agent could not apply that change. Try describing it differently."}</p> : null}
      {error ? <p className="wsa-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{error}</p> : null}
      {selectMode && !selection ? <p className="ws-chip ws-chip-neutral" style={{ alignSelf: "flex-start" }}><MousePointerClick size={11} aria-hidden="true" /><span>Click a part of the website to select it</span></p> : null}
    </div>

    <div className="wsa-composer">
      {selectedMediaIds.length ? <div className="wsa-chips">{selectedMediaIds.map((id) => {
        const asset = assets.find((item) => item.id === id);
        return asset ? <span className="ws-chip ws-chip-neutral" key={id}>
          <Image src={`/api/media/${id}`} width={18} height={18} alt="" unoptimized />
          <span>{asset.displayName}</span>
          <button type="button" className="ws-chip-x" aria-label={`Remove ${asset.displayName}`} onClick={() => onMedia(selectedMediaIds.filter((item) => item !== id))}><X size={10} /></button>
        </span> : null;
      })}</div> : null}

      <textarea
        aria-label={selection ? "Ask the agent to change the selected element" : built ? "Ask the agent to change this page" : "Describe the page you want"}
        value={prompt}
        rows={3}
        maxLength={AI_LIMITS.userMessageCharacters}
        disabled={!target || Boolean(activeJob)}
        placeholder={placeholder}
        onChange={(event) => onPrompt(event.target.value)}
        // Enter sends, Shift+Enter adds a line — the convention for chat composers.
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) onSubmit(); } }}
      />

      <div className="wsa-composer-bar">
        <MultiMediaPicker assets={assets} folders={folders} value={selectedMediaIds} limit={PAGE_MEDIA_ATTACHMENT_LIMIT} onSelect={onMedia} compact />
        {prompt.length > AI_LIMITS.userMessageCharacters * 0.8
          ? <span className="wsa-count">{prompt.length.toLocaleString()} / {AI_LIMITS.userMessageCharacters.toLocaleString()}</span>
          : null}
        <button type="button" className="wsa-send" disabled={!canSend} onClick={onSubmit}>
          {loading && !activeJob ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
          {sendLabel}
        </button>
      </div>
    </div>
  </>;
}
