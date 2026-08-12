import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Project } from "@/server/db/schema";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export function ProjectCard({ project }: { project: Project }) {
  return <Link href={`/projects/${project.id}`} className="card-link">
    <Card className="entity-card">
      <div className="entity-card-heading"><h2>{project.name}</h2><ArrowUpRight size={17} /></div>
      <p>{project.description || "No description yet."}</p>
      <div className="entity-card-meta"><StatusBadge status={project.status} /><time dateTime={project.updatedAt.toISOString()}>Updated {project.updatedAt.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</time></div>
    </Card>
  </Link>;
}
