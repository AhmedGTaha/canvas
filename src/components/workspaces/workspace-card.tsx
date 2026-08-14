import Link from "next/link";
import { FolderKanban } from "lucide-react";
import type { Workspace } from "@/server/db/schema";

export function WorkspaceCard({ workspace, projectCount }: { workspace: Workspace; projectCount?: number }) {
  return <Link href={`/workspaces/${workspace.id}`} className="entity-row">
    <span className="entity-row-icon" aria-hidden="true"><FolderKanban size={16} /></span>
    <span className="entity-row-main">
      <strong>{workspace.name}</strong>
      <small>{projectCount === undefined ? "Workspace" : projectCount === 1 ? "1 website" : `${projectCount} websites`}</small>
    </span>
    <time className="entity-row-meta" dateTime={workspace.createdAt.toISOString()}>
      Created {workspace.createdAt.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
    </time>
  </Link>;
}
