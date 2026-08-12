import { notFound } from "next/navigation";
import { ProjectNav } from "@/components/projects/project-nav";
import { BrandLogoSettings } from "@/components/media/brand-logo-settings";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { PageHeader } from "@/components/ui/page-header";
import { ProjectService } from "@/domain/projects/service";
import { BrandService, ThemeService } from "@/domain/theme/services";
import { requireAuthenticatedUser } from "@/server/auth/session";
import { MediaService } from "@/domain/media/service";

export default async function BrandThemePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const user = await requireAuthenticatedUser();
  let project;
  let brand;
  let theme;
  let media;
  try {
    [project, brand, theme, media] = await Promise.all([new ProjectService().read(user.id, projectId), new BrandService().read(user.id, projectId), new ThemeService().read(user.id, projectId), new MediaService().list(user.id, { projectId })]);
  } catch { notFound(); }
  return <><PageHeader eyebrow={project.name} title="Brand / Theme" description="Define the shared visual identity used throughout this website." /><ProjectNav projectId={project.id} /><div className="brand-page-stack"><BrandLogoSettings projectId={project.id} assets={media.assets} folders={media.folders} initialPrimaryId={brand.primaryLogoMediaId} initialAlternateId={brand.alternateLogoMediaId} /><ThemeEditor projectId={project.id} initialBrand={{ companyName: brand.companyName, companyDescription: brand.companyDescription, brandNotes: brand.brandNotes, revision: brand.revision }} initialTheme={{ lightTokens: theme.lightTokens, darkTokens: theme.darkTokens, radiusScale: theme.radiusScale, spacingScale: theme.spacingScale, shadowScale: theme.shadowScale, fontScale: theme.fontScale, borderScale: theme.borderScale, revision: theme.revision }} recoveredFromInvalidState={"recoveredFromInvalidState" in theme} /></div></>;
}
