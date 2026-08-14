"use client";

import Link from "next/link";
import { Command, PanelRight, Search, UsersRound } from "lucide-react";
import { AccountMenu } from "@/components/navigation/account-menu";
import { TaskIndicator } from "@/components/tasks/task-center";

/**
 * The workspace title bar: who you are, where you are, and how to find things.
 *
 * The breadcrumb answers "where am I?" in the product's own words — workspace,
 * website, page — and the page, the thing every edit applies to, is the one set
 * in full contrast. The workspace segment links back out, so leaving a project
 * does not mean reaching for the browser's back button.
 */
export function TitleBar({
  workspaceName, projectName, pageName, userName, canShare, activeTasks, failedTasks, saveState, agentOpen,
  onSearch, onShare, onTasks, onToggleAgent, onSignOut,
}: {
  workspaceName: string;
  projectName: string;
  pageName: string;
  userName: string;
  canShare: boolean;
  activeTasks: number;
  failedTasks: number;
  saveState?: string;
  agentOpen: boolean;
  onSearch: () => void;
  onShare: () => void;
  onTasks: () => void;
  onToggleAgent: () => void;
  onSignOut: () => void;
}) {
  return <header className="ws-title">
    <Link href="/dashboard" className="ws-brand-home" aria-label="All websites" title="All websites">
      <span aria-hidden="true"><Command size={15} /></span>
      <strong>Canvas</strong>
    </Link>

    <nav className="ws-breadcrumb" aria-label="Where you are">
      <span>{workspaceName}</span>
      <i aria-hidden="true">/</i>
      <span>{projectName}</span>
      <i aria-hidden="true">/</i>
      <strong>{pageName}</strong>
    </nav>

    <button type="button" className="ws-search-trigger" onClick={onSearch}>
      <Search size={14} aria-hidden="true" />
      <span>Search pages and actions</span>
      <kbd>⌘K</kbd>
    </button>

    <div className="ws-title-actions">
      {saveState ? <span className="ws-save-state" role="status">{saveState}</span> : null}
      <TaskIndicator activeCount={activeTasks} failedCount={failedTasks} onClick={onTasks} />
      {canShare ? <button type="button" className="ws-title-button" onClick={onShare}><UsersRound size={14} aria-hidden="true" />Share</button> : null}
      <button
        type="button"
        className="ws-title-icon"
        aria-label={agentOpen ? "Hide the agent" : "Show the agent"}
        aria-pressed={agentOpen}
        title={agentOpen ? "Hide the agent" : "Show the agent"}
        onClick={onToggleAgent}
      ><PanelRight size={16} /></button>
      <AccountMenu userName={userName} onSignOut={onSignOut} />
    </div>
  </header>;
}
