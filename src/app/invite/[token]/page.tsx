import { UserPlus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AcceptInviteForm } from "@/components/collaboration/accept-invite-form";
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
  catch { return <main className="invite-layout"><ErrorState title="Invitation unavailable" description="This invitation is invalid, expired, or has been revoked." retry={<Link href="/dashboard" className={buttonClass()}>Back to Canvas</Link>} /></main>; }

  const role = await new ProjectAccessService().getProjectRole(user.id, invite.projectId);
  return <main className="invite-layout"><section className="invite-card"><span className="invite-icon"><UserPlus size={22} /></span><p className="eyebrow">Project invitation</p><h1>You&apos;ve been invited to collaborate on</h1><h2>{invite.projectName}</h2><p>Join this project to work on it with the people who invited you. This does not grant access to their workspace or other projects.</p><p className="invite-expiry">Invitation expires {invite.expiresAt.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</p><AcceptInviteForm token={token} alreadyHasAccess={role !== null} /></section></main>;
}
