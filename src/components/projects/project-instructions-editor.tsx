"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveProjectInstructionsAction } from "@/app/actions/instructions";
import { Section } from "@/components/ui/panel";
import { Textarea } from "@/components/ui/form-controls";
import { AI_LIMITS } from "@/domain/ai/limits";

/* "Idle" is the state a form is in before anyone has touched it. Starting at
   "Saved" put a green tick on an empty field nobody had edited, which claims
   something that never happened. */
type Status = "Idle" | "Saved" | "Saving" | "Error";

export function ProjectInstructionsEditor({ projectId, initialContent, initialRevision }: { projectId: string; initialContent: string; initialRevision: number }) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<Status>("Idle");
  const [error, setError] = useState<string>();
  const valueRef = useRef(content); const revisionRef = useRef(initialRevision); const saving = useRef(false); const dirty = useRef(false); const initial = useRef(true);
  const flush = useCallback(async () => {
    if (saving.current || !dirty.current) return;
    saving.current = true;
    let failed = false;
    while (dirty.current) {
      dirty.current = false;
      const snapshot = valueRef.current;
      const result = await saveProjectInstructionsAction({ projectId, expectedRevision: revisionRef.current, content: snapshot });
      if (result.ok) { revisionRef.current = result.revision; setError(undefined); if (snapshot !== valueRef.current) dirty.current = true; }
      else if (result.stale && result.revision !== undefined) { revisionRef.current = result.revision; dirty.current = true; }
      else { failed = true; setError(result.error); setStatus("Error"); break; }
    }
    saving.current = false;
    if (!dirty.current && !failed) setStatus("Saved");
  }, [projectId]);
  useEffect(() => { valueRef.current = content; if (initial.current) { initial.current = false; return; } dirty.current = true; const timer = window.setTimeout(() => void flush(), 700); return () => window.clearTimeout(timer); }, [content, flush]);
  const Icon = status === "Saving" ? LoaderCircle : status === "Error" ? CircleAlert : Check;
  return <Section
    title="What the agent should always know"
    description="Guidance here applies to every page and every change on this website. It saves as you type."
    actions={status === "Idle" ? undefined : <span className={`save-indicator save-${status.toLowerCase()}`} role="status" aria-live="polite"><Icon className={status === "Saving" ? "spin" : undefined} size={13} />{status}</span>}
  >
    <Textarea
      id="project-instructions"
      label="Instructions"
      value={content}
      onChange={(event) => { setContent(event.target.value); setStatus("Saving"); }}
      maxLength={AI_LIMITS.projectInstructionsCharacters}
      rows={12}
      hint={`For example: keep the design professional and minimal, never use gradients, always include our WhatsApp call-to-action. Up to ${AI_LIMITS.projectInstructionsCharacters.toLocaleString()} characters.`}
    />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </Section>;
}
