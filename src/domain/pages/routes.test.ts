import { describe, expect, it } from "vitest";
import { computePageRoutes, descendantIds, type RouteNode } from "./routes";

const node = (partial: Partial<RouteNode> & Pick<RouteNode, "id">): RouteNode => ({ parentId: null, type: "page", slug: partial.id, isHomepage: false, ...partial });

describe("canonical page routes", () => {
  it("uses only page ancestors and assigns / to the homepage", () => {
    const routes = computePageRoutes([
      node({ id: "home", slug: "home", isHomepage: true }),
      node({ id: "folder", type: "folder", slug: null }),
      node({ id: "services", parentId: "folder", slug: "services" }),
      node({ id: "web", parentId: "services", slug: "web-development" }),
    ]);
    expect(routes.get("home")).toBe("/");
    expect(routes.get("services")).toBe("/services");
    expect(routes.get("web")).toBe("/services/web-development");
  });

  it("rejects effective route collisions", () => {
    expect(() => computePageRoutes([node({ id: "a", slug: "contact" }), node({ id: "b", slug: "contact" })])).toThrowError(/already used/);
    expect(() => computePageRoutes([node({ id: "p1", slug: "services" }), node({ id: "p2", slug: "services" }), node({ id: "a", parentId: "p1", slug: "web" }), node({ id: "b", parentId: "p2", slug: "web" })])).toThrowError(/already used/);
  });

  it("finds a complete subtree", () => {
    expect(descendantIds([{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }], "a")).toEqual(new Set(["a", "b", "c"]));
  });
});
