import Link from "next/link";
import { ArrowUpRight, FolderKanban } from "lucide-react";
import type { Workspace } from "@/server/db/schema";
import { Card } from "@/components/ui/card";

export function WorkspaceCard({ workspace }: { workspace: Workspace }) {
  return <Link href={`/workspaces/${workspace.id}`} className="card-link">
    <Card className="entity-card">
      <div className="entity-card-heading"><span className="entity-icon"><FolderKanban size={18} /></span><ArrowUpRight size={17} /></div>
      <h2>{workspace.name}</h2>
      <p>Created {workspace.createdAt.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</p>
    </Card>
  </Link>;
}
