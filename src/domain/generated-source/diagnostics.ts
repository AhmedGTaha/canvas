const INTERNAL_ROUTES = /^invalid internal routes?:\s*(.+)$/;

function list(values: string[]) {
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

/**
 * The stage of document validation a rejection came from.
 *
 * There is no compile step any more, so "could not be compiled" no longer describes
 * anything real. These stages name what actually failed, and they are what telemetry,
 * the job record, and the repair prompt all use.
 */
export type DocumentValidationStage =
  | "invalid_document"
  | "unsafe_html"
  | "unsafe_css"
  | "unsafe_javascript"
  | "invalid_canvas_ids"
  | "invalid_media"
  | "invalid_routes"
  | "invalid_blocks";

export function documentValidationStage(detail: string): DocumentValidationStage {
  if (/^invalid internal routes?:/i.test(detail)) return "invalid_routes";
  if (/invalid media ID|declared Media references|data-canvas-media|needs alt text|cannot set src/i.test(detail)) return "invalid_media";
  if (/Canvas element ID|data-canvas-id|data-canvas-label|selectable Canvas elements/i.test(detail)) return "invalid_canvas_ids";
  if (/block reference|block usage key|Building Block/i.test(detail)) return "invalid_blocks";
  if (/^unsafe CSS/i.test(detail)) return "unsafe_css";
  if (/^unsafe JavaScript/i.test(detail)) return "unsafe_javascript";
  if (/^invalid HTML|prohibited element|unsupported element|unsupported attribute|inline event handlers|inline style|invalid class name|invalid element id|unsafe link|invalid link|unsupported link target|forms cannot submit|unsupported input type|in-page link/i.test(detail)) return "unsafe_html";
  return "invalid_document";
}

/** Maps a validator diagnostic to a specific, user-safe explanation. */
export function generatedDocumentValidationMessage(detail: string) {
  const routeMatch = INTERNAL_ROUTES.exec(detail);
  if (routeMatch) {
    const routes = routeMatch[1]!.split(",").map((route) => route.trim()).filter(Boolean);
    const subject = routes.length === 1 ? "That page" : "Those pages";
    return `${list(routes)} ${routes.length === 1 ? "does" : "do"} not exist in this project yet. Create ${subject.toLowerCase()} first or ask Canvas to use your existing pages.`;
  }
  switch (documentValidationStage(detail)) {
    case "invalid_media":
      return "Canvas generated an invalid reference to attached Media. Reattach the Media item and try again.";
    case "invalid_canvas_ids":
      return "Canvas generated invalid editable-region identifiers. Try the request again.";
    case "invalid_blocks":
      return "Canvas generated an invalid reference to a reusable section. Try the request again.";
    case "unsafe_html":
      return "Canvas generated website markup that uses an unsupported or unsafe feature. Try a simpler request.";
    case "unsafe_css":
      return "Canvas generated website styles that use an unsupported or unsafe feature. Try a simpler request.";
    case "unsafe_javascript":
      return "Canvas generated website behaviour that is not allowed to run. Try a simpler request.";
    default:
      return "Canvas generated a website document that did not meet Canvas validation rules. Try a simpler request.";
  }
}

/**
 * Bounded persistence form: no URIs, control characters, or secrets.
 *
 * This is the only form of a diagnostic that is persisted, logged, or sent back to a
 * provider during a validation repair, so it strips any `scheme://` URI rather than only
 * http(s) — a database connection string carries credentials in its authority component.
 */
export function persistedGenerationDiagnostic(detail?: string) {
  if (!detail) return null;
  return detail
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/\b[\w.+-]+:[^\s@/]+@[\w.-]+/g, "[redacted]")
    .replace(/(key|token|secret|password|credential|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 500) || null;
}
