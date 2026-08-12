"use client";

import { ChevronDown, ChevronRight, FileText, Folder, Home, Search } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { pageTreeAction, type TreeActionState } from "@/app/actions/pages";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/form-controls";
import { Menu } from "@/components/ui/menu";
import { SubmitButton } from "@/components/ui/submit-button";
import type { PageNode } from "@/server/db/schema";
import { buildPageTree, type PageTreeNode } from "@/domain/pages/tree";

const initial: TreeActionState = {};

function ActionForm({ projectId, values, label, variant = "ghost" }: { projectId: string; values: Record<string, string>; label: string; variant?: "ghost" | "danger" }) {
  const [state, action] = useActionState(pageTreeAction, initial);
  return <form action={action}>{Object.entries({ projectId, ...values }).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}<Button type="submit" variant={variant}>{label}</Button>{state.error ? <span className="menu-error">{state.error}</span> : null}</form>;
}

function CreateNodeDialog({ projectId, nodes, defaultParentId }: { projectId: string; nodes: PageNode[]; defaultParentId?: string }) {
  const [state, action] = useActionState(pageTreeAction, initial);
  return <Dialog title="New page or folder" description="Pages have website URLs. Folders only organize your structure." triggerLabel="New">
    <form action={action} className="stack"><input type="hidden" name="intent" value="create" /><input type="hidden" name="projectId" value={projectId} />
      <label className="field"><span className="field-label">Type</span><select className="input" name="type"><option value="page">Page</option><option value="folder">Folder</option></select></label>
      <Input name="name" label="Name" placeholder="About us" required maxLength={120} />
      <Input name="slug" label="Custom URL slug (optional)" placeholder="Generated from the page name" maxLength={100} hint="Folders ignore this field." />
      <label className="field"><span className="field-label">Parent</span><select className="input" name="parentId" defaultValue={defaultParentId ?? ""}><option value="">Top level</option>{nodes.map((node) => <option key={node.id} value={node.id}>{node.name} ({node.type})</option>)}</select></label>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}<SubmitButton pendingLabel="Creating…">Create</SubmitButton>
    </form>
  </Dialog>;
}

function EditNodeDialog({ projectId, node, nodes }: { projectId: string; node: PageNode; nodes: PageNode[] }) {
  const [state, action] = useActionState(pageTreeAction, initial);
  const descendants = new Set<string>();
  let changed = true;
  descendants.add(node.id);
  while (changed) { changed = false; for (const item of nodes) if (item.parentId && descendants.has(item.parentId) && !descendants.has(item.id)) { descendants.add(item.id); changed = true; } }
  return <Dialog title={node.type === "page" ? "Page settings" : "Folder settings"} triggerLabel="Settings">
    <form action={action} className="stack"><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="nodeId" value={node.id} />
      <input type="hidden" name="intent" value="rename" /><Input name="name" label="Name" defaultValue={node.name} required maxLength={120} />
      {state.error ? <p className="form-error">{state.error}</p> : null}<SubmitButton>Rename</SubmitButton>
    </form>
    {node.type === "page" ? <><div className="dialog-divider" /><form action={action} className="stack"><input type="hidden" name="intent" value="slug" /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="nodeId" value={node.id} /><Input name="slug" label="URL slug" defaultValue={node.slug ?? ""} required maxLength={100} hint={`Current path: ${node.routePath}`} /><SubmitButton>Update URL</SubmitButton></form>
      <div className="dialog-divider" /><form action={action} className="stack"><input type="hidden" name="intent" value="seo" /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="nodeId" value={node.id} /><Input name="pageTitle" label="Page title" defaultValue={node.pageTitle ?? ""} maxLength={100} hint="Around 50–60 characters is often effective." /><Textarea name="metaDescription" label="Meta description" defaultValue={node.metaDescription ?? ""} maxLength={300} rows={3} /><SubmitButton>Save SEO</SubmitButton></form></> : null}
    <div className="dialog-divider" /><form action={action} className="stack"><input type="hidden" name="intent" value="move" /><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="nodeId" value={node.id} /><input type="hidden" name="newPosition" value="0" /><label className="field"><span className="field-label">Move inside</span><select className="input" name="newParentId" defaultValue={node.parentId ?? ""}><option value="">Top level</option>{nodes.filter((item) => !descendants.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.type})</option>)}</select></label><SubmitButton>Move</SubmitButton></form>
  </Dialog>;
}

function TreeItem({ projectId, node, nodes, depth }: { projectId: string; node: PageTreeNode; nodes: PageNode[]; depth: number }) {
  const [expanded, setExpanded] = useState(true);
  return <li className="tree-item"><div className="tree-row" style={{ paddingLeft: `${12 + depth * 22}px` }}>
    <button className="tree-chevron" type="button" aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`} onClick={() => setExpanded((value) => !value)} disabled={!node.children.length}>{node.children.length ? expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} /> : null}</button>
    <span className="tree-type-icon">{node.isHomepage ? <Home size={17} /> : node.type === "folder" ? <Folder size={17} /> : <FileText size={17} />}</span>
    <span className="tree-label"><strong>{node.name}</strong><small>{node.type === "page" ? node.routePath : `${node.children.length} item${node.children.length === 1 ? "" : "s"}`}</small></span>
    <Menu label={`Actions for ${node.name}`}><EditNodeDialog projectId={projectId} node={node} nodes={nodes} />{node.type === "folder" ? <CreateNodeDialog projectId={projectId} nodes={nodes} defaultParentId={node.id} /> : null}{node.type === "page" && !node.isHomepage ? <ActionForm projectId={projectId} values={{ intent: "homepage", nodeId: node.id }} label="Set as homepage" /> : null}{node.type === "page" ? <ActionForm projectId={projectId} values={{ intent: "duplicate", nodeId: node.id }} label="Duplicate" /> : null}<ActionForm projectId={projectId} values={{ intent: "reorder", nodeId: node.id, direction: "up" }} label="Move up" /><ActionForm projectId={projectId} values={{ intent: "reorder", nodeId: node.id, direction: "down" }} label="Move down" /><ConfirmationDialog title={`Delete “${node.name}”?`} triggerLabel="Delete" description={node.children.length ? `This will also delete ${node.children.length} or more nested items.` : "This item will be removed from the project structure."} action={<ActionForm projectId={projectId} values={{ intent: "delete", nodeId: node.id }} label="Delete" variant="danger" />} /></Menu>
  </div>{expanded && node.children.length ? <ul>{node.children.map((child) => <TreeItem key={child.id} projectId={projectId} node={child} nodes={nodes} depth={depth + 1} />)}</ul> : null}</li>;
}

export function PageTreeManager({ projectId, nodes }: { projectId: string; nodes: PageNode[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return nodes;
    const matches = new Set(nodes.filter((node) => node.name.toLowerCase().includes(needle) || node.slug?.includes(needle)).map((node) => node.id));
    for (const match of [...matches]) { let parent = nodes.find((node) => node.id === match)?.parentId; while (parent) { matches.add(parent); parent = nodes.find((node) => node.id === parent)?.parentId ?? null; } }
    return nodes.filter((node) => matches.has(node.id));
  }, [nodes, query]);
  const tree = buildPageTree(filtered);
  return <div className="page-tree-manager"><div className="tree-toolbar"><label className="tree-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pages and folders" aria-label="Search pages and folders" /></label><CreateNodeDialog projectId={projectId} nodes={nodes} /></div>
    {tree.length ? <ul className="page-tree">{tree.map((node) => <TreeItem key={node.id} projectId={projectId} node={node} nodes={nodes} depth={0} />)}</ul> : <div className="tree-empty"><FileText size={22} /><h2>{query ? "No matching pages" : "No pages yet"}</h2><p>{query ? "Try a different name or URL." : "Create your homepage or add a folder to organize your website."}</p>{!query ? <CreateNodeDialog projectId={projectId} nodes={nodes} /> : null}</div>}
  </div>;
}
