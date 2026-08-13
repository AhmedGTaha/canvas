import { describe, expect, it } from "vitest";
import { repairGeneratedCanvasIds } from "./canvas-id-repair";

describe("generated Canvas ID repair", () => {
  it("normalizes only unambiguous static literals deterministically", () => {
    const sourceCode = `export default function Page(){return <main data-canvas-id="Hero Main"><section data-canvas-id={"Features_Grid"}/></main>}`;
    expect(repairGeneratedCanvasIds(sourceCode)).toEqual({
      sourceCode: `export default function Page(){return <main data-canvas-id="hero-main"><section data-canvas-id="features-grid"/></main>}`,
      repairs: [{ from: "Hero Main", to: "hero-main" }, { from: "Features_Grid", to: "features-grid" }],
    });
  });

  it("does not repair dynamic Gemini expressions", () => {
    const sourceCode = `export default function Page(){return <main data-canvas-id={\`feature-card-\${feature.id}\`}/>} `;
    expect(repairGeneratedCanvasIds(sourceCode)).toEqual({ sourceCode, repairs: [] });
  });

  it.each([
    [`<main data-canvas-id="Hero"/><section data-canvas-id="hero"/>`, "a normalization collision"],
    [`<main data-canvas-id="hero"/><section data-canvas-id="hero"/>`, "a duplicate"],
    [`<main data-canvas-id="!!!"/>`, "an empty normalized ID"],
  ])("leaves source unchanged for %s", (body) => {
    const sourceCode = `export default function Page(){return <>${body}</>}`;
    expect(repairGeneratedCanvasIds(sourceCode)).toEqual({ sourceCode, repairs: [] });
  });
});
