"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { EmptyState } from "@/components/ui/states";

/**
 * Advanced, read-only view of the source behind the active generated page.
 *
 * It is progressive disclosure for people who want to see the HTML, CSS, and JavaScript
 * Canvas produced — never an editor. There is no Save and no way to mutate source from
 * here: every real change still goes through the Agent, versions, and change sets. The
 * source shown is the active Page Version's canonical document, already validated.
 */
type Tab = "html" | "css" | "js";
const TAB_LABELS: Record<Tab, string> = { html: "HTML", css: "CSS", js: "JavaScript" };

export function CodeView({ pageName, html, css, js, title, description }: {
  pageName: string;
  html: string | null;
  css: string | null;
  js: string | null;
  title: string | null;
  description: string | null;
}) {
  const [tab, setTab] = useState<Tab>("html");
  const [copied, setCopied] = useState(false);

  if (html === null) {
    return <EmptyState title="No code yet" description={`${pageName} has not been generated yet. Ask Canvas Agent to build this page, then its HTML, CSS, and JavaScript will appear here.`} />;
  }

  const source: Record<Tab, string> = { html, css: css ?? "", js: js ?? "" };
  const current = source[tab];

  async function copy() {
    try {
      await navigator.clipboard.writeText(current);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable; the code is still selectable by hand */ }
  }

  return <div className="code-view">
    {title || description ? <dl className="code-view-meta">
      {title ? <div><dt>Title</dt><dd>{title}</dd></div> : null}
      {description ? <div><dt>Description</dt><dd>{description}</dd></div> : null}
    </dl> : null}
    <div className="code-view-bar">
      <div className="code-view-tabs" role="tablist" aria-label="Generated source">
        {(Object.keys(TAB_LABELS) as Tab[]).map((name) => <button
          key={name}
          type="button"
          role="tab"
          aria-selected={tab === name}
          className="code-view-tab"
          onClick={() => setTab(name)}
        >{TAB_LABELS[name]}{source[name].length === 0 ? <span className="code-view-empty-dot" aria-hidden="true" /> : null}</button>)}
      </div>
      <button type="button" className="code-view-copy" onClick={() => void copy()} disabled={current.length === 0} aria-label={`Copy ${TAB_LABELS[tab]}`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}
      </button>
    </div>
    {current.length === 0
      ? <p className="code-view-none">This page uses no {TAB_LABELS[tab]}.</p>
      : <pre className="code-view-pre" tabIndex={0} aria-label={`${TAB_LABELS[tab]} source, read only`}><code>{current}</code></pre>}
  </div>;
}
