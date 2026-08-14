import { describe, expect, it } from "vitest";
import { validateGeneratedPageSource } from "./validator";

const mediaId = "11111111-1111-4111-8111-111111111111";
const context = { approvedMediaIds: new Set([mediaId]), activeRoutes: new Set(["/", "/contact"]) };

describe("generated page source validation", () => {
  it("compiles responsive React state, project tokens, CanvasImage, links, and inline SVG", async () => {
    const sourceCode = `"use client";
import { useState } from "react";
import { CanvasImage } from "@canvas/site-runtime";
export default function GeneratedPage(){const [open,setOpen]=useState(false);return <main className="c-page"><h1>Welcome</h1><CanvasImage mediaId="${mediaId}" alt="Office" className="c-media" /><button onClick={()=>setOpen(!open)}>Details</button>{open&&<p>Open</p>}<a href="/contact">Contact</a><a href="#services">Services</a><a href="https://example.com">External</a><svg aria-hidden="true"><circle cx="5" cy="5" r="4" /></svg></main>}`;
    await expect(validateGeneratedPageSource({ sourceCode, ...context, declaredMediaIds: [mediaId] })).resolves.toMatchObject({ referencedMediaIds: [mediaId], internalRoutes: ["/contact"], externalLinks: ["https://example.com"], usesClientInteractivity: true, runtimeVersion: 1 });
  });

  it.each([
    ["fetch", `export default function Page(){fetch("/api/x");return <main/>}`],
    ["qualified fetch", `export default function Page(){window.fetch("/api/x");return <main/>}`],
    ["computed parent", `export default function Page(){window["parent"].location="/";return <main/>}`],
    ["eval", `export default function Page(){eval("1");return <main/>}`],
    ["Function", `export default function Page(){new Function("return 1");return <main/>}`],
    ["require", `export default function Page(){require("fs");return <main/>}`],
    ["fs import", `import fs from "fs";export default function Page(){return <main/>}`],
    ["next import", `import x from "next/server";export default function Page(){return <main/>}`],
    ["parent", `export default function Page(){window.parent.location.href="/";return <main/>}`],
    ["storage", `export default function Page(){localStorage.getItem("x");return <main/>}`],
    ["HTML injection", `export default function Page(){return <main dangerouslySetInnerHTML={{__html:"x"}}/>}`],
    ["script", `export default function Page(){return <script/>}`],
    ["iframe", `export default function Page(){return <iframe/>}`],
    ["remote image", `export default function Page(){return <img src="https://remote.example/x.jpg"/>}`],
    ["javascript link", `export default function Page(){return <a href="javascript:alert(1)">x</a>}`],
    ["unknown route", `export default function Page(){return <a href="/pricing">x</a>}`],
    ["dynamic import", `export default async function Page(){await import("react");return <main/>}`],
  ])("rejects %s", async (_name, sourceCode) => { await expect(validateGeneratedPageSource({ sourceCode, ...context, declaredMediaIds: [] })).rejects.toMatchObject({ code: "AI_GENERATED_SOURCE_INVALID" }); });

  it("rejects hallucinated and mismatched Media IDs", async () => {
    const foreign = "22222222-2222-4222-8222-222222222222";
    await expect(validateGeneratedPageSource({ sourceCode: `import{CanvasImage}from"@canvas/site-runtime";export default function Page(){return <CanvasImage mediaId="${foreign}" alt=""/>}`, ...context, declaredMediaIds: [foreign] })).rejects.toMatchObject({ diagnostic: expect.stringContaining("invalid media ID") });
    await expect(validateGeneratedPageSource({ sourceCode: `export default function Page(){return <main/>}`, ...context, declaredMediaIds: [mediaId] })).rejects.toMatchObject({ diagnostic: expect.stringContaining("declared Media") });
  });
});
