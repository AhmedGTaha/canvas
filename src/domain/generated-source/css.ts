/**
 * Generated CSS: validation, canonical re-printing, and scoping.
 *
 * CSS is parsed into a small rule tree rather than pattern-matched as text. That buys
 * three things a regex cannot: a resource-free stylesheet can be *proved* (no `url()`,
 * no `@import`, no `expression()`), the output can be re-printed from the tree so what
 * was validated is what ships, and every selector is addressable — which is how a
 * Building Block's styles get confined to that block instead of leaking across a page.
 */

export class CssValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CssValidationError";
  }
}

export type CssRule =
  | { type: "style"; selectors: string[]; declarations: string }
  | { type: "at"; name: string; prelude: string; rules: CssRule[] };

/** At-rules that may contain nested rules. */
const NESTED_AT_RULES: ReadonlySet<string> = new Set(["media", "supports", "keyframes", "layer", "container"]);
const FORBIDDEN_CSS = [
  { pattern: /@import\b/i, message: "@import" },
  { pattern: /\burl\s*\(/i, message: "url() references" },
  { pattern: /\bexpression\s*\(/i, message: "expression()" },
  { pattern: /\bbehavior\s*:/i, message: "behavior" },
  { pattern: /-moz-binding/i, message: "-moz-binding" },
  { pattern: /javascript\s*:/i, message: "javascript: URLs" },
  { pattern: /<\/?[a-z]/i, message: "markup inside CSS" },
  { pattern: /\bposition\s*:\s*fixed\b/i, message: "position: fixed" },
] as const;

/** Selectors that would reach outside the generated document or overlay the whole page. */
const FORBIDDEN_SELECTOR_TOKENS = [
  { pattern: /:root\b/i, message: ":root" },
  { pattern: /\bhtml\b/i, message: "html" },
  { pattern: /\bbody\b/i, message: "body" },
  { pattern: /\[\s*data-canvas-/i, message: "data-canvas-* selectors" },
  { pattern: /::part\b|::slotted\b|:host\b/i, message: "shadow-DOM selectors" },
] as const;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function stripComments(input: string) {
  // Comments are removed before parsing so a comment can never hide a construct from the
  // scanners below while still being present in the shipped stylesheet.
  let output = "";
  let index = 0;
  while (index < input.length) {
    if (input.startsWith("/*", index)) {
      const end = input.indexOf("*/", index + 2);
      if (end === -1) throw new CssValidationError("unterminated CSS comment");
      index = end + 2;
      output += " ";
      continue;
    }
    output += input[index];
    index += 1;
  }
  return output;
}

function parseRules(input: string, depth: number): CssRule[] {
  if (depth > 4) throw new CssValidationError("CSS is nested too deeply");
  const rules: CssRule[] = [];
  let index = 0;
  let prelude = "";
  while (index < input.length) {
    const character = input[index]!;
    if (character === "{") {
      let depthCount = 1;
      let end = index + 1;
      while (end < input.length && depthCount > 0) {
        if (input[end] === "{") depthCount += 1;
        else if (input[end] === "}") depthCount -= 1;
        end += 1;
      }
      if (depthCount !== 0) throw new CssValidationError("unbalanced braces in CSS");
      const body = input.slice(index + 1, end - 1);
      const head = prelude.trim();
      prelude = "";
      index = end;
      if (head.startsWith("@")) {
        const name = (/^@([a-z-]+)/i.exec(head)?.[1] ?? "").toLowerCase();
        if (!NESTED_AT_RULES.has(name)) throw new CssValidationError(`unsupported at-rule: @${name || "unknown"}`);
        rules.push({ type: "at", name, prelude: head.slice(name.length + 1).trim(), rules: parseRules(body, depth + 1) });
      } else {
        if (!head) throw new CssValidationError("CSS rule with no selector");
        if (body.includes("{")) throw new CssValidationError("nested CSS rules are not supported");
        rules.push({ type: "style", selectors: head.split(",").map((selector) => selector.trim()).filter(Boolean), declarations: body.trim() });
      }
      continue;
    }
    // Every at-rule that terminates in a semicolon rather than a block loads or
    // redefines something outside this stylesheet, so none of them are supported.
    if (character === ";" && prelude.trim().startsWith("@")) {
      const name = (/^@([a-z-]+)/i.exec(prelude.trim())?.[1] ?? "unknown").toLowerCase();
      throw new CssValidationError(`unsupported at-rule: @${name}`);
    }
    if (character === "}") throw new CssValidationError("unbalanced braces in CSS");
    prelude += character;
    index += 1;
  }
  if (prelude.trim()) throw new CssValidationError("trailing CSS outside any rule");
  return rules;
}

function assertDeclarations(declarations: string) {
  for (const declaration of declarations.split(";")) {
    const trimmed = declaration.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) throw new CssValidationError(`malformed CSS declaration: ${trimmed.slice(0, 40)}`);
    const property = trimmed.slice(0, colon).trim().toLowerCase();
    if (!/^-{0,2}[a-z][a-z0-9-]*$/.test(property)) throw new CssValidationError(`invalid CSS property: ${property.slice(0, 40)}`);
  }
}

function assertSelector(selector: string) {
  if (selector.length > 200) throw new CssValidationError("CSS selector is too long");
  for (const rule of FORBIDDEN_SELECTOR_TOKENS) {
    if (rule.pattern.test(selector)) throw new CssValidationError(`prohibited CSS selector: ${rule.message}`);
  }
  if (!/^[a-zA-Z0-9_\-.#:,>+~*[\]="'()\s]+$/.test(selector)) throw new CssValidationError(`invalid characters in CSS selector: ${selector.slice(0, 40)}`);
}

export type CssValidationResult = { css: string; rules: CssRule[] };

/**
 * Parses and checks one generated stylesheet, returning its canonical text.
 *
 * `maxBytes` is enforced by the caller against the whole document; this function is only
 * concerned with what the stylesheet is allowed to say.
 */
export function validateGeneratedCss(input: string): CssValidationResult {
  if (CONTROL_CHARACTERS.test(input)) throw new CssValidationError("control character in CSS");
  for (const rule of FORBIDDEN_CSS) {
    if (rule.pattern.test(input)) throw new CssValidationError(`prohibited CSS: ${rule.message}`);
  }
  const rules = parseRules(stripComments(input), 0);
  const visit = (list: CssRule[], insideKeyframes: boolean) => {
    for (const rule of list) {
      if (rule.type === "at") {
        if (rule.name === "keyframes") {
          if (!/^[a-zA-Z][\w-]*$/.test(rule.prelude)) throw new CssValidationError("invalid @keyframes name");
        } else if (rule.prelude.length > 200) throw new CssValidationError(`@${rule.name} condition is too long`);
        visit(rule.rules, insideKeyframes || rule.name === "keyframes");
        continue;
      }
      // A keyframe's "selector" is an offset (`from`, `to`, `50%`), not a document
      // selector, so the document-selector rules do not apply to it.
      for (const selector of rule.selectors) {
        if (insideKeyframes) {
          if (!/^(from|to|\d{1,3}(\.\d+)?%)$/i.test(selector)) throw new CssValidationError(`invalid keyframe offset: ${selector.slice(0, 40)}`);
        } else assertSelector(selector);
      }
      assertDeclarations(rule.declarations);
    }
  };
  visit(rules, false);
  return { css: printCss(rules), rules };
}

export function printCss(rules: readonly CssRule[]): string {
  return rules.map((rule) => {
    if (rule.type === "at") return `@${rule.name}${rule.prelude ? ` ${rule.prelude}` : ""}{${printCss(rule.rules)}}`;
    return `${rule.selectors.join(",")}{${rule.declarations}}`;
  }).join("");
}

/**
 * Confines a stylesheet to one region of the page.
 *
 * Building Blocks are written in isolation and then composed onto a page next to other
 * blocks and the page's own styles, so `.card{…}` from a footer would otherwise restyle
 * everything else called `.card`. Every selector is prefixed with the host's scope
 * attribute, which is on the element Canvas wraps the block in — so a block's CSS
 * physically cannot match anything outside its own subtree.
 *
 * `@keyframes` bodies are selectors like `from`/`50%` and are left alone; the animation
 * *name* is renamed instead, so two blocks can each define `fade` without colliding.
 */
export function scopeCss(rules: readonly CssRule[], scopeSelector: string, namePrefix: string): CssRule[] {
  const animationNames = new Set<string>();
  const collect = (list: readonly CssRule[]) => {
    for (const rule of list) {
      if (rule.type === "at" && rule.name === "keyframes") animationNames.add(rule.prelude);
      if (rule.type === "at") collect(rule.rules);
    }
  };
  collect(rules);

  const renameAnimations = (declarations: string) => {
    let output = declarations;
    for (const name of animationNames) {
      output = output.replace(new RegExp(`(^|[\\s:,])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[\\s;,])`, "g"), `$1${namePrefix}${name}`);
    }
    return output;
  };

  const map = (list: readonly CssRule[], insideKeyframes: boolean): CssRule[] => list.map((rule): CssRule => {
    if (rule.type === "at") {
      if (rule.name === "keyframes") return { ...rule, prelude: `${namePrefix}${rule.prelude}`, rules: map(rule.rules, true) };
      return { ...rule, rules: map(rule.rules, insideKeyframes) };
    }
    const declarations = renameAnimations(rule.declarations);
    if (insideKeyframes) return { ...rule, declarations };
    return { ...rule, selectors: rule.selectors.map((selector) => `${scopeSelector} ${selector}`), declarations };
  });

  return map(rules, false);
}
