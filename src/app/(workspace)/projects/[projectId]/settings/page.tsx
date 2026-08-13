import { notFound } from "next/navigation";
import { ProjectInstructionsEditor } from "@/components/projects/project-instructions-editor";
import { ProjectNav } from "@/components/projects/project-nav";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectInstructionService } from "@/domain/ai/instruction-service";
import { ProjectService } from "@/domain/projects/service";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project; let instructions;
  try { [project, instructions] = await Promise.all([new ProjectService().read(user.id, projectId), new ProjectInstructionService().read(user.id, projectId)]); }
  catch { notFound(); }
  return <><PageHeader eyebrow={project.name} title="Project Settings" description="Set persistent guidance for how Canvas should work with this website." /><ProjectNav projectId={project.id} /><div className="settings-page-stack"><ProjectInstructionsEditor projectId={project.id} initialContent={instructions.content} initialRevision={instructions.revisionNumber} /></div></>;
}

