import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EXPORT_DEPENDENCIES } from "./dependencies";
import { assertSafeExportPath, componentName, fileStem, mediaExtension, routeDirectory } from "./naming";
import { transformGeneratedSource, requiresClientRuntime } from "./source-transform";
import { ZipPackager } from "./zip-packager";

const blockId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const media = new Map([[mediaId, { assetPath: "/assets/logo-abcd1234.png", width: 320, height: 120, altText: "Fallback" }]]);
const blocks = new Map([[`${blockId}:site-navbar`, { componentName: "GlobalNavbarAB12CD", importPath: "@/components/blocks/GlobalNavbarAB12CD" }]]);

describe("export naming", () => {
  it("derives deterministic component names that do not depend on the display name alone", () => {
    expect(componentName("Global Navbar", blockId)).toBe(componentName("Global Navbar", blockId));
    expect(componentName("Global Navbar", blockId)).toMatch(/^GlobalNavbar[0-9A-F]{6}$/);
    // Renaming the block changes the readable part; two same-named blocks never collide.
    expect(componentName("Global Navbar", blockId)).not.toBe(componentName("Global Navbar", mediaId));
    expect(componentName("2024 promo!", blockId)).toMatch(/^Block2024Promo[0-9A-F]{6}$/);
    expect(componentName("", blockId)).toMatch(/^Block[0-9A-F]{6}$/);
  });

  it("derives collision-safe asset file stems", () => {
    expect(fileStem("Company Logo", mediaId)).toMatch(/^company-logo-[0-9a-f]{8}$/);
    expect(fileStem("Company Logo", mediaId)).not.toBe(fileStem("Company Logo", blockId));
    expect(fileStem("///", mediaId, "image")).toMatch(/^image-[0-9a-f]{8}$/);
  });

  it("maps routes to app directories and rejects unsafe segments", () => {
    expect(routeDirectory("/")).toBe("app");
    expect(routeDirectory("/about")).toBe("app/about");
    expect(routeDirectory("/company/team")).toBe("app/company/team");
    for (const route of ["/../etc", "/About", "/a b", "/x/../../y", "/%2e%2e"]) expect(() => routeDirectory(route)).toThrow();
  });

  it("rejects export paths that could escape the archive root", () => {
    expect(assertSafeExportPath("app/page.tsx")).toBe("app/page.tsx");
    expect(assertSafeExportPath(".gitignore")).toBe(".gitignore");
    for (const path of ["../secret", "app/../../etc/passwd", "/etc/passwd", "app//page.tsx", "app/", "a/./b", "app/page tsx", "app/pa|ge.tsx"]) {
      expect(() => assertSafeExportPath(path), path).toThrow();
    }
  });

  it("only accepts supported image formats", () => {
    expect(mediaExtension("image/png")).toBe("png");
    expect(mediaExtension("image/jpeg")).toBe("jpg");
    expect(() => mediaExtension("image/gif")).toThrow();
    expect(() => mediaExtension("text/html")).toThrow();
  });

  it("keeps exported dependency versions in step with the Canvas runtime", () => {
    const canvas = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    for (const [name, version] of Object.entries(EXPORT_DEPENDENCIES.dependencies)) expect(canvas.dependencies[name], name).toBe(version);
    for (const [name, version] of Object.entries(EXPORT_DEPENDENCIES.devDependencies)) expect(canvas.devDependencies[name], name).toBe(version);
  });
});

describe("generated source transformation", () => {
  it("rewrites Canvas primitives and strips editor-only metadata", () => {
    const sourceCode = `import { CanvasBlock, CanvasImage } from "@canvas/site-runtime";
export default function GeneratedPage(){return <main className="c-page" data-canvas-id="root" data-canvas-label="Page"><CanvasBlock blockId="${blockId}" usageKey="site-navbar" /><section data-canvas-id="hero"><CanvasImage mediaId="${mediaId}" alt="Acme" className="c-media" /></section></main>}`;
    const result = transformGeneratedSource({ sourceCode, media, blocks, componentName: "HomeContent", forceClient: false });

    expect(result.code).toContain(`import GlobalNavbarAB12CD from "@/components/blocks/GlobalNavbarAB12CD";`);
    expect(result.code).toContain("export default function HomeContent(");
    expect(result.code).toContain("<GlobalNavbarAB12CD />");
    expect(result.code).toContain(`src="/assets/logo-abcd1234.png"`);
    expect(result.code).toContain(`alt="Acme"`);
    expect(result.code).toContain("width={320}");
    expect(result.code).toContain("height={120}");
    expect(result.code).toContain(`className="c-page"`);
    for (const forbidden of ["data-canvas-id", "data-canvas-label", "@canvas/site-runtime", "CanvasBlock", "CanvasImage", blockId, mediaId]) {
      expect(result.code, forbidden).not.toContain(forbidden);
    }
    expect(result.mediaIds).toEqual([mediaId]);
    expect(result.blocks).toHaveLength(1);
  });

  it("falls back to the media alt text and keeps other attributes", () => {
    const sourceCode = `import { CanvasImage } from "@canvas/site-runtime";\nexport default function P(){return <CanvasImage mediaId="${mediaId}" className="c-media" />}`;
    const result = transformGeneratedSource({ sourceCode, media, blocks, componentName: "P", forceClient: false });
    expect(result.code).toContain(`alt="Fallback"`);
    expect(result.code).toContain(`className="c-media"`);
  });

  it("adds the client directive when needed and keeps an existing one first", () => {
    const interactive = `"use client";\nimport { useState } from "react";\nexport default function B(){const [open,setOpen]=useState(false);return <div onClick={()=>setOpen(!open)} data-canvas-id="x" />}`;
    const kept = transformGeneratedSource({ sourceCode: interactive, media, blocks, componentName: "Faq", forceClient: true });
    expect(kept.code.indexOf(`"use client"`)).toBe(0);
    expect(kept.code.match(/use client/g)).toHaveLength(1);

    const added = transformGeneratedSource({ sourceCode: `export default function B(){return <div data-canvas-id="x" />}`, media, blocks, componentName: "Faq", forceClient: true });
    expect(added.code.indexOf(`"use client"`)).toBe(0);
  });

  it("places block imports after an existing client directive", () => {
    const sourceCode = `"use client";\nimport { CanvasBlock } from "@canvas/site-runtime";\nexport default function P(){return <CanvasBlock blockId="${blockId}" usageKey="site-navbar" />}`;
    const result = transformGeneratedSource({ sourceCode, media, blocks, componentName: "P", forceClient: true });
    expect(result.code.indexOf(`"use client"`)).toBeLessThan(result.code.indexOf("import GlobalNavbarAB12CD"));
  });

  it("refuses to emit a component with an unresolved reference", () => {
    const unknown = "33333333-3333-4333-8333-333333333333";
    expect(() => transformGeneratedSource({ sourceCode: `import { CanvasImage } from "@canvas/site-runtime";\nexport default function P(){return <CanvasImage mediaId="${unknown}" alt="x" />}`, media, blocks, componentName: "P", forceClient: false })).toThrow(/could not resolve media/);
    expect(() => transformGeneratedSource({ sourceCode: `import { CanvasBlock } from "@canvas/site-runtime";\nexport default function P(){return <CanvasBlock blockId="${unknown}" usageKey="nav" />}`, media, blocks, componentName: "P", forceClient: false })).toThrow(/could not resolve Building Block/);
  });

  it("detects client interactivity from the manifest or the source", () => {
    expect(requiresClientRuntime("export default function P(){return <div/>}", { usesClientInteractivity: true })).toBe(true);
    expect(requiresClientRuntime("const [a,b]=useState(1)", {})).toBe(true);
    expect(requiresClientRuntime(`<button onClick={() => run()} />`, {})).toBe(true);
    expect(requiresClientRuntime("export default function P(){return <div/>}", { usesClientInteractivity: false })).toBe(false);
  });
});

describe("zip packaging", () => {
  const packager = new ZipPackager();
  const encoder = new TextEncoder();

  it("produces a deterministic archive readable by the standard format", () => {
    const files = [
      { path: "b.txt", contents: encoder.encode("second") },
      { path: "a/one.txt", contents: encoder.encode("first".repeat(50)) },
    ];
    const first = packager.pack(files);
    const second = packager.pack([...files].reverse());
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const endIndex = first.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(first.readUInt16LE(endIndex + 10)).toBe(2);
    // Entries round-trip byte for byte.
    let cursor = first.readUInt32LE(endIndex + 16);
    const names: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const method = first.readUInt16LE(cursor + 10);
      const compressedSize = first.readUInt32LE(cursor + 20);
      const nameLength = first.readUInt16LE(cursor + 28);
      const localOffset = first.readUInt32LE(cursor + 42);
      const name = first.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      names.push(name);
      const start = localOffset + 30 + first.readUInt16LE(localOffset + 26) + first.readUInt16LE(localOffset + 28);
      const body = first.subarray(start, start + compressedSize);
      const contents = method === 8 ? inflateRawSync(body) : body;
      expect(contents.toString("utf8")).toBe(name === "b.txt" ? "second" : "first".repeat(50));
      cursor += 46 + nameLength + first.readUInt16LE(cursor + 30) + first.readUInt16LE(cursor + 32);
    }
    expect(names).toEqual(["a/one.txt", "b.txt"]);
  });

  it("rejects duplicate and unsafe entry paths", () => {
    expect(() => packager.pack([{ path: "a.txt", contents: encoder.encode("1") }, { path: "a.txt", contents: encoder.encode("2") }])).toThrow(/Duplicate/);
    expect(() => packager.pack([{ path: "../escape.txt", contents: encoder.encode("1") }])).toThrow(/Unsafe/);
  });
});
