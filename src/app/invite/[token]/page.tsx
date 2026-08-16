import { UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInviteForm } from "@/components/collaboration/accept-invite-form";
import { CanvasLogo } from "@/components/brand/canvas-logo";
import { buttonClass } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { getCurrentUser } from "@/server/auth/session";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?returnTo=${encodeURIComponent(`/invite/${token}`)}`);

  let invite;
  try { invite = await new InvitationService().preview(token); }
  catch { return <main className="invite-layout"><p className="standalone-brand"><CanvasLogo /></p><ErrorState title="Invitation unavailable" description="This invitation is invalid, expired, or has been revoked." retry={<Link href="/dashboard" className={buttonClass()}>Back to Canvas</Link>} /></main>; }

  const role = await new ProjectAccessService().getProjectRole(user.id, invite.projectId);
  // An invitation is often someone's first sight of Canvas, so it says whose
  // product this is with the same mark the rest of the app uses.
  return <main className="invite-layout"><p className="standalone-brand"><CanvasLogo /></p><section className="invite-card"><span className="invite-icon"><UserPlus size={22} /></span><h1>You have been invited to work on</h1><h2>{invite.projectName}</h2><p>Joining lets you edit this website with the people who invited you. It does not give you access to anything else of theirs.</p><p className="invite-expiry">Invitation expires {invite.expiresAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</p><AcceptInviteForm token={token} alreadyHasAccess={role !== null} /></section></main>;
}
