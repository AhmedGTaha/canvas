import { AISettings } from "@/components/ai/ai-settings";
import { PageHeader } from "@/components/ui/page-header";
import { AIAnalyticsService } from "@/domain/ai/analytics/analytics-service";
import { AccountModelService } from "@/domain/ai/connections/account-model-service";
import { AIConnectionService } from "@/domain/ai/connections/connection-service";
import { PROVIDER_KINDS, providerDescriptor } from "@/server/ai/provider-registry";
import { credentialEncryptionAvailable } from "@/server/security/credential-cipher";
import { requireAuthenticatedUser } from "@/server/auth/session";

export const metadata = { title: "AI settings" };

/**
 * Your AI provider, model, and what you have spent.
 *
 * Everything on this page is scoped to the signed-in account and nothing else can be
 * reached from it. The credentials shown are only ever masked; the stored key is never
 * sent to a browser after it is saved.
 */
export default async function AccountAISettingsPage() {
  const user = await requireAuthenticatedUser();
  const [connections, selection, usage] = await Promise.all([
    new AIConnectionService().list(user.id),
    new AccountModelService().read(user.id),
    new AIAnalyticsService().accountSummary(user.id, "7d").catch(() => null),
  ]);

  return <>
    <PageHeader
      title="AI settings"
      description="The provider and model your requests use, wherever you use Canvas. Your key pays for your work — never a collaborator's, and never theirs for yours."
    />
    <AISettings
      providers={PROVIDER_KINDS.map((kind) => providerDescriptor(kind))}
      initialConnections={connections}
      initialSelection={selection}
      initialUsage={usage}
      credentialStorageAvailable={credentialEncryptionAvailable()}
    />
  </>;
}
