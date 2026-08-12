import { describeElement, type ResolvedElementSelection } from "./selection";

/**
 * Shared targeting instructions for element-level edits. The selected element is
 * resolved server-side from the active version manifest before it reaches the model,
 * so the model is told exactly which region it may change.
 */
export function targetedElementInstructions(selection: ResolvedElementSelection) {
  const owner = selection.ownerType === "building_block" ? "Building Block" : "page";
  return `\n\nThe user selected one specific region of this ${owner} and the request applies to that region only.
<selected_element>
canvasId: ${selection.canvasId}
element: ${describeElement(selection)}
</selected_element>
Modify only the element carrying data-canvas-id="${selection.canvasId}" and its contents. Leave every other region of the source byte-for-byte unchanged unless a change elsewhere is technically required to keep the ${owner} valid, in which case disclose it in summary.changes.
Keep data-canvas-id="${selection.canvasId}" on the modified element and keep every other existing data-canvas-id unchanged.
Set targetCanvasId to "${selection.canvasId}". Only if the user explicitly asked to remove that region, omit it and set targetRemoved to true.`;
}
