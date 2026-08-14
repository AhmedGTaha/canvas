import Link from "next/link";
import { Globe } from "lucide-react";
import type { Project } from "@/server/db/schema";
import { StatusBadge } from "@/components/ui/status-badge";

/**
 * A website in a list.
 *
 * A row rather than a 148px card: the useful facts about a website are its
 * name, what it is for, and when it last changed, and a row shows all three at
 * a glance while fitting eight on the screen where a card grid fit six.
 */
export function ProjectCard({ project, workspaceName }: { project: Project; workspaceName?: string }) {
  return <Link href={`/projects/${project.id}`} className="entity-row">
    <span className="entity-row-icon" aria-hidden="true"><Globe size={16} /></span>
    <span className="entity-row-main">
      <strong>{project.name}</strong>
      <small>{project.description || "No description yet"}</small>
    </span>
    {workspaceName ? <span className="entity-row-meta">{workspaceName}</span> : null}
    {project.status === "active" ? null : <StatusBadge status={project.status} />}
    <time className="entity-row-meta" dateTime={project.updatedAt.toISOString()}>
      {formatUpdated(project.updatedAt)}
    </time>
  </Link>;
}

/** Recency in the terms people think in; the exact date is in the title. */
function formatUpdated(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 7) return `Edited ${days} days ago`;
  return `Edited ${date.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
}
