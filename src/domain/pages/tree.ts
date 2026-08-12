import type { PageNode } from "@/server/db/schema";

export type PageTreeNode = PageNode & { children: PageTreeNode[] };

export function buildPageTree(nodes: PageNode[]) {
  const visible = nodes.filter((node) => !node.deletedAt);
  const mapped = new Map(visible.map((node) => [node.id, { ...node, children: [] as PageTreeNode[] }]));
  const roots: PageTreeNode[] = [];
  for (const node of mapped.values()) {
    const parent = node.parentId ? mapped.get(node.parentId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const sort = (items: PageTreeNode[]) => {
    items.sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
    for (const item of items) sort(item.children);
  };
  sort(roots);
  return roots;
}
