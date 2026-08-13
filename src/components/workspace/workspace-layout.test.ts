import { describe, expect, it } from "vitest";
import { breakpointFor, normalizeWorkspaceLayout } from "./workspace-layout";

describe("responsive workspace state", () => {
  it("classifies approved breakpoints", () => { expect(breakpointFor(1440)).toBe("desktop"); expect(breakpointFor(1024)).toBe("compact"); expect(breakpointFor(768)).toBe("compact"); expect(breakpointFor(767)).toBe("mobile"); expect(breakpointFor(390)).toBe("mobile"); });
  it("normalizes compact layouts so the agent does not squeeze three columns", () => { expect(normalizeWorkspaceLayout({ primary: true, agent: true }, "compact")).toMatchObject({ primary: false, agent: true }); });
  it("enforces one focused mobile surface", () => { expect(normalizeWorkspaceLayout({ mobileSurface: "tools", primary: false, agent: true }, "mobile")).toMatchObject({ mobileSurface: "tools", primary: true, agent: false }); expect(normalizeWorkspaceLayout({ mobileSurface: "agent", primary: true, agent: false }, "mobile")).toMatchObject({ primary: false, agent: true }); expect(normalizeWorkspaceLayout({ mobileSurface: "preview", primary: true, agent: true }, "mobile")).toMatchObject({ primary: false, agent: false }); });
  it("rejects corrupt persisted dimensions and activities", () => { expect(normalizeWorkspaceLayout({ primaryWidth: 9999, agentWidth: 1, zoom: 400, activity: "bad" as never }, "desktop")).toMatchObject({ primaryWidth: 440, agentWidth: 320, zoom: 150, activity: "website" }); });
});
