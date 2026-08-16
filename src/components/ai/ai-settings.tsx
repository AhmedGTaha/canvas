"use client";

import { useCallback, useState } from "react";
import { InlineAlert } from "@/components/ui/feedback";
import { TabPanel, Tabs } from "@/components/ui/segmented";
import type { ConnectionView } from "@/domain/ai/connections/connection-service";
import type { AccountModelSelection } from "@/domain/ai/connections/account-model-service";
import type { AIAnalyticsSummary } from "@/domain/ai/analytics/analytics-service";
import type { ProviderDescriptor } from "@/server/ai/provider-registry";
import { AIAnalytics } from "./ai-analytics";
import { ConnectionsManager } from "./connections-manager";
import { AccountModelPicker } from "./account-model-picker";
import { TestConsole } from "./test-console";

type Tab = "model" | "connections" | "analytics" | "test";

/**
 * AI settings for one person.
 *
 * These belong to the account, not to a website, because the credential spent on a
 * generation is the credential of whoever started it. One key, configured once, used on
 * every website this person works on — including websites owned by someone else, where
 * it is still their own credit being spent and never the owner's.
 *
 * The default view is the one thing most people came for — which model they use — and
 * everything more technical sits behind its own tab.
 */
export function AISettings({ providers, initialConnections, initialSelection, initialUsage, credentialStorageAvailable }: {
  providers: ProviderDescriptor[];
  initialConnections: ConnectionView[];
  initialSelection: AccountModelSelection;
  initialUsage: AIAnalyticsSummary | null;
  credentialStorageAvailable: boolean;
}) {
  const [tab, setTab] = useState<Tab>("model");
  const [connections, setConnections] = useState(initialConnections);
  const [selection, setSelection] = useState(initialSelection);

  const refreshSelection = useCallback(async () => {
    const response = await fetch("/api/account/ai-settings", { cache: "no-store" });
    if (response.ok) setSelection(await response.json() as AccountModelSelection);
  }, []);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "model", label: "Model" },
    { id: "connections", label: "Connections" },
    { id: "analytics", label: "Usage" },
    ...(selection.configured ? [{ id: "test" as const, label: "Test model" }] : []),
  ];

  return <div className="ai-settings">
    {!credentialStorageAvailable
      ? <InlineAlert tone="warning" title="Canvas cannot store AI credentials yet">
          Set <code>CANVAS_CREDENTIAL_KEY</code> on the server before connecting a provider. Until then, saved keys cannot be encrypted, so Canvas refuses to store them.
        </InlineAlert>
      : null}

    <Tabs label="AI settings sections" value={tab} options={tabs.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={setTab} />

    <TabPanel value={tab}>
      {tab === "model" ? <AccountModelPicker selection={selection} onSelection={setSelection} onOpenConnections={() => setTab("connections")} /> : null}
      {tab === "connections" ? <ConnectionsManager providers={providers} connections={connections} onConnections={(next) => { setConnections(next); void refreshSelection(); }} /> : null}
      {tab === "analytics" ? <AIAnalytics endpoint="/api/account/ai-usage" initial={initialUsage} /> : null}
      {tab === "test" && selection.configured ? <TestConsole selection={selection} /> : null}
    </TabPanel>
  </div>;
}
