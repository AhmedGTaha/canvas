import { DomainError } from "@/domain/shared/errors";

export type RouteNode = {
  id: string;
  parentId: string | null;
  type: "page" | "folder";
  slug: string | null;
  isHomepage: boolean;
};

export function computePageRoutes(nodes: RouteNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const routes = new Map<string, string>();

  function routeFor(node: RouteNode, visiting = new Set<string>()): string {
    if (node.type !== "page") throw new DomainError("VALIDATION", "Folders do not have website routes.");
    if (node.isHomepage) return "/";
    if (!node.slug) throw new DomainError("VALIDATION", "Every page needs a URL slug.");
    if (visiting.has(node.id)) throw new DomainError("VALIDATION", "The page structure contains a cycle.");
    visiting.add(node.id);
    const segments = [node.slug];
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) throw new DomainError("VALIDATION", "The selected parent is unavailable.");
      if (visiting.has(parent.id)) throw new DomainError("VALIDATION", "The page structure contains a cycle.");
      visiting.add(parent.id);
      if (parent.type === "page" && !parent.isHomepage) {
        if (!parent.slug) throw new DomainError("VALIDATION", "Every page needs a URL slug.");
        segments.unshift(parent.slug);
      }
      parentId = parent.parentId;
    }
    const route = `/${segments.join("/")}`;
    if (route.length > 1000) throw new DomainError("VALIDATION", "This page URL is too deeply nested.");
    return route;
  }

  for (const node of nodes) if (node.type === "page") routes.set(node.id, routeFor(node));
  const seen = new Map<string, string>();
  for (const [id, route] of routes) {
    if (seen.has(route)) throw new DomainError("CONFLICT", "That URL is already used by another page.");
    seen.set(route, id);
  }
  return routes;
}

export function descendantIds(nodes: Pick<RouteNode, "id" | "parentId">[], rootId: string) {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (node.parentId && result.has(node.parentId) && !result.has(node.id)) { result.add(node.id); changed = true; }
  }
  return result;
}
