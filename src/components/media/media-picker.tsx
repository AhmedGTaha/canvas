"use client";

import Image from "next/image";
import { Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";

export function MediaPicker({ label, assets, folders, value, onSelect }: { label: string; assets: MediaAsset[]; folders: MediaFolder[]; value: string | null; onSelect: (assetId: string | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState(""); const [folderId, setFolderId] = useState<string | null>(null); const [draft, setDraft] = useState(value);
  const selected = assets.find((asset) => asset.id === value);
  const visible = useMemo(() => assets.filter((asset) => search ? `${asset.displayName} ${asset.originalFilename} ${asset.altText ?? ""}`.toLowerCase().includes(search.toLowerCase()) : asset.folderId === folderId), [assets, folderId, search]);
  function open() { setDraft(value); setSearch(""); setFolderId(null); dialog.current?.showModal(); }
  return <div className="logo-select"><span className="field-label">{label}</span><span className="logo-preview">{selected ? <Image src={`/api/media/${selected.id}`} alt={selected.altText || ""} fill unoptimized sizes="240px" /> : <span>No image selected</span>}</span><div className="inline-actions"><Button type="button" variant="secondary" onClick={open}>{selected ? "Change" : "Select from Media"}</Button>{selected ? <Button type="button" variant="ghost" onClick={() => onSelect(null)}>Remove</Button> : null}</div><dialog className="dialog media-picker-dialog" ref={dialog}><div className="dialog-panel"><div className="dialog-header"><div><p className="eyebrow">Media</p><h2>Select an image</h2></div><Button type="button" variant="ghost" aria-label="Cancel media selection" onClick={() => dialog.current?.close()}><X size={18} /></Button></div><div className="media-picker-filters"><label className="tree-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search images" aria-label="Search images" /></label><select className="input" value={folderId ?? ""} onChange={(event) => { setFolderId(event.target.value || null); setSearch(""); }} aria-label="Media folder"><option value="">Root media</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></div><div className="media-picker-grid">{visible.map((asset) => <button type="button" key={asset.id} className={draft === asset.id ? "active" : ""} onClick={() => setDraft(asset.id)} aria-label={`Select ${asset.displayName}`}><span><Image src={`/api/media/${asset.id}`} alt="" fill unoptimized sizes="140px" /></span><strong>{asset.displayName}</strong></button>)}</div>{!visible.length ? <p className="inline-empty">No images found here.</p> : null}<div className="form-actions"><Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Cancel</Button><Button type="button" disabled={!draft} onClick={() => { onSelect(draft); dialog.current?.close(); }}>Select image</Button></div></div></dialog></div>;
}
