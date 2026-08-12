import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/shared/errors";
import { requireWorkspaceAccess } from "./access";

describe("access helpers", () => {
  it("allows owners to access their workspace", () => {
    expect(requireWorkspaceAccess("user-a", { ownerUserId: "user-a" })).toBeTruthy();
  });

  it("rejects cross-tenant access", () => {
    expect(() => requireWorkspaceAccess("user-b", { ownerUserId: "user-a" })).toThrowError(DomainError);
  });

  it("treats a missing workspace as unavailable", () => {
    expect(() => requireWorkspaceAccess("user-a", undefined)).toThrowError(/not found/i);
  });
});
