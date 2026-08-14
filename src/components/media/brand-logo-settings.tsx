"use client";

import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { setBrandLogoAction } from "@/app/actions/media";
import { InlineAlert } from "@/components/ui/feedback";
import { Section } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { PanelLink } from "@/components/workspace/panel-link";
import { MediaPicker } from "./media-picker";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";

export function BrandLogoSettings({ projectId, assets, folders, initialPrimaryId, initialAlternateId }: { projectId: string; assets: MediaAsset[]; folders: MediaFolder[]; initialPrimaryId: string | null; initialAlternateId: string | null }) {
  const [primary, setPrimary] = useState(initialPrimaryId ?? "");
  const [alternate, setAlternate] = useState(initialAlternateId ?? "");
  const [message, setMessage] = useState<string>();

  async function save(kind: "primary" | "alternate", assetId: string | null) {
    const previous = kind === "primary" ? primary : alternate;
    if (kind === "primary") setPrimary(assetId ?? ""); else setAlternate(assetId ?? "");
    const result = await setBrandLogoAction({ projectId, kind, assetId });
    if (!result.ok) { if (kind === "primary") setPrimary(previous); else setAlternate(previous); }
    setMessage(result.ok ? result.message : result.error);
  }

  return <Section
    title="Logos"
    description="Shown in the header and footer of every page."
    actions={<PanelLink tool="media" className="button button-secondary button-sm">Manage images</PanelLink>}
  >
    {message ? <InlineAlert tone="info">{message}</InlineAlert> : null}
    {assets.length
      ? <div className="logo-picker-grid">
          <MediaPicker label="Primary logo" value={primary || null} assets={assets} folders={folders} onSelect={(value) => void save("primary", value)} />
          <MediaPicker label="Alternate logo" value={alternate || null} assets={assets} folders={folders} onSelect={(value) => void save("alternate", value)} />
        </div>
      : <EmptyState
          size="inline"
          icon={<ImageIcon size={19} />}
          title="No images to choose from"
          description="Upload an image first, then pick it as this website's logo."
          action={<PanelLink tool="media" className="button button-primary button-sm">Upload an image</PanelLink>}
        />}
  </Section>;
}
