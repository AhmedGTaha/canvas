import { createHash } from "node:crypto";
import { PageTreeService } from "@/domain/pages/service";
import { BrandService, ThemeService } from "@/domain/theme/services";
import { MediaService } from "@/domain/media/service";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { projectPreviewManifestSchema, type PreviewNavigationItem } from "./schema";
import { PreviewTokenService } from "../security/preview-token";

export class PreviewManifestService {
  constructor(private readonly access = new ProjectAccessService(), private readonly tokens = new PreviewTokenService()) {}

  async createSession(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const session = this.tokens.issue(projectId, userId);
    return { token: session.token, expiresAt: new Date(session.payload.expiresAt).toISOString(), manifest: await this.build(userId, projectId, session.payload.sessionId, session.token) };
  }

  async authorizeToken(token: string) {
    const payload = this.tokens.verify(token);
    await this.access.requireProjectAccess(payload.userId, payload.projectId);
    return payload;
  }

  async fromToken(token: string) {
    const payload = await this.authorizeToken(token);
    return { payload, manifest: await this.build(payload.userId, payload.projectId, payload.sessionId, token) };
  }

  private async build(userId: string, projectId: string, sessionId: string, token: string) {
    const [nodes, brand, theme, library] = await Promise.all([new PageTreeService().listTree(userId, projectId), new BrandService().read(userId, projectId), new ThemeService().read(userId, projectId), new MediaService().list(userId, { projectId })]);
    const pages = nodes.filter((node) => node.type === "page" && node.routePath).map((node) => ({ pageId: node.id, parentId: node.parentId, name: node.name, canonicalRoute: node.routePath!, isHomepage: node.isHomepage, seo: { title: node.pageTitle, description: node.metaDescription } }));
    const routes = Object.fromEntries(pages.map((page) => [page.canonicalRoute, { pageId: page.pageId, name: page.name }]));
    const byParent = (parentId: string | null): PreviewNavigationItem[] => nodes.filter((node) => node.parentId === parentId).sort((a, b) => Number(b.isHomepage) - Number(a.isHomepage) || a.position - b.position).map((node): PreviewNavigationItem => node.type === "folder" ? ({ type: "group", id: node.id, label: node.name, children: byParent(node.id) }) : ({ type: "page", id: node.id, label: node.name, route: node.routePath!, children: byParent(node.id) })).filter((item) => item.type === "page" || item.children.length > 0);
    const media = Object.fromEntries(library.assets.map((asset) => [asset.id, { id: asset.id, displayName: asset.displayName, mimeType: asset.mimeType, width: asset.width, height: asset.height, altText: asset.altText, previewUrl: `/api/preview/media/${asset.id}?token=${encodeURIComponent(token)}` }]));
    const primaryLogoMediaId = brand.primaryLogoMediaId && media[brand.primaryLogoMediaId] ? brand.primaryLogoMediaId : null;
    const alternateLogoMediaId = brand.alternateLogoMediaId && media[brand.alternateLogoMediaId] ? brand.alternateLogoMediaId : null;
    const relevantState = JSON.stringify({ pages: pages.map((page) => [page.pageId, page.canonicalRoute, page.name, page.seo]), brand: [brand.revision, brand.primaryLogoMediaId, brand.alternateLogoMediaId], theme: theme.revision, media: library.assets.map((asset) => [asset.id, asset.updatedAt.toISOString()]) });
    return projectPreviewManifestSchema.parse({ manifestVersion: 1, projectId, previewSessionId: sessionId, generatedAt: new Date().toISOString(), previewRevision: createHash("sha256").update(relevantState).digest("hex").slice(0, 20), homepage: pages.find((page) => page.isHomepage)?.pageId ?? null, routes, pages, brand: { companyName: brand.companyName, companyDescription: brand.companyDescription, primaryLogoMediaId, alternateLogoMediaId, logoMediaIds: { light: primaryLogoMediaId, dark: alternateLogoMediaId ?? primaryLogoMediaId } }, theme: theme.resolvedDesignTokens, media, navigation: byParent(null) });
  }
}
