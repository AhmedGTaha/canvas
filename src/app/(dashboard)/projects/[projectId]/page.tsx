import { CalendarDays, UserRound, UsersRound, WandSparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RenameProjectDialog } from "@/components/projects/project-forms";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/button";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";
import { ProjectNav } from "@/components/projects/project-nav";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  let role: "owner" | "collaborator";
  let ownerName: string;
  try {
    const access = await new ProjectService().readWithRole(user.id, projectId);
    project = access.project;
    role = access.role;
    ownerName = access.owner.displayName;
  } catch { notFound(); }
  return <><PageHeader eyebrow="Project overview" title={project.name} description={project.description || "Add a description as this project takes shape."} actions={<><Link href={`/projects/${project.id}/pages`} className={buttonClass("secondary")}>Pages</Link><Link href={`/projects/${project.id}/collaborators`} className={buttonClass("secondary")}><UsersRound size={16} />Collaborators</Link>{role === "owner" ? <RenameProjectDialog id={project.id} name={project.name} /> : null}</>} /><ProjectNav projectId={project.id} />
    <div className="project-layout"><Card><div className="section-heading"><div><p className="eyebrow">Overview</p><h2>Project details</h2></div><StatusBadge status={project.status} /></div><dl className="detail-list"><div><dt><UserRound size={16} />Owner</dt><dd>{ownerName}</dd></div><div><dt><CalendarDays size={16} />Created</dt><dd>{project.createdAt.toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" })}</dd></div></dl></Card>
    <Card className="builder-placeholder"><span className="state-icon"><WandSparkles size={22} /></span><div><p className="eyebrow">Builder</p><h2>Your builder workspace is next</h2><p>Page structure, preview, and AI-assisted building will arrive in later implementation phases. This project is ready for that foundation.</p></div></Card></div>
  </>;
}
