"use client";

import { useState } from "react";
import { setBrandLogoAction } from "@/app/actions/media";
import { Card } from "@/components/ui/card";
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
  return <Card className="brand-logo-card"><div className="settings-title"><div><p className="eyebrow">Identity</p><h2>Logos</h2></div><PanelLink tool="media" className="link-button">Manage media</PanelLink></div>{message ? <p className="notice" role="status">{message}</p> : null}{assets.length ? <div className="logo-picker-grid"><MediaPicker label="Primary logo" value={primary || null} assets={assets} folders={folders} onSelect={(value) => void save("primary", value)} /><MediaPicker label="Alternate logo" value={alternate || null} assets={assets} folders={folders} onSelect={(value) => void save("alternate", value)} /></div> : <div className="inline-empty"><p>Upload an image to the media library before selecting project logos.</p><PanelLink tool="media" className="button button-primary">Open media library</PanelLink></div>}</Card>;
}
