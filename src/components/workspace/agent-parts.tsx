"use client";

import Image from "next/image";
import { CircleAlert, LoaderCircle, Send, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { MultiMediaPicker } from "@/components/media/media-picker";
import { Chip } from "@/components/ui/feedback";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
import { AI_LIMITS } from "@/domain/ai/limits";

/**
 * The parts the agent is made of, shared by the workspace agent panel and the
 * composer inside Reusable sections.
 *
 * These were two implementations of the same conversation — different markup,
 * different wording, different states — so a change to how the agent reports
 * itself had to be made twice and never was. One set of parts means the agent
 * behaves the same wherever you talk to it.
 */

/**
 * What the agent said, in the reader's terms.
 *
 * Models write a summary paragraph, a list of what changed, and often a set of
 * "Limitation:" notes that are really implementation detail — missing media
 * keys, route internals. The summary and the list are what a person needs;
 * the rest is folded away rather than dumped into the conversation.
 */
export function AgentMessageBody({ content }: { content: string }) {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const lead: string[] = [];
  const changes: string[] = [];
  const notes: string[] = [];
  for (const line of lines) {
    if (/^limitation[s]?\s*:/i.test(line) || /^note\s*:/i.test(line)) notes.push(line.replace(/^(limitations?|note)\s*:\s*/i, ""));
    else if (/^[•\-*]\s+/.test(line)) changes.push(line.replace(/^[•\-*]\s+/, ""));
    else if (changes.length) changes.push(line);
    else lead.push(line);
  }
  return <div className="wsa-changes">
    {lead.length ? <p>{lead.join(" ")}</p> : null}
    {changes.length ? <ul className="wsa-change-list">{changes.map((change, index) => <li key={index}>{change}</li>)}</ul> : null}
    {notes.length ? <details className="wsa-details">
      <summary>{notes.length === 1 ? "One thing the agent could not do" : `${notes.length} things the agent could not do`}</summary>
      <ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </details> : null}
  </div>;
}

/** One exchange in the conversation. */
export function AgentMessage({ role, content }: { role: "user" | "assistant" | "system_internal"; content: string }) {
  if (role === "system_internal") return null;
  if (role === "user") return <p className="wsa-user">{content}</p>;
  return <div className="wsa-agent">
    <p className="wsa-agent-hd"><Sparkles size={12} aria-hidden="true" />Canvas</p>
    <AgentMessageBody content={content} />
  </div>;
}

/** The agent is working. Says what stage it is at, and offers the way out. */
export function AgentProgress({ stage, busy, onCancel }: { stage: string; busy: boolean; onCancel: () => void }) {
  return <div className="wsa-progress" role="status" aria-live="polite">
    <LoaderCircle className="spin" size={13} aria-hidden="true" />
    <span>{stage}</span>
    <button type="button" className="button button-secondary button-sm" onClick={onCancel} disabled={busy}>Stop</button>
  </div>;
}

/**
 * Something went wrong, said in a way the reader can act on.
 *
 * Provider names, status codes and schema paths are what the log is for; here
 * the message says what happened to the website (nothing) and what to do next.
 */
export function AgentError({ children }: { children: ReactNode }) {
  return <p className="wsa-error" role="alert"><CircleAlert size={14} aria-hidden="true" /><span>{children}</span></p>;
}

/**
 * The composer.
 *
 * Enter sends and Shift+Enter adds a line — the convention for chat, and the
 * thing people try first. The button says what will happen to what: create a
 * page, update a section, update the selected element.
 */
export function AgentComposer({
  label, placeholder, sendLabel, prompt, disabled, busy, canSend, selectedMediaIds, assets, folders, mediaLimit, before, onPrompt, onMedia, onSubmit,
}: {
  label: string;
  placeholder: string;
  sendLabel: string;
  prompt: string;
  disabled: boolean;
  busy: boolean;
  canSend: boolean;
  selectedMediaIds: string[];
  assets: MediaAsset[];
  folders: MediaFolder[];
  mediaLimit: number;
  before?: ReactNode;
  onPrompt: (value: string) => void;
  onMedia: (ids: string[]) => void;
  onSubmit: () => void;
}) {
  return <div className="wsa-composer">
    {before}
    {selectedMediaIds.length ? <div className="wsa-chips">{selectedMediaIds.map((id) => {
      const asset = assets.find((item) => item.id === id);
      return asset ? <Chip
        key={id}
        icon={<Image src={`/api/media/${id}`} width={18} height={18} alt="" unoptimized />}
        removeLabel={`Remove ${asset.displayName}`}
        onRemove={() => onMedia(selectedMediaIds.filter((item) => item !== id))}
      >{asset.displayName}</Chip> : null;
    })}</div> : null}

    <textarea
      aria-label={label}
      value={prompt}
      rows={3}
      maxLength={AI_LIMITS.userMessageCharacters}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => onPrompt(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (canSend) onSubmit(); } }}
    />

    <div className="wsa-composer-bar">
      <MultiMediaPicker assets={assets} folders={folders} value={selectedMediaIds} limit={mediaLimit} onSelect={onMedia} compact />
      {prompt.length > AI_LIMITS.userMessageCharacters * 0.8
        ? <span className="wsa-count">{prompt.length.toLocaleString()} / {AI_LIMITS.userMessageCharacters.toLocaleString()}</span>
        : null}
      <button type="button" className="wsa-send" disabled={!canSend} onClick={onSubmit}>
        {busy ? <LoaderCircle className="spin" size={12} aria-hidden="true" /> : <Send size={12} aria-hidden="true" />}
        {sendLabel}
      </button>
    </div>
  </div>;
}
