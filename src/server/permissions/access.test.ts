import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/shared/errors";
import { requireProjectAccess, requireProjectOwner, requireWorkspaceAccess } from "./access";

describe("access helpers", () => {
  it("allows owners to access their workspace and project", () => {
    expect(requireWorkspaceAccess("user-a", { ownerUserId: "user-a" })).toBeTruthy();
    expect(requireProjectOwner("user-a", { ownerUserId: "user-a", status: "active" })).toBeTruthy();
  });

  it("rejects cross-tenant access", () => {
    expect(() => requireWorkspaceAccess("user-b", { ownerUserId: "user-a" })).toThrowError(DomainError);
    expect(() => requireProjectAccess("user-b", { ownerUserId: "user-a", status: "active" })).toThrowError(/do not have access/);
  });

  it("treats deleted and missing projects as unavailable", () => {
    expect(() => requireProjectAccess("user-a", undefined)).toThrowError(/not found/i);
    expect(() => requireProjectAccess("user-a", { ownerUserId: "user-a", status: "deleted" })).toThrowError(/not found/i);
  });
});
