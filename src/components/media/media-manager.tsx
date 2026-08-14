"use client";

import Image from "next/image";
import { ChevronDown, ChevronUp, Folder, FolderOpen, ImageIcon, LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mediaAction } from "@/app/actions/media";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/feedback";
import { EmptyState } from "@/components/ui/states";
import { Input, SearchField, Textarea } from "@/components/ui/form-controls";
import { uploadMediaFiles, type UploadStatus } from "./upload";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";

type ListedMediaAsset = MediaAsset & { uploadedByName?: string };

export function MediaManager({ projectId, initialFolders, initialAssets, initialAssetId }: { projectId: string; initialFolders: MediaFolder[]; initialAssets: ListedMediaAsset[]; initialAssetId?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // Picking a thumbnail in the Assets sidebar opens the panel on that image,
  // in the folder it lives in, rather than at the top of the library.
  const opened = initialAssetId ? initialAssets.find((asset) => asset.id === initialAssetId) : undefined;
  const [folderId, setFolderId] = useState<string | null>(opened?.folderId ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(opened?.id ?? null);
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
    await uploadMediaFiles(projectId, [...files], folderId, setUploads);
    router.refresh();
    if (fileRef.current) fileRef.current.value = "";
  }

  return <div className="media-layout">
    <aside className="media-folders" aria-label="Folders">
      <div className="media-section-title"><h2>Folders</h2></div>
      <button type="button" onClick={() => setFolderId(null)} className={`media-root-button ${!folderId ? "active" : ""}`}>All images</button>
      <div className="media-folder-list">{folderRows.map(({ folder: item, depth }) => <div className="media-folder-row" style={{ paddingLeft: depth * 14 }} key={item.id}>
        <button type="button" className={folderId === item.id ? "active" : ""} onClick={() => { setFolderId(item.id); setSearch(""); }}><Folder size={15} />{item.name}</button>
        <button type="button" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete ${item.name} and all media inside it?`)) void act({ projectId, intent: "delete-folder", folderId: item.id }); }}><Trash2 size={13} /></button>
      </div>)}</div>
      {currentFolder ? <FolderDetails key={currentFolder.id} projectId={projectId} folder={currentFolder} folders={initialFolders} act={act} /> : null}
      <form className="media-new-folder" onSubmit={(event) => { event.preventDefault(); void act({ projectId, intent: "create-folder", parentId: folderId, name: newFolder }).then((ok) => { if (ok) setNewFolder(""); }); }}><input className="input" value={newFolder} aria-label={folderId ? "New subfolder name" : "New folder name"} onChange={(event) => setNewFolder(event.target.value)} placeholder={folderId ? "New subfolder" : "New folder"} maxLength={120} /><Button type="submit" variant="secondary" aria-label="Create folder" disabled={!newFolder.trim()}><Plus size={15} /></Button></form>
    </aside>
    <section className="media-library">
      <div className="media-toolbar">
        <nav className="media-breadcrumbs" aria-label="Folder path">
          <button type="button" onClick={() => setFolderId(null)}>All images</button>
          {breadcrumbs.map((folder) => <span key={folder.id}>/ <button type="button" onClick={() => setFolderId(folder.id)}>{folder.name}</button></span>)}
        </nav>
        <div className="media-toolbar-actions">
          <SearchField label="Search images" value={search} onValueChange={setSearch} placeholder="Search all images" />
          <input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Upload images" onChange={(event) => void upload(event.target.files)} />
          <Button type="button" size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Upload images</Button>
        </div>
      </div>
      <div className="media-scroll">
        {notice ? <InlineAlert tone="info">{notice}</InlineAlert> : null}
        {uploads.length ? <div className="upload-list" role="status">{uploads.map((item, index) => <span key={`${item.name}-${index}`} className={item.state === "error" ? "upload-error" : ""}>{item.state === "uploading" ? <LoaderCircle className="spin" size={13} /> : null}{item.name}: {item.state}{item.error ? ` — ${item.error}` : ""}</span>)}</div> : null}
        {visibleAssets.length
          ? <div className="media-grid">{visibleAssets.map((asset) => <button type="button" className={`media-tile ${selectedId === asset.id ? "active" : ""}`} key={asset.id} onClick={() => setSelectedId(asset.id)} aria-pressed={selectedId === asset.id}><span className="media-thumbnail"><Image src={`/api/media/${asset.id}`} alt={asset.altText || ""} fill unoptimized sizes="180px" /></span><strong>{asset.displayName}</strong><small>{asset.width} × {asset.height} · {(asset.sizeBytes / 1024).toFixed(0)} KB</small></button>)}</div>
          : <EmptyState
              icon={<ImageIcon size={19} />}
              title={search ? "No images match that search" : currentFolder ? `${currentFolder.name} is empty` : "No images yet"}
              description={search ? "Try a different word, or clear the search to see everything." : "Upload PNG, JPEG or WebP images to use them in pages and reusable sections."}
              action={search ? <Button variant="secondary" size="sm" onClick={() => setSearch("")}>Clear search</Button> : <Button size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Upload images</Button>}
            />}
      </div>
    </section>
    <aside className="media-details" aria-label="Image details">
      {selected
        ? <AssetDetails projectId={projectId} asset={selected} folders={initialFolders} act={act} onDeleted={() => setSelectedId(null)} />
        : <EmptyState size="compact" icon={<FolderOpen size={19} />} title="Nothing selected" description="Choose an image to edit its name, alt text or folder." />}
    </aside>
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
  return <div className="stack gap-8"><div className="media-detail-preview"><Image src={`/api/media/${asset.id}`} alt={altText} fill unoptimized sizes="280px" /></div><Input label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={160} /><Textarea label="Alt text" value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={500} rows={3} hint="Describe the image for people using assistive technology." /><label className="field"><span className="field-label">Folder</span><select className="input" value={asset.folderId ?? ""} onChange={(event) => void act({ projectId, intent: "move-asset", assetId: asset.id, folderId: event.target.value || undefined })}><option value="">Root media</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label><dl className="media-metadata"><div><dt>File</dt><dd>{asset.originalFilename}</dd></div><div><dt>Type</dt><dd>{asset.mimeType}</dd></div><div><dt>Dimensions</dt><dd>{asset.width} × {asset.height}</dd></div><div><dt>Uploaded by</dt><dd>{asset.uploadedByName ?? "Unknown"}</dd></div><div><dt>Uploaded</dt><dd>{asset.createdAt.toLocaleDateString()}</dd></div></dl><Button type="button" onClick={() => void act({ projectId, intent: "update-asset", assetId: asset.id, displayName, altText })}>Save details</Button><Button type="button" variant="danger" onClick={() => { if (window.confirm("Delete this media item? Existing logo selections will be cleared.")) void act({ projectId, intent: "delete-asset", assetId: asset.id }).then((ok) => { if (ok) onDeleted(); }); }}><Trash2 size={15} />Delete media</Button></div>;
}
