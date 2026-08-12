import { describe, expect, it } from "vitest";
import { GET as previewDocument } from "@/app/preview/[token]/route";
import { GET as previewMedia } from "@/app/api/preview/media/[assetId]/route";

describe("preview route security responses", () => {
  it("applies CSP and browser hardening even when a preview token is rejected", async () => {
    process.env.PREVIEW_TOKEN_SECRET = "route-test-secret-that-is-at-least-thirty-two-characters";
    const response = await previewDocument(new Request("http://localhost:3000/preview/invalid?instance=00000000-0000-4000-8000-000000000001"), { params: Promise.resolve({ token: "invalid" }) });
    expect(response.status).toBe(403); expect(response.headers.get("content-security-policy")).toContain("default-src 'none'"); expect(response.headers.get("content-security-policy")).toContain("form-action 'none'"); expect(response.headers.get("referrer-policy")).toBe("no-referrer"); expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not disclose media existence without a valid scoped token", async () => {
    const response = await previewMedia(new Request("http://localhost:3000/api/preview/media/00000000-0000-4000-8000-000000000001"), { params: Promise.resolve({ assetId: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(404); expect(await response.text()).toBe("Not found"); expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
  });
});
