"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveProjectInstructionsAction } from "@/app/actions/instructions";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form-controls";
import { AI_LIMITS } from "@/domain/ai/limits";

type Status = "Saved" | "Saving" | "Error";

export function ProjectInstructionsEditor({ projectId, initialContent, initialRevision }: { projectId: string; initialContent: string; initialRevision: number }) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<Status>("Saved");
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
  return <Card className="settings-card"><div className="settings-title"><div><p className="eyebrow">AI guidance</p><h2>Project Instructions</h2></div><span className={`save-indicator save-${status.toLowerCase()}`} role="status" aria-live="polite"><Icon className={status === "Saving" ? "spin" : undefined} size={14} />{status}</span></div>
    <p className="settings-description">Tell Canvas what it should always remember when creating or changing this website.</p>
    <Textarea id="project-instructions" label="Instructions" value={content} onChange={(event) => { setContent(event.target.value); setStatus("Saving"); }} maxLength={AI_LIMITS.projectInstructionsCharacters} rows={12} hint={`Examples: Keep the design professional and minimal. Never use gradients. Always include our WhatsApp call-to-action. Write for businesses in Bahrain. Maximum ${AI_LIMITS.projectInstructionsCharacters.toLocaleString()} characters.`} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </Card>;
}
