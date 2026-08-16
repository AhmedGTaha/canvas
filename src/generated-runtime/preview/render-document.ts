import { projectPreviewManifestSchema, type ProjectPreviewManifest } from "../manifest/schema";
import { GENERATED_RUNTIME_CSS, generatedThemeCss } from "./runtime-css";

function serialized(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"); }

/** One composed generated document, ready to be placed in the Preview frame. */
export type PreviewGeneratedContent = { html: string; css: string; js: string };

/**
 * The generated document is written into the Preview response by the server rather than
 * built by the frame's own script. There is no compile step to wait for and no bundle to
 * execute: the markup is already the validated, canonically re-serialized HTML, so the
 * frame paints it directly and the only script that runs is the Preview runtime plus
 * whatever behaviour the document itself declared.
 */
export function renderPreviewDocument(input: { manifest: ProjectPreviewManifest; nonce: string; parentOrigin: string; instanceId: string; initialRoute: string; initialMode: "light" | "dark"; generated?: PreviewGeneratedContent }) {
  const manifest = projectPreviewManifestSchema.parse(input.manifest);
  const config = serialized({ manifest, parentOrigin: new URL(input.parentOrigin).origin, instanceId: input.instanceId, initialRoute: input.initialRoute, initialMode: input.initialMode, generated: Boolean(input.generated) });
  const generatedRoot = input.generated ? `<div id="generated-root" class="generated-page-root">${input.generated.html}</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(manifest.brand.companyName)} preview</title><style nonce="${input.nonce}">${runtimeCss}${generatedRuntimeCss}${selectionCss}${manifestThemeCss(manifest)}${input.generated?.css ?? ""}</style></head><body><div id="preview-root" aria-live="polite">${generatedRoot}</div><script nonce="${input.nonce}">"use strict";(()=>{const config=${config};const manifest=config.manifest;const sessionId=manifest.previewSessionId;let route=normalize(config.initialRoute),mode=config.initialMode;const root=document.getElementById("preview-root");
const valid=manifest&&manifest.manifestVersion===1&&manifest.projectId&&manifest.routes&&Array.isArray(manifest.pages)&&manifest.theme&&manifest.media;if(!valid)throw new Error("Invalid preview manifest");
function normalize(value){try{const path=new URL(value,"https://preview.invalid").pathname.replace(/\\/{2,}/g,"/");return path.length>1?path.replace(/\\/$/,""):"/"}catch{return"/"}}
function send(message){parent.postMessage({...message,sessionId,instanceId:config.instanceId},config.parentOrigin)}
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
function media(id){return id?manifest.media[id]||null:null}
function logo(){return media(manifest.brand.logoMediaIds[mode])}
function navItems(items,container){items.forEach(item=>{if(item.type==="group"){const details=el("details","nav-group");const summary=el("summary",null,item.label);details.append(summary);const group=el("div","nav-children");navItems(item.children,group);details.append(group);container.append(details)}else{const link=el("a",route===item.route?"active":"",item.label);link.href=item.route;link.dataset.route=item.route;container.append(link);if(item.children.length){const children=el("div","nav-children");navItems(item.children,children);container.append(children)}}})}
function applyTheme(){document.documentElement.dataset.theme=mode}
function render(){applyTheme();const resolved=manifest.routes[route];const page=resolved?manifest.pages.find(item=>item.pageId===resolved.pageId):null;
// A generated document is already in the response. Only the unbuilt placeholder and the
// 404 state are constructed here, and only when there is nothing to leave alone.
if(!config.generated){root.replaceChildren();const shell=el("div","site-shell");const header=el("header","site-header");const brand=el("div","site-brand");const currentLogo=logo();if(currentLogo){const image=document.createElement("img");image.src=currentLogo.previewUrl;image.alt=currentLogo.altText||manifest.brand.companyName;brand.append(image)}else brand.append(el("strong",null,manifest.brand.companyName));header.append(brand);const nav=el("nav","site-nav");nav.setAttribute("aria-label","Website navigation");navItems(manifest.navigation,nav);header.append(nav);shell.append(header);const main=el("main","site-main");if(page){main.dataset.canvasId="preview:"+page.pageId+":placeholder-root";main.append(el("span","site-kicker","Website preview"),el("h1",null,page.name),el("p","site-lead","This page is ready to be built. Canvas will display your website content here when it is ready."));const routeLabel=el("p","route-label","Page route: "+page.canonicalRoute);main.append(routeLabel);const cards=el("section","sample-grid");cards.append(sample("Project theme","Your colors, spacing, typography, borders, and shadows are active."),sample("Responsive layout","Switch Canvas device modes to see this page adapt."));main.append(cards)}else{main.append(el("span","site-kicker","404"),el("h1",null,"Page not found"),el("p","site-lead","This route is not part of the current project preview."))}shell.append(main);root.append(shell)}
send({type:"CANVAS_ROUTE_CHANGED",route,pageId:page?page.pageId:null})}
function sample(title,body){const card=el("article","sample-card");card.append(el("h2",null,title),el("p",null,body));return card}
function currentPageId(){return manifest.routes[route]?manifest.routes[route].pageId:null}
${selectionRuntimeScript("null")}
function navigate(next){const normalized=normalize(next);if(normalized===route)return;send({type:"CANVAS_ROUTE_CHANGED",route:normalized,pageId:manifest.routes[normalized]?.pageId||null});const url=new URL(location.href);url.searchParams.set("route",normalized);location.replace(url.href)}
document.addEventListener("click",event=>{const link=event.target.closest("a[href]");if(!link)return;const href=link.getAttribute("href");if(!href||href.startsWith("#"))return;if(href.startsWith("/")&&manifest.routes[normalize(href)]){event.preventDefault();navigate(href)}});
addEventListener("message",event=>{if(event.origin!==config.parentOrigin)return;const data=event.data;if(!data||data.sessionId!==sessionId||data.instanceId!==config.instanceId)return;if(handleSelectionMessage(data))return;if(data.type==="CANVAS_NAVIGATE"&&typeof data.route==="string")navigate(data.route);else if(data.type==="CANVAS_SET_THEME"&&(data.mode==="light"||data.mode==="dark")){mode=data.mode;applyTheme()}else if(data.type==="CANVAS_REFRESH")location.reload()});
function previewRoute(){return route}
function previewDetail(event){try{const error=event&&event.error;const parts=[];if(event&&event.message)parts.push(String(event.message));else if(error&&error.message)parts.push(String(error.message));if(event&&event.lineno)parts.push("line "+event.lineno);const text=parts.join(" @ ")||"unknown error";return text.replace(/https?:\\/\\/[^\\s)]+/g,"[url]").slice(0,180)}catch{return"unknown error"}}
function reportPreviewFailure(detail){send({type:"CANVAS_PREVIEW_ERROR",code:"RUNTIME_ERROR",route:previewRoute(),pageId:currentPageId(),message:"This part of your website could not be displayed.",detail})}
addEventListener("error",event=>reportPreviewFailure(previewDetail(event)));
addEventListener("unhandledrejection",event=>{const reason=event&&event.reason;reportPreviewFailure(previewDetail({message:reason&&reason.message?reason.message:String(reason)}))});render();send({type:"CANVAS_PREVIEW_READY",route})})()</script>${generatedScript(input.nonce, input.generated)}</body></html>`;
}

/**
 * Standalone Building Block preview. Reuses the same opaque-origin sandbox, CSP, nonce,
 * theme tokens, and Media resolution as the page preview: the block simply renders
 * inside a neutral project-theme canvas instead of a routed page.
 */
export function renderBlockPreviewDocument(input: { manifest: ProjectPreviewManifest; nonce: string; parentOrigin: string; instanceId: string; initialMode: "light" | "dark"; block: { id: string; name: string; contentStatus: "unbuilt" | "generated" }; generated?: PreviewGeneratedContent }) {
  const manifest = projectPreviewManifestSchema.parse(input.manifest);
  const config = serialized({ manifest, parentOrigin: new URL(input.parentOrigin).origin, instanceId: input.instanceId, initialMode: input.initialMode, block: input.block, generated: Boolean(input.generated) });
  const generatedRoot = input.generated ? `<div class="block-canvas"><div id="generated-root" class="generated-page-root block-surface">${input.generated.html}</div></div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.block.name)} preview</title><style nonce="${input.nonce}">${runtimeCss}${generatedRuntimeCss}${blockPreviewCss}${selectionCss}${manifestThemeCss(manifest)}${input.generated?.css ?? ""}</style></head><body><div id="preview-root" aria-live="polite">${generatedRoot}</div><script nonce="${input.nonce}">"use strict";(()=>{const config=${config};const manifest=config.manifest;const sessionId=manifest.previewSessionId;const root=document.getElementById("preview-root");let mode=config.initialMode;
const valid=manifest&&manifest.manifestVersion===1&&manifest.projectId&&manifest.theme&&manifest.media;if(!valid)throw new Error("Invalid preview manifest");
function send(message){parent.postMessage({...message,sessionId,instanceId:config.instanceId},config.parentOrigin)}
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node}
function currentPageId(){return null}
${selectionRuntimeScript("config.block.id")}
function render(){document.documentElement.dataset.theme=mode;if(config.generated)return;root.replaceChildren();const canvas=el("div","block-canvas");const empty=el("div","block-empty");empty.append(el("span","site-kicker","Building Block"),el("h1",null,config.block.name),el("p","site-lead","Describe this block and Canvas will create it."));canvas.append(empty);root.append(canvas)}
document.addEventListener("click",event=>{const link=event.target.closest("a[href]");if(link)event.preventDefault()});
addEventListener("message",event=>{if(event.origin!==config.parentOrigin)return;const data=event.data;if(!data||data.sessionId!==sessionId||data.instanceId!==config.instanceId)return;if(handleSelectionMessage(data))return;if(data.type==="CANVAS_SET_THEME"&&(data.mode==="light"||data.mode==="dark")){mode=data.mode;document.documentElement.dataset.theme=mode}else if(data.type==="CANVAS_REFRESH")location.reload()});
function previewRoute(){return "/"}
function previewDetail(event){try{const error=event&&event.error;const parts=[];if(event&&event.message)parts.push(String(event.message));else if(error&&error.message)parts.push(String(error.message));if(event&&event.lineno)parts.push("line "+event.lineno);const text=parts.join(" @ ")||"unknown error";return text.replace(/https?:\\/\\/[^\\s)]+/g,"[url]").slice(0,180)}catch{return"unknown error"}}
function reportPreviewFailure(detail){send({type:"CANVAS_PREVIEW_ERROR",code:"RUNTIME_ERROR",route:previewRoute(),pageId:currentPageId(),message:"This part of your website could not be displayed.",detail})}
addEventListener("error",event=>reportPreviewFailure(previewDetail(event)));
addEventListener("unhandledrejection",event=>{const reason=event&&event.reason;reportPreviewFailure(previewDetail({message:reason&&reason.message?reason.message:String(reason)}))});render();send({type:"CANVAS_PREVIEW_READY",route:"/"})})()</script>${generatedScript(input.nonce, input.generated)}</body></html>`;
}

/**
 * The document's own behaviour, last and separate.
 *
 * It runs under the same nonce CSP as the Preview runtime — there is no `unsafe-inline`
 * and no relaxed `script-src` anywhere in this response — and it has already been through
 * the JavaScript validator and been wrapped in a scope whose parameters shadow the
 * globals that could leave the frame.
 */
function generatedScript(nonce: string, generated?: PreviewGeneratedContent) {
  if (!generated?.js.trim()) return "";
  return `<script nonce="${nonce}">${safeScript(generated.js)}</script>`;
}

const blockPreviewCss = `.block-canvas{min-height:100vh;padding:0;background:var(--color-background)}.block-surface{min-height:100vh}.block-empty{display:grid;align-content:center;justify-items:start;gap:var(--space-sm);min-height:60vh;padding:clamp(24px,6vw,64px)}.block-empty h1{margin:0;font-size:clamp(1.5rem,4vw,2.25rem)}`;


/**
 * Selection runtime shared by the page and Building Block Preview documents. It runs
 * inside the opaque-origin sandbox under the same nonce-based CSP: it reads only
 * data-canvas-* attributes and posts a fixed, minimal message shape to Canvas.
 */
function selectionRuntimeScript(ownerBlockExpression: string) {
  return `const selection={mode:false,current:null};const ownerBlockId=${ownerBlockExpression};
function selectable(node){return node&&node.closest?node.closest("#generated-root [data-canvas-id]"):null}
function ownerOf(node){const host=node.closest("[data-canvas-block]");return host?{blockId:host.getAttribute("data-canvas-block")||null,usageKey:host.getAttribute("data-canvas-usage")||null}:{blockId:ownerBlockId,usageKey:null}}
function clearHover(){document.querySelectorAll("[data-canvas-hover]").forEach(node=>node.removeAttribute("data-canvas-hover"))}
function clearMarks(){document.querySelectorAll("[data-canvas-selected]").forEach(node=>node.removeAttribute("data-canvas-selected"))}
function emitSelected(node,owner){send({type:"CANVAS_ELEMENT_SELECTED",canvasId:node.getAttribute("data-canvas-id"),elementType:node.tagName.toLowerCase(),label:node.getAttribute("data-canvas-label")||null,blockId:owner.blockId,usageKey:owner.usageKey,pageId:currentPageId()})}
function selectNode(node,emit){const owner=ownerOf(node);clearMarks();node.setAttribute("data-canvas-selected","");selection.current={canvasId:node.getAttribute("data-canvas-id"),blockId:owner.blockId};if(emit)emitSelected(node,owner)}
function clearSelection(emit){clearMarks();selection.current=null;if(emit)send({type:"CANVAS_ELEMENT_CLEARED"})}
function setSelectMode(enabled){selection.mode=Boolean(enabled);document.documentElement.dataset.selectMode=selection.mode?"on":"off";if(!selection.mode)clearHover()}
function applySelection(canvasId,blockId,attempt){let found=null;document.querySelectorAll("#generated-root [data-canvas-id]").forEach(node=>{if(found||node.getAttribute("data-canvas-id")!==canvasId)return;if((ownerOf(node).blockId||null)!==(blockId||null))return;found=node});
if(found){selectNode(found,true);return}
if((attempt||0)<24){requestAnimationFrame(()=>applySelection(canvasId,blockId,(attempt||0)+1));return}
clearSelection(true)}
document.addEventListener("mouseover",event=>{if(!selection.mode)return;clearHover();const node=selectable(event.target);if(node)node.setAttribute("data-canvas-hover","")});
document.addEventListener("mouseleave",()=>clearHover());
document.addEventListener("click",event=>{if(!selection.mode)return;const node=selectable(event.target);if(!node)return;event.preventDefault();event.stopPropagation();selectNode(node,true)},true);
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&selection.current)clearSelection(true)});
function handleSelectionMessage(data){if(data.type==="CANVAS_SET_SELECT_MODE"){setSelectMode(data.enabled);return true}if(data.type==="CANVAS_SELECT_ELEMENT"&&typeof data.canvasId==="string"){applySelection(data.canvasId,data.blockId||null,0);return true}if(data.type==="CANVAS_CLEAR_SELECTION"){clearSelection(false);return true}return false}`;
}

const selectionCss = `.canvas-block-host{display:contents}#generated-root [data-canvas-hover]{outline:2px dashed var(--color-accent);outline-offset:2px}#generated-root [data-canvas-selected]{outline:2px solid var(--color-accent);outline-offset:2px}html[data-select-mode=on] #generated-root [data-canvas-id]{cursor:pointer}`;

/**
 * Rendered when the Preview route itself fails. It states the normalized reason in plain
 * language instead of a generic failure, under the same CSP as every other Preview
 * response, and contains no markup supplied by generated code.
 */
export function renderPreviewErrorDocument(input: {
  nonce: string;
  message: string;
  diagnostic?: { code: string; sessionId: string; instanceId: string; parentOrigin: string; route: string; pageId: string | null };
}) {
  const code = input.diagnostic?.code;
  const script = input.diagnostic
    ? `<script nonce="${input.nonce}">parent.postMessage(${serialized({ type: "CANVAS_PREVIEW_ERROR", sessionId: input.diagnostic.sessionId, instanceId: input.diagnostic.instanceId, code: input.diagnostic.code, route: input.diagnostic.route, pageId: input.diagnostic.pageId, message: input.message })},${serialized(new URL(input.diagnostic.parentOrigin).origin)})</script>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title><style nonce="${input.nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;color:#27272a;font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.error{max-width:420px;padding:28px;text-align:center}.error h1{margin:0 0 8px;font-size:16px}.error p{margin:0;color:#6b7280}.error code{display:inline-block;margin-top:10px;color:#52525b;font-size:12px}</style></head><body><div class="error" role="alert"><h1>Preview unavailable</h1><p>${escapeHtml(input.message)}</p>${code ? `<code>${escapeHtml(code)}</code>` : ""}</div>${script}</body></html>`;
}

function safeScript(value: string) { return value.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--"); }

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]!); }

function manifestThemeCss(manifest: ProjectPreviewManifest) { return generatedThemeCss(manifest.theme); }

const generatedRuntimeCss = GENERATED_RUNTIME_CSS;

const runtimeCss = `:root{color-scheme:light dark;--color-background:#fff;--color-surface:#f8fafc;--color-text:#111827;--color-muted-text:#6b7280;--color-primary:#111827;--color-secondary:#64748b;--color-accent:#2563eb;--color-border:#e5e7eb;--radius-md:10px;--radius-lg:16px;--space-sm:8px;--space-md:16px;--space-lg:24px;--space-xl:40px;--shadow-sm:none;--shadow-md:none;--body-size:16px;--heading-size:36px;--border-width:1px}*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--color-background);color:var(--color-text);font:var(--body-size)/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.site-shell{min-height:100vh}.site-header{min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:var(--space-lg);padding:var(--space-md) clamp(var(--space-md),5vw,var(--space-xl));border-bottom:var(--border-width) solid var(--color-border);background:var(--color-surface)}.site-brand{display:flex;align-items:center;min-width:120px;color:var(--color-primary)}.site-brand img{display:block;max-width:150px;max-height:44px;object-fit:contain}.site-nav{display:flex;align-items:center;justify-content:flex-end;gap:var(--space-md);flex-wrap:wrap}.site-nav a,.nav-group summary{color:var(--color-secondary);font-size:.85em;font-weight:650;text-decoration:none;cursor:pointer}.site-nav a:hover,.site-nav a.active{color:var(--color-accent)}.nav-group{position:relative}.nav-group summary{list-style:none}.nav-group summary::-webkit-details-marker{display:none}.nav-group>.nav-children{position:absolute;right:0;z-index:2;min-width:170px;display:grid;gap:8px;padding:12px;border:var(--border-width) solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);box-shadow:var(--shadow-md)}.site-nav>.nav-children{display:flex;gap:var(--space-sm)}.site-main{width:min(1040px,100%);margin:0 auto;padding:clamp(56px,10vw,120px) clamp(var(--space-md),6vw,var(--space-xl))}.site-kicker{display:inline-block;margin-bottom:var(--space-sm);color:var(--color-accent);font-size:.72em;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.site-main h1{max-width:760px;margin:0 0 var(--space-md);font-size:clamp(2rem,var(--heading-size),4rem);line-height:1.05;letter-spacing:-.04em}.site-lead{max-width:680px;margin:0 0 var(--space-md);color:var(--color-muted-text);font-size:1.08em}.route-label{display:inline-flex;padding:7px 10px;border:var(--border-width) solid var(--color-border);border-radius:var(--radius-md);color:var(--color-secondary);font-size:.75em}.sample-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-md);margin-top:var(--space-xl)}.sample-card{padding:var(--space-lg);border:var(--border-width) solid var(--color-border);border-radius:var(--radius-lg);background:var(--color-surface);box-shadow:var(--shadow-sm)}.sample-card h2{margin:0 0 var(--space-sm);font-size:1em}.sample-card p{margin:0;color:var(--color-muted-text);font-size:.82em}@media(max-width:640px){.site-header{align-items:flex-start;flex-direction:column}.site-nav{justify-content:flex-start}.site-main{padding-top:56px}.sample-grid{grid-template-columns:1fr}.nav-group>.nav-children{position:static;margin-top:8px}}`;
