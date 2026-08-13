"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Blocks, ChevronRight, ImageIcon, LoaderCircle, Palette, Plus, Settings2, Type, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { uploadMediaFiles, type UploadStatus } from "@/components/media/upload";
import { HistorySidebar, type HistorySection } from "@/components/history/history-sidebar";
import type { HistoryController } from "@/components/history/use-history-controller";
import type { MediaAsset, MediaFolder } from "@/server/db/schema";
import type { ProjectPreviewManifest } from "@/generated-runtime/manifest/schema";
import type { WorkspaceActivity } from "./workspace-layout";

export function ContextSidebar({ projectId, activity, mediaAssets, mediaFolders, blocks, website, history, historySection, onOpenPanel, onNewBlock, onHistorySection }: { projectId: string; activity: WorkspaceActivity; mediaAssets: MediaAsset[]; mediaFolders: MediaFolder[]; blocks: ProjectPreviewManifest["blocks"]; website: ReactNode; history: HistoryController; historySection: HistorySection; onOpenPanel: (name: string, query?: Record<string, string>) => void; onNewBlock: () => void; onHistorySection: (section: HistorySection) => void }) {
  if (activity === "website") return <>{website}</>;
  if (activity === "assets") return <AssetsSidebar projectId={projectId} mediaAssets={mediaAssets} mediaFolders={mediaFolders} onOpenPanel={onOpenPanel} />;
  // Each row opens Brand & design at the part it names. Both used to open it at
  // the top, which made the second row indistinguishable from the first.
  if (activity === "design") return <SidebarShell title="Design" footer="Shared across every page"><div className="ws-side-sections"><SidebarLink icon={<Palette size={17} />} title="Brand identity" text="Logo, company identity, and brand notes" onClick={() => onOpenPanel("brand", { section: "identity" })} /><SidebarLink icon={<Type size={17} />} title="Theme" text="Colours, type, spacing, and appearance" onClick={() => onOpenPanel("brand", { section: "theme" })} /></div></SidebarShell>;
  if (activity === "sections") { const values = Object.values(blocks); return <SidebarShell title="Reusable Sections" action={<button type="button" className="ws-side-action" onClick={onNewBlock}><Plus size={14} />New</button>} footer={`${values.length} reusable ${values.length === 1 ? "section" : "sections"}`}>
    {!values.length ? <SidebarEmpty icon={<Blocks size={20} />} title="No reusable sections" text="Create navigation bars, footers, and sections once, then reuse them." action="Create section" onAction={onNewBlock} /> : <div className="ws-side-list">{values.map((block) => <button type="button" key={block.id} onClick={() => onOpenPanel("blocks", { block: block.id })}><Blocks size={15} /><span><strong>{block.name}</strong><small>{block.isGlobal ? "Used across the website" : block.contentStatus === "generated" ? "Ready to use" : "Draft"}</small></span><ChevronRight size={14} /></button>)}</div>}
  </SidebarShell>; }
  // History owns its own shell: it carries undo/redo in the header and expands
  // its lists in place rather than handing off to a dialog.
  return <HistorySidebar controller={history} section={historySection} onSection={onHistorySection} />;
}

function SidebarShell({ title, action, footer, children }: { title: string; action?: ReactNode; footer: string; children: ReactNode }) { return <><div className="ws-pane-hd"><h2>{title}</h2>{action ? <div className="ws-pane-hd-acts">{action}</div> : null}</div><div className="ws-side-body">{children}</div><p className="wsx-foot">{footer}</p></>; }
function SidebarEmpty({ icon, title, text, action, onAction }: { icon: ReactNode; title: string; text: string; action: string; onAction: () => void }) { return <div className="ws-side-empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p><button type="button" className="button button-secondary button-sm" onClick={onAction}>{action}</button></div>; }
function SidebarLink({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) { return <button type="button" className="ws-side-link" onClick={onClick}>{icon}<span><strong>{title}</strong><small>{text}</small></span><ChevronRight size={14} /></button>; }

/**
 * Assets in the sidebar.
 *
 * Uploading is the one thing anyone does with media constantly, so it happens
 * here, with no popup: the panel is left for organising into folders and
 * editing alt text. Picking a thumbnail opens the panel on that image.
 */
function AssetsSidebar({ projectId, mediaAssets, mediaFolders, onOpenPanel }: { projectId: string; mediaAssets: MediaAsset[]; mediaFolders: MediaFolder[]; onOpenPanel: (name: string, query?: Record<string, string>) => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const busy = uploads.some((upload) => upload.state === "uploading");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await uploadMediaFiles(projectId, [...files], null, setUploads);
    router.refresh();
    if (fileRef.current) fileRef.current.value = "";
  }

  return <SidebarShell
    title="Assets"
    action={<><button type="button" className="ws-side-action" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <LoaderCircle className="spin" size={14} /> : <Upload size={14} />}Upload</button><button type="button" className="ws-side-action" onClick={() => onOpenPanel("media")}><Settings2 size={14} />Manage</button></>}
    footer={`${mediaAssets.length} images · ${mediaFolders.length} folders`}
  >
    <input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Upload images" onChange={(event) => void upload(event.target.files)} />
    {uploads.length ? <div className="upload-list" role="status">{uploads.map((item, index) => <span key={`${item.name}-${index}`} className={item.state === "error" ? "upload-error" : ""}>{item.state === "uploading" ? <LoaderCircle className="spin" size={13} /> : null}{item.name}: {item.state}{item.error ? ` — ${item.error}` : ""}</span>)}</div> : null}
    {!mediaAssets.length
      ? <SidebarEmpty icon={<ImageIcon size={20} />} title="No images yet" text="Upload images to use them in pages and reusable sections." action="Upload images" onAction={() => fileRef.current?.click()} />
      : <div className="ws-side-grid">{mediaAssets.slice(0, 24).map((asset) => <button type="button" key={asset.id} onClick={() => onOpenPanel("media", { asset: asset.id })} title={asset.displayName}><Image src={`/api/media/${asset.id}`} width={90} height={68} alt={asset.altText ?? ""} unoptimized /><span>{asset.displayName}</span></button>)}</div>}
  </SidebarShell>;
}
