"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Desktop application menu bar.
 *
 * Replaces the horizontal project tab strip. Menus are declared as data by the
 * workspace so every command in the product has exactly one home, and the bar
 * itself only handles presentation and keyboard behaviour:
 *
 *  - clicking a closed menu opens it; clicking the open one closes it
 *  - once a menu is open, hovering a sibling switches to it (macOS behaviour)
 *  - Escape closes and returns focus to the trigger
 *  - Left/Right move between menus, Up/Down through items
 */
export type MenuEntry =
  | { kind: "item"; label: string; icon?: ReactNode; keys?: string; onSelect?: () => void; href?: string; disabled?: boolean; checked?: boolean; danger?: boolean; title?: string }
  | { kind: "separator" }
  | { kind: "caption"; label: string };

export type MenuGroup = { id: string; label: string; entries: MenuEntry[] };

export function MenuBar({ groups, align = "start" }: { groups: MenuGroup[]; align?: "start" | "end" }) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function move(from: string, delta: number) {
    const index = groups.findIndex((group) => group.id === from);
    const next = groups[(index + delta + groups.length) % groups.length];
    if (!next) return;
    setOpen(next.id);
    root.current?.querySelector<HTMLButtonElement>(`[data-menu-trigger="${next.id}"]`)?.focus();
  }

  return <div style={{ display: "flex", gap: 2 }} ref={root}>
    {groups.map((group) => <Menu
      key={group.id}
      group={group}
      align={align}
      open={open === group.id}
      onToggle={() => setOpen(open === group.id ? null : group.id)}
      onHover={() => { if (open && open !== group.id) setOpen(group.id); }}
      onClose={() => setOpen(null)}
      onStep={(delta) => move(group.id, delta)}
    />)}
  </div>;
}

function Menu({ group, align, open, onToggle, onHover, onClose, onStep }: { group: MenuGroup; align: "start" | "end"; open: boolean; onToggle: () => void; onHover: () => void; onClose: () => void; onStep: (delta: number) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  function close() { onClose(); trigger.current?.focus(); }

  function focusItem(offset: number) {
    const items = [...(pop.current?.querySelectorAll<HTMLElement>("[data-menu-item]") ?? [])].filter((item) => !item.hasAttribute("disabled"));
    if (!items.length) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next = current === -1 ? (offset > 0 ? 0 : items.length - 1) : (current + offset + items.length) % items.length;
    items[next]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); focusItem(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); onStep(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); onStep(-1); }
  }

  return <div className="ws-menu" onKeyDown={onKeyDown}>
    <button
      type="button"
      ref={trigger}
      data-menu-trigger={group.id}
      className="ws-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onToggle}
      onPointerEnter={onHover}
    >{group.label}</button>
    {open ? <div className={`ws-menu-pop ${align === "end" ? "ws-menu-pop-right" : ""}`} role="menu" aria-label={group.label} ref={pop}>
      {group.entries.map((entry, index) => {
        if (entry.kind === "separator") return <div className="ws-menu-sep" key={`sep-${index}`} role="separator" />;
        if (entry.kind === "caption") return <p className="ws-menu-cap" key={`cap-${index}`}>{entry.label}</p>;
        const body = <>
          {entry.icon}
          <span className="ws-mi-label">{entry.label}</span>
          {entry.checked ? <Check className="ws-mi-check" size={14} aria-hidden="true" /> : entry.keys ? <span className="ws-mi-key">{entry.keys}</span> : null}
        </>;
        const className = `ws-mi ${entry.danger ? "ws-mi-danger" : ""}`;
        if (entry.href && !entry.disabled) return <Link key={entry.label} data-menu-item="" role="menuitem" className={className} href={entry.href} title={entry.title} onClick={onClose}>{body}</Link>;
        return <button
          key={entry.label}
          type="button"
          data-menu-item=""
          role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={entry.checked}
          className={className}
          title={entry.title}
          disabled={entry.disabled}
          onClick={() => { onClose(); entry.onSelect?.(); }}
        >{body}</button>;
      })}
    </div> : null}
  </div>;
}
