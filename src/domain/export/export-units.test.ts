import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertSafeExportPath, componentName, fileStem, mediaExtension, pageFilePath, relativeRootPrefix } from "./naming";
import { BuildValidator } from "./build-validator";
import { ZipPackager } from "./zip-packager";

const blockId = "11111111-1111-4111-8111-111111111111";
const mediaId = "22222222-2222-4222-8222-222222222222";
const encoder = new TextEncoder();
const file = (path: string, contents: string) => ({ path, contents: encoder.encode(contents) });

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

  it("maps routes to static HTML files and rejects unsafe segments", () => {
    expect(pageFilePath("/")).toBe("index.html");
    expect(pageFilePath("/about")).toBe("about.html");
    expect(pageFilePath("/company/team")).toBe("company/team.html");
    for (const route of ["/../etc", "/About", "/a b", "/x/../../y", "/%2e%2e"]) expect(() => pageFilePath(route)).toThrow();
  });

  it("computes the relative path from a page back to the archive root", () => {
    expect(relativeRootPrefix("index.html")).toBe("");
    expect(relativeRootPrefix("about.html")).toBe("");
    expect(relativeRootPrefix("company/team.html")).toBe("../");
    expect(relativeRootPrefix("a/b/c.html")).toBe("../../");
  });

  it("rejects export paths that could escape the archive root", () => {
    expect(assertSafeExportPath("styles/site.css")).toBe("styles/site.css");
    expect(assertSafeExportPath(".gitignore")).toBe(".gitignore");
    for (const path of ["../secret", "app/../../etc/passwd", "/etc/passwd", "app//page.html", "app/", "a/./b", "app/page html", "app/pa|ge.css"]) {
      expect(() => assertSafeExportPath(path), path).toThrow();
    }
  });

  it("only accepts supported image formats", () => {
    expect(mediaExtension("image/png")).toBe("png");
    expect(mediaExtension("image/jpeg")).toBe("jpg");
    expect(() => mediaExtension("image/gif")).toThrow();
    expect(() => mediaExtension("text/html")).toThrow();
  });

});

describe("static output validation", () => {
  const validator = new BuildValidator();
  const page = (body: string, head = "") => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n${head}</head>\n<body class="c-page">\n${body}\n</body>\n</html>\n`;

  it("passes a self-contained static site", async () => {
    const failures = await validator.validate([
      file("index.html", page(`<main><a href="about.html">About</a><img src="assets/logo.png" alt="Logo"></main>`, `<link rel="stylesheet" href="styles/site.css">\n`)),
      file("about.html", page(`<main><a href="index.html">Home</a></main>`, `<link rel="stylesheet" href="styles/site.css">\n`)),
      file("styles/site.css", `.c-page{color:var(--color-text)}`),
      file("assets/logo.png", "binary"),
    ]);
    expect(failures).toEqual([]);
  });

  it("rejects a page that links to a file the archive does not contain", async () => {
    const failures = await validator.validate([file("index.html", page(`<main><a href="missing.html">Gone</a></main>`))]);
    expect(failures[0]).toMatchObject({ code: "EXPORT_BROKEN_REFERENCE" });
  });

  it("rejects editor-only Canvas attributes and preview URLs", async () => {
    const attributes = await validator.validate([file("index.html", page(`<main data-canvas-id="root"></main>`))]);
    expect(attributes[0]).toMatchObject({ code: "EXPORT_UNSAFE_OUTPUT" });
    const preview = await validator.validate([file("index.html", page(`<main><img src="/api/preview/media/abc" alt="x"></main>`))]);
    expect(preview[0]).toMatchObject({ code: "EXPORT_UNSAFE_OUTPUT" });
  });

  it("rejects backend and build files", async () => {
    for (const path of ["api/handler.js", "package.json", ".env"]) {
      const failures = await validator.validate([file(path, "{}")]);
      expect(failures[0], path).toMatchObject({ code: "EXPORT_BACKEND_CODE" });
    }
  });

  it("re-checks the shipped stylesheet and script with the generator's own validators", async () => {
    const css = await validator.validate([file("index.html", page("<main></main>")), file("styles/x.css", `@import url("https://x.example/a.css");`)]);
    expect(css[0]).toMatchObject({ code: "EXPORT_UNSAFE_OUTPUT" });
    const js = await validator.validate([file("index.html", page("<main></main>")), file("scripts/x.js", `;(function(parent,top){"use strict";\nfetch("/x");\n})();`)]);
    expect(js[0]).toMatchObject({ code: "EXPORT_UNSAFE_OUTPUT" });
  });

  it("rejects a page whose markup Canvas can no longer read", async () => {
    const failures = await validator.validate([file("index.html", page("<main><section></main>"))]);
    expect(failures[0]).toMatchObject({ code: "EXPORT_INVALID_DOCUMENT" });
  });

  // Nothing in the output needs Node.js, npm, React, or a build step any more.
  it("never emits a package manifest or a framework dependency", async () => {
    const failures = await validator.validate([file("package.json", `{"dependencies":{"next":"16.3.0"}}`)]);
    expect(failures).not.toEqual([]);
  });
});

describe("zip packaging", () => {
  const packager = new ZipPackager();

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
