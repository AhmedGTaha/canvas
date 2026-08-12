"use client";

import Image from "next/image";
import { ChevronDown, ChevronUp, Folder, FolderOpen, ImageIcon, LoaderCircle, Plus, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mediaAction } from "@/app/actions/media";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form-controls";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";

type UploadStatus = { name: string; state: "uploading" | "done" | "error"; error?: string };
type ListedMediaAsset = MediaAsset & { uploadedByName?: string };

export function MediaManager({ projectId, initialFolders, initialAssets }: { projectId: string; initialFolders: MediaFolder[]; initialAssets: ListedMediaAsset[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [notice, setNotice] = useState<string>();
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const selected = initialAssets.find((asset) => asset.id === selectedId);
  const currentFolder = initialFolders.find((folder) => folder.id === folderId);
  const breadcrumbs = useMemo(() => { const rows: MediaFolder[] = []; let next = currentFolder; while (next) { rows.unshift(next); next = initialFolders.find((folder) => folder.id === next?.parentId); } return rows; }, [currentFolder, initialFolders]);
  const visibleAssets = useMemo(() => initialAssets.filter((asset) => (search ? `${asset.displayName} ${asset.originalFilename} ${asset.altText ?? ""}`.toLowerCase().includes(search.toLowerCase()) : asset.folderId === folderId)), [folderId, initialAssets, search]);
  const folderRows = useMemo(() => {
    const rows: Array<{ folder: MediaFolder; depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => initialFolders.filter((item) => item.parentId === parentId).forEach((folder) => { rows.push({ folder, depth }); walk(folder.id, depth + 1); });
    walk(null, 0); return rows;
  }, [initialFolders]);

  async function act(input: Parameters<typeof mediaAction>[0]) {
    setNotice(undefined);
    const result = await mediaAction(input);
    setNotice(result.ok ? result.message : result.error);
    if (result.ok) router.refresh();
    return result.ok;
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    setUploads(list.map((file) => ({ name: file.name, state: "uploading" })));
    await Promise.all(list.map(async (file, index) => {
      const data = new FormData(); data.set("file", file); if (folderId) data.set("folderId", folderId);
      try {
        const response = await fetch(`/api/projects/${projectId}/media`, { method: "POST", body: data });
        const result = await response.json() as { error?: string };
        setUploads((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, state: response.ok ? "done" : "error", error: result.error } : item));
      } catch { setUploads((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, state: "error", error: "Network error." } : item)); }
    }));
    router.refresh();
    if (fileRef.current) fileRef.current.value = "";
  }

  return <div className="media-layout">
    <aside className="media-folders card">
      <div className="media-section-title"><h2>Folders</h2><button type="button" onClick={() => setFolderId(null)} className={!folderId ? "active" : ""}>All root media</button></div>
      <div className="media-folder-list">{folderRows.map(({ folder: item, depth }) => <div className="media-folder-row" style={{ paddingLeft: depth * 14 }} key={item.id}>
        <button type="button" className={folderId === item.id ? "active" : ""} onClick={() => { setFolderId(item.id); setSearch(""); }}><Folder size={15} />{item.name}</button>
        <button type="button" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete ${item.name} and all media inside it?`)) void act({ projectId, intent: "delete-folder", folderId: item.id }); }}><Trash2 size={13} /></button>
      </div>)}</div>
      {currentFolder ? <FolderDetails key={currentFolder.id} projectId={projectId} folder={currentFolder} folders={initialFolders} act={act} /> : null}
      <form className="media-new-folder" onSubmit={(event) => { event.preventDefault(); void act({ projectId, intent: "create-folder", parentId: folderId, name: newFolder }).then((ok) => { if (ok) setNewFolder(""); }); }}><input className="input" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} placeholder={folderId ? "New subfolder" : "New folder"} maxLength={120} /><Button type="submit" variant="secondary" aria-label="Create folder" disabled={!newFolder.trim()}><Plus size={15} /></Button></form>
    </aside>
    <section className="media-library card">
      <nav className="media-breadcrumbs" aria-label="Media folder path"><button type="button" onClick={() => setFolderId(null)}>Media</button>{breadcrumbs.map((folder) => <span key={folder.id}>/ <button type="button" onClick={() => setFolderId(folder.id)}>{folder.name}</button></span>)}</nav><div className="media-toolbar"><div><p className="eyebrow">{currentFolder ? "Folder" : "Library"}</p><h2>{currentFolder?.name ?? "Root media"}</h2></div><div className="media-toolbar-actions"><label className="tree-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all media" aria-label="Search media" /></label><input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void upload(event.target.files)} /><Button type="button" onClick={() => fileRef.current?.click()}><Upload size={15} />Upload images</Button></div></div>
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      {uploads.length ? <div className="upload-list">{uploads.map((item, index) => <span key={`${item.name}-${index}`} className={item.state === "error" ? "upload-error" : ""}>{item.state === "uploading" ? <LoaderCircle className="spin" size={13} /> : null}{item.name}: {item.state}{item.error ? ` — ${item.error}` : ""}</span>)}</div> : null}
      {visibleAssets.length ? <div className="media-grid">{visibleAssets.map((asset) => <button type="button" className={`media-tile ${selectedId === asset.id ? "active" : ""}`} key={asset.id} onClick={() => setSelectedId(asset.id)}><span className="media-thumbnail"><Image src={`/api/media/${asset.id}`} alt={asset.altText || ""} fill unoptimized sizes="180px" /></span><strong>{asset.displayName}</strong><small>{asset.width} × {asset.height} · {(asset.sizeBytes / 1024).toFixed(0)} KB</small></button>)}</div> : <div className="tree-empty"><ImageIcon size={32} /><h3>No images here</h3><p>{search ? "No media matches this search." : "Upload PNG, JPEG, or WebP images, or create a folder to organize them."}</p></div>}
    </section>
    <aside className="media-details card">{selected ? <AssetDetails projectId={projectId} asset={selected} folders={initialFolders} act={act} onDeleted={() => setSelectedId(null)} /> : <div className="media-detail-empty"><FolderOpen size={25} /><h2>Media details</h2><p>Select an image to edit its name, alt text, or folder.</p></div>}</aside>
  </div>;
}

function FolderDetails({ projectId, folder, folders, act }: { projectId: string; folder: MediaFolder; folders: MediaFolder[]; act: (input: Parameters<typeof mediaAction>[0]) => Promise<boolean> }) {
  const [name, setName] = useState(folder.name);
  const descendants = new Set<string>([folder.id]);
  let changed = true;
  while (changed) { changed = false; for (const item of folders) if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; } }
  return <div className="folder-details"><Input label="Selected folder name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /><Button type="button" variant="secondary" onClick={() => void act({ projectId, intent: "rename-folder", folderId: folder.id, name })}>Rename</Button><div className="inline-actions"><Button type="button" variant="ghost" aria-label="Move folder up" onClick={() => void act({ projectId, intent: "reorder-folder", folderId: folder.id, direction: "up" })}><ChevronUp size={14} />Up</Button><Button type="button" variant="ghost" aria-label="Move folder down" onClick={() => void act({ projectId, intent: "reorder-folder", folderId: folder.id, direction: "down" })}><ChevronDown size={14} />Down</Button></div><label className="field"><span className="field-label">Move folder into</span><select className="input" value={folder.parentId ?? ""} onChange={(event) => void act({ projectId, intent: "move-folder", folderId: folder.id, parentId: event.target.value || null })}><option value="">Root</option>{folders.filter((item) => !descendants.has(item.id)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label></div>;
}

function AssetDetails({ projectId, asset, folders, act, onDeleted }: { projectId: string; asset: ListedMediaAsset; folders: MediaFolder[]; act: (input: Parameters<typeof mediaAction>[0]) => Promise<boolean>; onDeleted: () => void }) {
  const [displayName, setDisplayName] = useState(asset.displayName);
  const [altText, setAltText] = useState(asset.altText ?? "");
  return <div className="stack"><div><p className="eyebrow">Selected image</p><h2>Details</h2></div><div className="media-detail-preview"><Image src={`/api/media/${asset.id}`} alt={altText} fill unoptimized sizes="280px" /></div><Input label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={160} /><Textarea label="Alt text" value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={500} rows={3} hint="Describe the image for people using assistive technology." /><label className="field"><span className="field-label">Folder</span><select className="input" value={asset.folderId ?? ""} onChange={(event) => void act({ projectId, intent: "move-asset", assetId: asset.id, folderId: event.target.value || undefined })}><option value="">Root media</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label><dl className="media-metadata"><div><dt>File</dt><dd>{asset.originalFilename}</dd></div><div><dt>Type</dt><dd>{asset.mimeType}</dd></div><div><dt>Dimensions</dt><dd>{asset.width} × {asset.height}</dd></div><div><dt>Uploaded by</dt><dd>{asset.uploadedByName ?? "Unknown"}</dd></div><div><dt>Uploaded</dt><dd>{asset.createdAt.toLocaleDateString()}</dd></div></dl><Button type="button" onClick={() => void act({ projectId, intent: "update-asset", assetId: asset.id, displayName, altText })}>Save details</Button><Button type="button" variant="danger" onClick={() => { if (window.confirm("Delete this media item? Existing logo selections will be cleared.")) void act({ projectId, intent: "delete-asset", assetId: asset.id }).then((ok) => { if (ok) onDeleted(); }); }}><Trash2 size={15} />Delete media</Button></div>;
}
