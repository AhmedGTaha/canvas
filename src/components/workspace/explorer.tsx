"use client";

import { ChevronDown, ChevronRight, Copy, CornerUpLeft, FilePlus2, FileText, FolderClosed, FolderOpen, FolderPlus, House, Pencil, Search, Settings2, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { pageTreeAction } from "@/app/actions/pages";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { buildPageTree, type PageTreeNode } from "@/domain/pages/tree";
import type { PageNode } from "@/server/db/schema";

/**
 * Website explorer.
 *
 * A file-explorer for pages and folders. Two deliberate departures from the
 * previous tree:
 *
 *  - Clicking a folder opens or closes it, and does nothing else. It never
 *    changes what the agent is talking to; that is an explicit menu action.
 *  - Renaming and creating happen inline in the row, so the common operations
 *    never open a dialog.
 */
export type ExplorerProps = {
  projectId: string;
  nodes: PageNode[];
  currentPageId: string | null;
  /** Pages that exist in the preview manifest, mapped to their route. */
  routes: Record<string, string>;
  onSelectPage: (pageId: string, route: string | undefined) => void;
  /** Opens the page and reveals the agent panel, focused on it. */
  onEditWithAgent: (pageId: string, route: string | undefined) => void;
  onOpenPagesPanel: (nodeId?: string) => void;
  /** Reports a committed tree change; the id is set when a node was created. */
  onTreeChanged: (createdNodeId?: string) => void;
  createRequest?: { type: "page" | "folder"; key: number } | null;
};

type Draft = { parentId: string | null; type: "page" | "folder" };

export function Explorer({ projectId, nodes, currentPageId, routes, onSelectPage, onEditWithAgent, onOpenPagesPanel, onTreeChanged, createRequest }: ExplorerProps) {
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string>();

  const run = useCallback((values: Record<string, string>) => {
    const data = new FormData();
    data.set("projectId", projectId);
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    setError(undefined);
    startTransition(async () => {
      const result = await pageTreeAction({}, data);
      // The workspace owns the refresh: the tree alone is not enough, the
      // preview session has to be re-minted before a new page can be opened.
      if (result.error) setError(result.error);
      else onTreeChanged(result.createdNodeId);
    });
  }, [onTreeChanged, projectId]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const hits = new Set(nodes.filter((node) => node.name.toLowerCase().includes(needle) || (node.slug ?? "").toLowerCase().includes(needle) || (node.routePath ?? "").toLowerCase().includes(needle)).map((node) => node.id));
    // Keep ancestors so a nested hit stays reachable in the hierarchy.
    for (const id of [...hits]) {
      let parent = nodes.find((node) => node.id === id)?.parentId;
      while (parent) { hits.add(parent); parent = nodes.find((node) => node.id === parent)?.parentId ?? null; }
    }
    return hits;
  }, [nodes, query]);

  const visible = matches ? nodes.filter((node) => matches.has(node.id)) : nodes;
  const tree = buildPageTree(visible);
  const pageCount = nodes.filter((node) => node.type === "page" && !node.deletedAt).length;
  const folderCount = nodes.filter((node) => node.type === "folder" && !node.deletedAt).length;

  function toggle(id: string) { setCollapsed((current) => ({ ...current, [id]: !current[id] })); }
  function startDraft(next: Draft) {
    setDraft(next);
    if (next.parentId) setCollapsed((current) => ({ ...current, [next.parentId as string]: false }));
  }
  useEffect(() => { if (!createRequest) return; const timer = window.setTimeout(() => startDraft({ parentId: null, type: createRequest.type }), 0); return () => clearTimeout(timer); }, [createRequest]);

  return <>
    <div className="ws-pane-hd">
      <h2>Website</h2>
      <div className="ws-pane-hd-acts">
        <button type="button" className="ws-icon-btn" title="New page" aria-label="New page" onClick={() => startDraft({ parentId: null, type: "page" })}><FilePlus2 size={14} /></button>
        <button type="button" className="ws-icon-btn" title="New folder" aria-label="New folder" onClick={() => startDraft({ parentId: null, type: "folder" })}><FolderPlus size={14} /></button>
      </div>
    </div>

    <label className="wsx-search">
      <Search size={12} aria-hidden="true" />
      <input value={query} placeholder="Search pages" aria-label="Search pages and folders" onChange={(event) => setQuery(event.target.value)} />
      {query ? <button type="button" className="ws-icon-btn" style={{ width: 18, height: 18 }} aria-label="Clear search" onClick={() => setQuery("")}><X size={12} /></button> : null}
    </label>

    {error ? <p className="wsa-error" style={{ margin: "0 8px 8px" }} role="alert">{error}</p> : null}

    {tree.length || draft ? <ul className="wsx-tree" role="tree" aria-label="Website pages">
      {tree.map((node) => <Row
        key={node.id}
        node={node}
        depth={0}
        projectId={projectId}
        currentPageId={currentPageId}
        routes={routes}
        collapsed={collapsed}
        searching={Boolean(matches)}
        renaming={renaming}
        draft={draft}
        pending={pending}
        onToggle={toggle}
        onSelectPage={onSelectPage}
        onEditWithAgent={onEditWithAgent}
        onOpenPagesPanel={onOpenPagesPanel}
        onRename={setRenaming}
        onDraft={startDraft}
        onCancelDraft={() => setDraft(null)}
        onRun={run}
      />)}
      {draft && draft.parentId === null ? <li><DraftRow depth={0} type={draft.type} onCancel={() => setDraft(null)} onCommit={(name) => { setDraft(null); run({ intent: "create", type: draft.type, name, parentId: "" }); }} /></li> : null}
    </ul> : <div className="wsx-empty">
      <p>{query ? "No pages match that search." : "This website has no pages yet."}</p>
      {query
        ? <button type="button" className="button button-secondary button-sm" onClick={() => setQuery("")}>Clear search</button>
        : <button type="button" className="button button-primary button-sm" onClick={() => startDraft({ parentId: null, type: "page" })}><FilePlus2 size={14} />Create your first page</button>}
    </div>}

    <p className="wsx-foot">{pageCount} {pageCount === 1 ? "page" : "pages"}{folderCount ? ` · ${folderCount} ${folderCount === 1 ? "folder" : "folders"}` : ""}</p>
  </>;
}

type RowProps = {
  node: PageTreeNode;
  depth: number;
  projectId: string;
  currentPageId: string | null;
  routes: Record<string, string>;
  collapsed: Record<string, boolean>;
  searching: boolean;
  renaming: string | null;
  draft: Draft | null;
  pending: boolean;
  onToggle: (id: string) => void;
  onSelectPage: ExplorerProps["onSelectPage"];
  onEditWithAgent: ExplorerProps["onEditWithAgent"];
  onOpenPagesPanel: (nodeId?: string) => void;
  onRename: (id: string | null) => void;
  onDraft: (draft: Draft) => void;
  onCancelDraft: () => void;
  onRun: (values: Record<string, string>) => void;
};

function Row(props: RowProps) {
  const { node, depth, currentPageId, routes, collapsed, searching, renaming, draft, pending, onToggle, onSelectPage, onEditWithAgent, onOpenPagesPanel, onRename, onDraft, onCancelDraft, onRun } = props;
  const isFolder = node.type === "folder";
  // A search keeps every branch open so hits are visible without clicking.
  const open = searching || !collapsed[node.id];
  const selected = !isFolder && node.id === currentPageId;
  const hasChildren = node.children.length > 0;
  const indent = 6 + depth * 13;

  return <li role="none">
    <div className={`wsx-row ${selected ? "wsx-row-selected" : ""}`} role="treeitem" aria-selected={selected} aria-expanded={isFolder ? open : undefined} style={{ paddingLeft: indent }}>
      {isFolder || hasChildren
        ? <button type="button" className="wsx-chevron" tabIndex={-1} aria-hidden="true" onClick={() => onToggle(node.id)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
        : <span className="wsx-chevron wsx-chevron-blank" />}

      {renaming === node.id
        ? <RenameField name={node.name} onCancel={() => onRename(null)} onCommit={(name) => { onRename(null); if (name !== node.name) onRun({ intent: "rename", nodeId: node.id, name }); }} />
        : <button
            type="button"
            className="wsx-open"
            title={node.type === "page" ? node.routePath ?? node.name : `${node.name} — folder`}
            // Folders open and close. Pages become the page being edited.
            onClick={() => (isFolder ? onToggle(node.id) : onSelectPage(node.id, routes[node.id]))}
            onDoubleClick={() => { if (!isFolder) onRename(node.id); }}
            onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); onRename(node.id); } }}
          >
            {isFolder
              ? (open ? <FolderOpen className="wsx-icon" size={13} /> : <FolderClosed className="wsx-icon" size={13} />)
              : node.isHomepage ? <House className="wsx-icon" size={13} /> : <FileText className="wsx-icon" size={13} />}
            <span className="wsx-name">{node.name}</span>
            {node.isHomepage ? <span className="sr-only">Home page</span> : null}
            {/* No version yet means the agent has not built this page. */}
            {!isFolder && !node.currentVersionId ? <span className="wsx-badge wsx-badge-draft">Draft</span> : null}
          </button>}

      <span className="wsx-row-actions">
        <Menu label={`Actions for ${node.name}`} align="end">
          <MenuItem icon={<Pencil size={14} />} shortcut="F2" onClick={() => onRename(node.id)}>Rename</MenuItem>
          {isFolder ? <>
            <MenuItem icon={<FilePlus2 size={14} />} onClick={() => onDraft({ parentId: node.id, type: "page" })}>New page inside</MenuItem>
            <MenuItem icon={<FolderPlus size={14} />} onClick={() => onDraft({ parentId: node.id, type: "folder" })}>New folder inside</MenuItem>
          </> : <>
            <MenuItem icon={<Copy size={14} />} disabled={pending} onClick={() => onRun({ intent: "duplicate", nodeId: node.id })}>Duplicate</MenuItem>
            {!node.isHomepage ? <MenuItem icon={<House size={14} />} disabled={pending} onClick={() => onRun({ intent: "homepage", nodeId: node.id })}>Set as home page</MenuItem> : null}
          </>}
          <MenuSeparator />
          <MenuItem icon={<CornerUpLeft size={14} />} disabled={pending} onClick={() => onRun({ intent: "reorder", nodeId: node.id, direction: "up" })}>Move up</MenuItem>
          <MenuItem icon={<CornerUpLeft size={14} style={{ transform: "scaleY(-1)" }} />} disabled={pending} onClick={() => onRun({ intent: "reorder", nodeId: node.id, direction: "down" })}>Move down</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Settings2 size={14} />} onClick={() => onOpenPagesPanel(node.id)}>{isFolder ? "Folder settings" : "Page settings"}</MenuItem>
          {!isFolder ? <MenuItem icon={<Sparkles size={14} />} onClick={() => onEditWithAgent(node.id, routes[node.id])}>Change this page with the agent</MenuItem> : null}
          <MenuSeparator />
          <DeleteItem node={node} pending={pending} onConfirm={() => onRun({ intent: "delete", nodeId: node.id })} />
        </Menu>
      </span>
    </div>

    {open && (hasChildren || (draft && draft.parentId === node.id)) ? <ul role="group">
      {node.children.map((child) => <Row key={child.id} {...props} node={child} depth={depth + 1} />)}
      {draft && draft.parentId === node.id ? <li><DraftRow depth={depth + 1} type={draft.type} onCancel={onCancelDraft} onCommit={(name) => { onCancelDraft(); onRun({ intent: "create", type: draft.type, name, parentId: node.id }); }} /></li> : null}
    </ul> : null}
  </li>;
}

/** Delete needs a confirmation, but a full dialog inside a popover is heavy —
 *  the menu item flips into an inline confirm instead. */
function DeleteItem({ node, pending, onConfirm }: { node: PageTreeNode; pending: boolean; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return <MenuItem icon={<Trash2 size={14} />} tone="danger" onClick={(event) => { event.stopPropagation(); setArmed(true); }}>Delete…</MenuItem>;
  }
  return <div className="menu-confirm" onClick={(event) => event.stopPropagation()}>
    <p>Delete <strong>{node.name}</strong>{node.children.length ? ` and everything inside it (${node.children.length}+ items)` : ""}? This cannot be undone.</p>
    <div className="inline gap-3">
      <button type="button" className="button button-danger button-sm" disabled={pending} onClick={onConfirm}>Delete</button>
      <button type="button" className="button button-secondary button-sm" onClick={() => setArmed(false)}>Keep it</button>
    </div>
  </div>;
}

function RenameField({ name, onCancel, onCommit }: { name: string; onCancel: () => void; onCommit: (value: string) => void }) {
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  return <input
    ref={input}
    className="wsx-rename"
    value={value}
    maxLength={120}
    aria-label={`Rename ${name}`}
    onChange={(event) => setValue(event.target.value)}
    onBlur={() => (value.trim() ? onCommit(value.trim()) : onCancel())}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); if (value.trim()) onCommit(value.trim()); else onCancel(); }
      else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
    }}
  />;
}

/** The "type the name in place" row used for creating pages and folders. */
function DraftRow({ depth, type, onCancel, onCommit }: { depth: number; type: "page" | "folder"; onCancel: () => void; onCommit: (name: string) => void }) {
  return <div className="wsx-row" style={{ paddingLeft: 6 + depth * 13 }}>
    <span className="wsx-chevron wsx-chevron-blank" />
    {type === "folder" ? <FolderClosed className="wsx-icon" size={13} /> : <FileText className="wsx-icon" size={13} />}
    <RenameField name={type === "folder" ? "New folder" : "New page"} onCancel={onCancel} onCommit={onCommit} />
  </div>;
}
