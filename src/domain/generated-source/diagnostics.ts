const INTERNAL_ROUTES = /^invalid internal routes?:\s*(.+)$/;

function list(values: string[]) {
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

/** Maps a security validator diagnostic to a specific, user-safe explanation. */
export function generatedSourceValidationMessage(detail: string) {
  const routeMatch = INTERNAL_ROUTES.exec(detail);
  if (routeMatch) {
    const routes = routeMatch[1]!.split(",").map((route) => route.trim()).filter(Boolean);
    const subject = routes.length === 1 ? "That page" : "Those pages";
    return `${list(routes)} ${routes.length === 1 ? "does" : "do"} not exist in this project yet. Create ${subject.toLowerCase()} first or ask Canvas to use your existing pages.`;
  }
  if (/invalid media ID|declared Media references/i.test(detail)) {
    return "Canvas generated an invalid reference to attached Media. Reattach the Media item and try again.";
  }
  if (/compile failed|TSX syntax/i.test(detail)) {
    return "Canvas generated website code that could not be compiled. Try a simpler request.";
  }
  if (/Canvas element ID|data-canvas-|duplicate Canvas element/i.test(detail)) {
    return "Canvas generated invalid editable-region identifiers. Try the request again.";
  }
  if (/inline style|className|prohibited|forbidden|custom component|unsafe link/i.test(detail)) {
    return "Canvas generated code that uses an unsupported or unsafe website feature. Try a simpler request.";
  }
  return "Canvas generated website code that did not meet Canvas validation rules. Try a simpler request.";
}

/** Bounded persistence form: no URLs, control characters, or provider secrets. */
export function persistedGenerationDiagnostic(detail?: string) {
  if (!detail) return null;
  return detail
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(key|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 500) || null;
}
