import { AlertCircle, FolderOpen, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="state-icon"><FolderOpen size={22} /></span><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={18} /><span>{label}</span></div>;
}

export function ErrorState({ title = "Something went wrong", description, retry }: { title?: string; description: string; retry?: ReactNode }) {
  return <div className="empty-state error-state"><span className="state-icon"><AlertCircle size={22} /></span><h2>{title}</h2><p>{description}</p>{retry}</div>;
}
