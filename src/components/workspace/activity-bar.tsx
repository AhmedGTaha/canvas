"use client";
import { Blocks, CircleHelp, FileText, History, Images, Palette, Settings } from "lucide-react";
import type { WorkspaceActivity } from "./workspace-layout";

const ACTIVITIES = [
  { id: "website", label: "Website", icon: FileText }, { id: "assets", label: "Assets", icon: Images },
  { id: "design", label: "Design", icon: Palette }, { id: "sections", label: "Reusable Sections", icon: Blocks },
  { id: "history", label: "History", icon: History },
] as const;

export function ActivityBar({ activity, sidebarOpen, onActivity, onSettings, onHelp }: { activity: WorkspaceActivity; sidebarOpen: boolean; onActivity: (activity: WorkspaceActivity) => void; onSettings: () => void; onHelp: () => void }) {
  return <nav className="ws-activity" aria-label="Website tools">
    <div>{ACTIVITIES.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={activity === id && sidebarOpen ? "selected" : ""} aria-label={label} aria-current={activity === id && sidebarOpen ? "page" : undefined} data-tooltip={label} onClick={() => onActivity(id)}><Icon size={20} aria-hidden="true" /><span>{label}</span></button>)}</div>
    <div className="ws-activity-bottom"><button type="button" aria-label="Website settings" data-tooltip="Website settings" onClick={onSettings}><Settings size={19} /><span>Settings</span></button><button type="button" aria-label="Help and keyboard shortcuts" data-tooltip="Help and shortcuts" onClick={onHelp}><CircleHelp size={19} /><span>Help</span></button></div>
  </nav>;
}
