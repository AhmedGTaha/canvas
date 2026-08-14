import type { CommandPage, CommandResult, WorkspaceCommand } from "./types";

function normalize(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9/]+/g, " ").trim(); }

/** Small deterministic fuzzy matcher: exact/prefix/token matches win, then ordered characters. */
export function fuzzyScore(query: string, value: string) {
  const needle = normalize(query); const haystack = normalize(value);
  if (!needle) return 1;
  if (haystack === needle) return 120;
  if (haystack.startsWith(needle)) return 100 - Math.min(30, haystack.length - needle.length);
  const at = haystack.indexOf(needle);
  if (at >= 0) return 80 - Math.min(30, at);
  const tokens = needle.split(/\s+/);
  if (tokens.every((token) => haystack.includes(token))) return 60 + tokens.length;
  let cursor = 0; let gaps = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, cursor);
    if (next < 0) return 0;
    gaps += next - cursor; cursor = next + 1;
  }
  return Math.max(1, 35 - gaps);
}

export function searchWorkspace(query: string, commands: WorkspaceCommand[], pages: CommandPage[]): CommandResult[] {
  /*
   * Ties are broken by the order things were declared in, not alphabetically.
   * With an empty query every score is equal, and sorting by key put "Account",
   * "Keyboard shortcuts" and "Sign out" at the top of a palette opened to do
   * something to the website. The registry's order is an editorial decision
   * about what matters; it is what an empty query should show.
   */
  const order = new Map<string, number>();
  const commandResults: CommandResult[] = commands.filter((command) => command.permitted).map((command, index) => {
    const key = `command:${command.id}`;
    order.set(key, index);
    return {
      type: "command" as const, key,
      score: fuzzyScore(query, [command.label, command.description, command.category, ...(command.synonyms ?? [])].filter(Boolean).join(" ")),
      command,
    };
  }).filter((result) => !query.trim() || result.score > 0);
  const pageResults: CommandResult[] = pages.map((page, index) => {
    const key = `page:${page.id}`;
    // Pages sit after commands at equal score, in tree order.
    order.set(key, commands.length + index);
    return { type: "page" as const, key, score: fuzzyScore(query, [page.name, page.slug, page.routePath, page.type].filter(Boolean).join(" ")), page };
  }).filter((result) => !query.trim() || result.score > 0);
  return [...commandResults, ...pageResults].sort((a, b) => b.score - a.score || (order.get(a.key)! - order.get(b.key)!));
}
