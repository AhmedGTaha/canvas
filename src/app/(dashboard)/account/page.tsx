import { PageHeader } from "@/components/ui/page-header";
import { requireAuthenticatedUser } from "@/server/auth/session";

export default async function AccountPage() {
  const user = await requireAuthenticatedUser();
  return <>
    <PageHeader title="Your account" description="The identity used across your Canvas workspaces." />
    <dl className="detail-list">
      <div><dt>Name</dt><dd>{user.displayName}</dd></div>
      <div><dt>Email</dt><dd>{user.email}</dd></div>
    </dl>
  </>;
}
