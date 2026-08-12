import { DomainError } from "@/domain/shared/errors";
import { ProjectAccessService } from "@/server/permissions/project-access";
import { DEFAULT_THEME } from "./defaults";
import { resolveProjectDesignTokens } from "./resolver";
import { brandSettingsSchema, resetThemeSchema, themeSettingsSchema, updateBrandSchema, updateThemeSchema } from "./schemas";
import { BrandRepository, ThemeRepository } from "./repositories";

export class BrandService {
  constructor(private readonly repository = new BrandRepository(), private readonly access = new ProjectAccessService()) {}

  async read(userId: string, projectId: string) {
    const { project } = await this.access.requireProjectAccess(userId, projectId);
    const record = await this.repository.find(projectId) ?? await this.repository.ensure(projectId, project.name);
    if (!record) throw new DomainError("NOT_FOUND", "Brand settings could not be initialized.");
    const parsed = brandSettingsSchema.safeParse({ companyName: record.companyName, companyDescription: record.companyDescription ?? "", brandNotes: record.brandNotes ?? "" });
    if (!parsed.success) {
      console.error("Invalid project brand settings; using safe identity fallback.", { projectId, issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
      return { ...record, companyName: project.name, companyDescription: null, brandNotes: null };
    }
    return { ...record, ...parsed.data };
  }

  async update(userId: string, input: unknown) {
    const parsed = updateBrandSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const record = await this.repository.update(parsed.projectId, parsed.expectedRevision, parsed.brand);
    if (!record) throw new DomainError("CONFLICT", "These brand settings changed elsewhere. Your latest edits will be retried.");
    return record;
  }
}

export class ThemeService {
  constructor(private readonly repository = new ThemeRepository(), private readonly access = new ProjectAccessService()) {}

  async read(userId: string, projectId: string) {
    await this.access.requireProjectAccess(userId, projectId);
    const record = await this.repository.find(projectId) ?? await this.repository.ensure(projectId);
    if (!record) throw new DomainError("NOT_FOUND", "Theme settings could not be initialized.");
    const theme = themeSettingsSchema.safeParse({
      lightTokens: record.lightTokens, darkTokens: record.darkTokens, radiusScale: record.radiusScale,
      spacingScale: record.spacingScale, shadowScale: record.shadowScale, fontScale: record.fontScale, borderScale: record.borderScale,
    });
    if (!theme.success) {
      console.error("Invalid project theme settings; using safe theme fallback.", { projectId, issues: theme.error.issues.map((issue) => issue.path.join(".")) });
      return { projectId, ...DEFAULT_THEME, revision: record.revision, resolvedDesignTokens: resolveProjectDesignTokens(DEFAULT_THEME), recoveredFromInvalidState: true as const };
    }
    return { projectId, ...theme.data, revision: record.revision, resolvedDesignTokens: resolveProjectDesignTokens(theme.data) };
  }

  async update(userId: string, input: unknown) {
    const parsed = updateThemeSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const record = await this.repository.update(parsed.projectId, parsed.expectedRevision, parsed.theme);
    if (!record) throw new DomainError("CONFLICT", "This theme changed elsewhere. Your latest edits will be retried.");
    const theme = themeSettingsSchema.parse({ lightTokens: record.lightTokens, darkTokens: record.darkTokens, radiusScale: record.radiusScale, spacingScale: record.spacingScale, shadowScale: record.shadowScale, fontScale: record.fontScale, borderScale: record.borderScale });
    return { ...theme, revision: record.revision, resolvedDesignTokens: resolveProjectDesignTokens(theme) };
  }

  async reset(userId: string, input: unknown) {
    const parsed = resetThemeSchema.parse(input);
    await this.access.requireProjectAccess(userId, parsed.projectId);
    const record = await this.repository.update(parsed.projectId, parsed.expectedRevision, DEFAULT_THEME);
    if (!record) throw new DomainError("CONFLICT", "This theme changed elsewhere. Refresh before resetting it.");
    return { ...DEFAULT_THEME, revision: record.revision, resolvedDesignTokens: resolveProjectDesignTokens(DEFAULT_THEME) };
  }
}

export async function getProjectDesignSystem(userId: string, projectId: string) {
  const [brand, theme] = await Promise.all([new BrandService().read(userId, projectId), new ThemeService().read(userId, projectId)]);
  return { brand, theme, resolvedDesignTokens: theme.resolvedDesignTokens };
}
