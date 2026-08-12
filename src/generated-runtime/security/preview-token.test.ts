import { describe, expect, it } from "vitest";
import { PreviewTokenService } from "./preview-token";

const projectId = "00000000-0000-4000-8000-000000000001"; const userId = "00000000-0000-4000-8000-000000000002";

describe("preview session tokens", () => {
  it("issues short-lived project/user-scoped tokens and detects tampering", () => {
    const tokens = new PreviewTokenService("a-test-secret-that-is-longer-than-thirty-two-characters", () => 1_000);
    const issued = tokens.issue(projectId, userId);
    expect(tokens.verify(issued.token)).toMatchObject({ projectId, userId, expiresAt: 301_000 });
    expect(() => tokens.verify(`${issued.token.slice(0, -1)}x`)).toThrow(/invalid/);
  });

  it("rejects expired tokens", () => {
    let now = 1_000; const tokens = new PreviewTokenService("a-test-secret-that-is-longer-than-thirty-two-characters", () => now); const issued = tokens.issue(projectId, userId); now = 302_000;
    expect(() => tokens.verify(issued.token)).toThrow(/expired/);
  });
});
