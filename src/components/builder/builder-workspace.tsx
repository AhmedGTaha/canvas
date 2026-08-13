"use client";

import { MousePointerClick, X } from "lucide-react";

/**
 * The chip that names the element currently selected in a preview.
 *
 * The Builder itself is now the project workspace
 * (`@/components/workspace/workspace-shell`); this chip stayed behind because
 * the Building Blocks editor shows the same selected-element affordance.
 */
export function SelectedElementChip({ selection, blockName, onClear }: { selection: { canvasId: string; elementType: string; label: string | null; blockId: string | null }; blockName?: string; onClear: () => void }) {
  return <div className="builder-selection" role="status">
    <span className="builder-selection-body">
      <MousePointerClick size={13} />
      <span>
        <strong>{selection.label ?? selection.elementType}</strong>
        <small>{selection.blockId ? `In shared section${blockName ? `: ${blockName}` : ""}` : selection.canvasId}</small>
      </span>
    </span>
    <button type="button" aria-label="Clear selected element" onClick={onClear}><X size={13} /></button>
  </div>;
}
