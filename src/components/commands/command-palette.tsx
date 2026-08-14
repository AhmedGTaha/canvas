"use client";

import { ArrowRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchWorkspace } from "@/domain/commands/search";
import type { CommandPage, CommandResult, WorkspaceCommand } from "@/domain/commands/types";

type Recent = { key: string };
const MAX_RECENT = 8;

export function CommandPalette({ projectId, userId = "current", open, commands, pages, onClose, onPage }: { projectId: string; userId?: string; open: boolean; commands: WorkspaceCommand[]; pages: CommandPage[]; onClose: () => void; onPage: (page: CommandPage) => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null); const returnFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState(""); const [selected, setSelected] = useState(0); const [recent, setRecent] = useState<Recent[]>([]); const [hydrated, setHydrated] = useState(false);
  const storageKey = `canvas.recent.${userId}.${projectId}`;
  // Command availability can change as client-only history data loads. Render
  // controls inert through hydration, then enable the current availability.
  useEffect(() => { const timer = window.setTimeout(() => setHydrated(true), 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { try { setRecent(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Recent[]); } catch { setRecent([]); } }, 0); return () => clearTimeout(timer); }, [storageKey]);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) { returnFocus.current = document.activeElement as HTMLElement | null; node.showModal(); setQuery(""); setSelected(0); requestAnimationFrame(() => input.current?.focus()); }
    if (!open && node?.open) node.close();
  }, [open]);
  // Opening the palette is a command everywhere else — in a menu, on a
  // shortcut card — but offering it as the first result *inside* the palette is
  // a dead end, so it is dropped here rather than removed from the registry.
  const available = useMemo(() => commands.filter((command) => command.id !== "navigation.palette"), [commands]);
  const all = useMemo(() => searchWorkspace(query, available, pages), [available, pages, query]);
  const results = useMemo(() => {
    if (query.trim() || !recent.length) return all;
    const byKey = new Map(all.map((item) => [item.key, item]));
    const first = recent.map((item) => byKey.get(item.key)).filter((item): item is CommandResult => Boolean(item));
    return [...first, ...all.filter((item) => !recent.some((recentItem) => recentItem.key === item.key))];
  }, [all, query, recent]);
  const isEnabled = (result: CommandResult) => result.type === "page" || result.command.availability.available;
  const boundedSelected = Math.min(selected, Math.max(0, results.length - 1));
  const safeSelected = results[boundedSelected] && isEnabled(results[boundedSelected]) ? boundedSelected : Math.max(0, results.findIndex(isEnabled));
  function move(delta: number) { if (!results.length) return; let next = safeSelected; for (let step = 0; step < results.length; step += 1) { next = (next + delta + results.length) % results.length; const result = results[next]; if (result && isEnabled(result)) { setSelected(next); return; } } }
  function close() { onClose(); requestAnimationFrame(() => returnFocus.current?.focus()); }
  function execute(result: CommandResult | undefined) {
    if (!result || (result.type === "command" && !result.command.availability.available)) return;
    const next = [{ key: result.key }, ...recent.filter((item) => item.key !== result.key)].slice(0, MAX_RECENT);
    setRecent(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* convenience only */ }
    close(); if (result.type === "page") onPage(result.page); else void result.command.run?.();
  }
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
    else if (event.key === "Enter") { event.preventDefault(); execute(results[safeSelected]); }
  }
  return <dialog ref={dialog} className="command-dialog" aria-label="Command palette" onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { if (open) onClose(); }}>
    <div className="command-palette" onKeyDown={keyDown}>
      <div className="command-search"><Search size={17} aria-hidden="true" /><input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} placeholder="Search pages and actions" aria-label="Search pages and actions" autoComplete="off" /><kbd>Esc</kbd><button type="button" aria-label="Close search" onClick={close}><X size={15} /></button></div>
      <div className="command-results" role="listbox" aria-label="Results" aria-activedescendant={results[safeSelected] ? `palette-${results[safeSelected].key}` : undefined}>
        {!query && recent.length ? <p className="command-heading">Recent</p> : null}
        {!results.length ? <p className="command-empty">Nothing matches that. Try a page name, or a word like images, brand or export.</p> : results.map((result, index) => {
          const command = result.type === "command" ? result.command : null; const disabled = !hydrated || (command ? !command.availability.available : false);
          return <button type="button" id={`palette-${result.key}`} role="option" aria-selected={index === safeSelected} aria-disabled={disabled} disabled={disabled} className={index === safeSelected ? "selected" : ""} key={result.key} onMouseEnter={() => setSelected(index)} onClick={() => execute(result)}>
            {/* The kind chip repeats the group a result is already filed
                under; spoken, "Export website, Export, Export" was three words
                for one command. It stays as a visual grouping cue and the
                description never falls back to the category. */}
            <span className="command-result-main"><strong>{result.type === "page" ? result.page.name : command!.label}</strong>{(() => {
              const detail = result.type === "page" ? (result.page.routePath || (result.page.type === "folder" ? "Folder" : "Page")) : (command!.availability.reason || command!.description);
              return detail ? <small>{detail}</small> : null;
            })()}</span>
            <span className="command-result-kind" aria-hidden="true">{result.type === "page" ? result.page.type : command!.category}</span>{command?.shortcut ? <kbd>{command.shortcut}</kbd> : <ArrowRight size={13} aria-hidden="true" />}
          </button>;
        })}
      </div>
      <p className="command-help"><span>↑↓ Move</span><span>↵ Open</span><span>Esc Close</span></p>
    </div>
  </dialog>;
}
