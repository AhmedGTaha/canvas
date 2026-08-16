"use client";

import { useCallback, useState } from "react";
import { InlineAlert } from "@/components/ui/feedback";
import { TabPanel, Tabs } from "@/components/ui/segmented";
import type { ConnectionView } from "@/domain/ai/connections/connection-service";
import type { ProjectModelSelection } from "@/domain/ai/connections/project-model-service";
import type { AIAnalyticsSummary } from "@/domain/ai/analytics/analytics-service";
import type { ProviderDescriptor } from "@/server/ai/provider-registry";
import { AIAnalytics } from "./ai-analytics";
import { ConnectionsManager } from "./connections-manager";
import { ProjectModelPicker } from "./project-model-picker";
import { TestConsole } from "./test-console";

type Tab = "model" | "connections" | "analytics" | "test";

/**
 * AI settings for one website.
 *
 * It opens as a workspace tool over the mounted workbench, so the Preview session, the
 * agent conversation, and the page being edited all survive a visit here. The default
 * view is the one thing most people came for — which model this website uses — and
 * everything more technical sits behind its own tab.
 */
export function AISettings({
  projectId, workspaceId, canManageConnections, providers, initialConnections, initialSelection, initialAnalytics, credentialStorageAvailable,
}: {
  projectId: string;
  workspaceId: string;
  canManageConnections: boolean;
  providers: ProviderDescriptor[];
  initialConnections: ConnectionView[];
  initialSelection: ProjectModelSelection;
  initialAnalytics: AIAnalyticsSummary | null;
  credentialStorageAvailable: boolean;
}) {
  const [tab, setTab] = useState<Tab>("model");
  const [connections, setConnections] = useState(initialConnections);
  const [selection, setSelection] = useState(initialSelection);

  const refreshSelection = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/ai-settings`, { cache: "no-store" });
    if (response.ok) setSelection(await response.json() as ProjectModelSelection);
  }, [projectId]);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "model", label: "Model" },
    ...(canManageConnections ? [{ id: "connections" as const, label: "Connections" }] : []),
    { id: "analytics", label: "Usage" },
    ...(selection.canSelect ? [{ id: "test" as const, label: "Test model" }] : []),
  ];

  return <div className="ai-settings">
    {!credentialStorageAvailable && canManageConnections
      ? <InlineAlert tone="warning" title="Canvas cannot store AI credentials yet">
          Set <code>CANVAS_CREDENTIAL_KEY</code> on the server before connecting a provider. Until then, saved keys cannot be encrypted, so Canvas refuses to store them.
        </InlineAlert>
      : null}

    <Tabs label="AI settings sections" value={tab} options={tabs.map((entry) => ({ value: entry.id, label: entry.label }))} onChange={setTab} />

    <TabPanel value={tab}>
      {tab === "model"
        ? <ProjectModelPicker projectId={projectId} selection={selection} onSelection={setSelection} canManageConnections={canManageConnections} onOpenConnections={() => setTab("connections")} />
        : null}
      {tab === "connections" && canManageConnections
        ? <ConnectionsManager workspaceId={workspaceId} providers={providers} connections={connections} onConnections={(next) => { setConnections(next); void refreshSelection(); }} />
        : null}
      {tab === "analytics" ? <AIAnalytics projectId={projectId} initial={initialAnalytics} /> : null}
      {tab === "test" && selection.canSelect ? <TestConsole projectId={projectId} selection={selection} /> : null}
    </TabPanel>
  </div>;
}
