import { AppearanceControl } from "@/components/appearance/appearance-control";
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

    {/* The same control as the account menu, given room to say what it does.
        Appearance is a property of Canvas, not of any one website: a project's
        own light and dark design is set in that project's Design tool. */}
    <div className="form-section">
      <div className="form-section-head">
        <h3>Appearance</h3>
        <p>How Canvas itself looks on this device. Websites you build keep their own light and dark design.</p>
      </div>
      <AppearanceControl />
    </div>
  </>;
}
