import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { BlockLibrary } from "@/components/blocks/block-library";
import { InviteManager } from "@/components/collaboration/invite-manager";
import { MemberList } from "@/components/collaboration/member-list";
import { ExportManager } from "@/components/export/export-manager";
import { BrandLogoSettings } from "@/components/media/brand-logo-settings";
import { MediaManager } from "@/components/media/media-manager";
import { PageTreeManager } from "@/components/pages/page-tree-manager";
import { ProjectInstructionsEditor } from "@/components/projects/project-instructions-editor";
import { RenameProjectDialog } from "@/components/projects/project-forms";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProjectInstructionService } from "@/domain/ai/instruction-service";
import { BuildingBlockService } from "@/domain/blocks/service";
import { InvitationService } from "@/domain/collaboration/invitation-service";
import { MembershipService } from "@/domain/collaboration/membership-service";
import { MediaService } from "@/domain/media/service";
import { PageTreeService } from "@/domain/pages/service";
import { ProjectService } from "@/domain/projects/service";
import { BrandService, ThemeService } from "@/domain/theme/services";
import { PreviewManifestService } from "@/generated-runtime/manifest/service";
import { previewUnavailableMessage } from "@/generated-runtime/preview/errors";
import { requireAuthenticatedUser } from "@/server/auth/session";

/** Every project tool reachable from the workspace menu bar. */
export const PANEL_NAMES = ["overview", "pages", "media", "blocks", "brand", "export", "collaborators", "settings", "shortcuts"] as const;
export type PanelName = (typeof PANEL_NAMES)[number];

export function isPanelName(value: string): value is PanelName {
  return (PANEL_NAMES as readonly string[]).includes(value);
}

export type PanelView = { title: string; description?: string; size: "wide" | "drawer"; actions?: ReactNode; body: ReactNode };

/**
 * Resolves a panel name to its heading and content, fetching only that panel's
 * data. The same resolver serves the overlay (soft navigation from the menu
 * bar) and the standalone page (a bookmarked deep link), so the two can never
 * drift apart.
 */
export async function resolvePanel(projectId: string, name: PanelName): Promise<PanelView> {
  const user = await requireAuthenticatedUser();

  if (name === "shortcuts") {
    return { title: "Keyboard shortcuts", size: "drawer", body: <Shortcuts /> };
  }

  if (name === "overview") {
    let access;
    try { access = await new ProjectService().readWithRole(user.id, projectId); } catch { notFound(); }
    const { project, role, owner } = access;
    return {
      title: project.name,
      description: project.description || "Add a description as this project takes shape.",
      size: "drawer",
      actions: role === "owner" ? <RenameProjectDialog id={project.id} name={project.name} /> : undefined,
      body: <Card>
        <dl className="detail-list">
          <div><dt><ShieldCheck size={15} />Status</dt><dd><StatusBadge status={project.status} /></dd></div>
          <div><dt><UserRound size={15} />Owner</dt><dd>{owner.displayName}</dd></div>
          <div><dt><UsersRound size={15} />Your role</dt><dd style={{ textTransform: "capitalize" }}>{role}</dd></div>
          <div><dt><CalendarDays size={15} />Created</dt><dd>{project.createdAt.toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" })}</dd></div>
        </dl>
      </Card>,
    };
  }

  if (name === "pages") {
    let project; let nodes;
    try { [project, nodes] = await Promise.all([new ProjectService().read(user.id, projectId), new PageTreeService().listTree(user.id, projectId)]); } catch { notFound(); }
    return {
      title: "Pages & folders",
      description: "Rename, reorder and set the web address of every page on this website.",
      size: "wide",
      body: <PageTreeManager projectId={project.id} nodes={nodes} />,
    };
  }

  if (name === "media") {
    let project; let library;
    try { [project, library] = await Promise.all([new ProjectService().read(user.id, projectId), new MediaService().list(user.id, { projectId })]); } catch { notFound(); }
    return {
      title: "Images",
      description: "Upload and organize the images this website can use.",
      size: "wide",
      body: <MediaManager projectId={project.id} initialFolders={library.folders} initialAssets={library.assets} />,
    };
  }

  if (name === "blocks") {
    let project; let blocks; let media;
    try {
      [project, blocks, media] = await Promise.all([
        new ProjectService().read(user.id, projectId),
        new BuildingBlockService().list(user.id, { projectId }),
        new MediaService().list(user.id, { projectId }),
      ]);
    } catch { notFound(); }
    let session = null;
    let previewError: string | undefined;
    try { session = await new PreviewManifestService().createSession(user.id, projectId); }
    catch (error) { session = null; previewError = previewUnavailableMessage(error); }
    return {
      title: "Reusable sections",
      description: "Navbars, footers, cards and other sections you can use on many pages at once.",
      size: "wide",
      body: <BlockLibrary projectId={project.id} initialBlocks={blocks} initialSession={session} initialPreviewError={previewError} initialInstanceId={randomUUID()} mediaAssets={media.assets} mediaFolders={media.folders} />,
    };
  }

  if (name === "brand") {
    let project; let brand; let theme; let media;
    try {
      [project, brand, theme, media] = await Promise.all([
        new ProjectService().read(user.id, projectId),
        new BrandService().read(user.id, projectId),
        new ThemeService().read(user.id, projectId),
        new MediaService().list(user.id, { projectId }),
      ]);
    } catch { notFound(); }
    return {
      title: "Brand & design",
      description: "The identity, colours, type and spacing shared by every page.",
      size: "wide",
      body: <div className="brand-page-stack">
        <BrandLogoSettings projectId={project.id} assets={media.assets} folders={media.folders} initialPrimaryId={brand.primaryLogoMediaId} initialAlternateId={brand.alternateLogoMediaId} />
        <ThemeEditor
          projectId={project.id}
          initialBrand={{ companyName: brand.companyName, companyDescription: brand.companyDescription, brandNotes: brand.brandNotes, revision: brand.revision }}
          initialTheme={{ lightTokens: theme.lightTokens, darkTokens: theme.darkTokens, radiusScale: theme.radiusScale, spacingScale: theme.spacingScale, shadowScale: theme.shadowScale, fontScale: theme.fontScale, borderScale: theme.borderScale, revision: theme.revision }}
          recoveredFromInvalidState={"recoveredFromInvalidState" in theme}
        />
      </div>,
    };
  }

  if (name === "export") {
    let project;
    try { project = await new ProjectService().read(user.id, projectId); } catch { notFound(); }
    return {
      title: "Export website",
      description: "Download this website as a project you can run and host yourself.",
      size: "drawer",
      body: <ExportManager projectId={project.id} />,
    };
  }

  if (name === "collaborators") {
    let project; let access; let people;
    try {
      [access, people] = await Promise.all([new ProjectService().readWithRole(user.id, projectId), new MembershipService().list(user.id, projectId)]);
      project = access.project;
    } catch { notFound(); }
    const currentInvite = access.role === "owner" ? await new InvitationService().current(user.id, project.id) : undefined;
    return {
      title: "Collaborators",
      description: "Who can open this project, and how to invite more people.",
      size: "drawer",
      body: <div className="collaboration-layout">
        {access.role === "owner"
          ? <Card><InviteManager projectId={project.id} currentInvite={currentInvite ? { id: currentInvite.id, expiresAt: currentInvite.expiresAt.toISOString() } : undefined} /></Card>
          : <Card className="notice-card"><UsersRound size={20} /><div><h2>Shared project</h2><p>You can work on this project. Only its owner can invite or remove people.</p></div></Card>}
        <Card>
          <div className="section-heading"><div><p className="eyebrow">Access</p><h2>People with access</h2></div></div>
          <MemberList projectId={project.id} owner={people.owner} collaborators={people.collaborators} canManage={access.role === "owner"} />
        </Card>
      </div>,
    };
  }

  // settings
  let project; let instructions;
  try { [project, instructions] = await Promise.all([new ProjectService().read(user.id, projectId), new ProjectInstructionService().read(user.id, projectId)]); } catch { notFound(); }
  return {
    title: "Project settings",
    description: "Guidance the agent should always follow on this website.",
    size: "drawer",
    body: <ProjectInstructionsEditor projectId={project.id} initialContent={instructions.content} initialRevision={instructions.revisionNumber} />,
  };
}

function Shortcuts() {
  return <div className="ws-keys">
    <section>
      <h2>Workspace</h2>
      <div><span>Show or hide the website explorer</span><kbd>Ctrl / ⌘ + B</kbd></div>
      <div><span>Show or hide the Website Agent</span><kbd>Ctrl / ⌘ + J</kbd></div>
      <div><span>Leave full screen</span><kbd>Esc</kbd></div>
      <div><span>Close a panel</span><kbd>Esc</kbd></div>
    </section>
    <section>
      <h2>Pages</h2>
      <div><span>Rename the selected page</span><kbd>F2</kbd></div>
      <div><span>Rename by double-click</span><kbd>Double-click a page</kbd></div>
      <div><span>Open or close a folder</span><kbd>Click the folder</kbd></div>
      <div><span>Confirm an inline rename</span><kbd>Enter</kbd></div>
      <div><span>Abandon an inline rename</span><kbd>Esc</kbd></div>
    </section>
    <section>
      <h2>Agent</h2>
      <div><span>Send your message</span><kbd>Enter</kbd></div>
      <div><span>Start a new line</span><kbd>Shift + Enter</kbd></div>
    </section>
    <section>
      <h2>Menus</h2>
      <div><span>Move between menus</span><kbd>← →</kbd></div>
      <div><span>Move through items</span><kbd>↑ ↓</kbd></div>
    </section>
  </div>;
}

/** Standalone rendering for a bookmarked panel URL, where there is no workspace
 *  underneath to overlay onto. */
export function StandalonePanel({ projectId, view }: { projectId: string; view: PanelView }) {
  return <div className="standalone-panel">
    <header className="standalone-panel-hd">
      <div>
        <h1>{view.title}</h1>
        {view.description ? <p>{view.description}</p> : null}
      </div>
      <div className="ws-panel-hd-acts">
        {view.actions}
        <Link href={`/projects/${projectId}`} className="button button-secondary">Back to the website</Link>
      </div>
    </header>
    <div className="standalone-panel-bd">{view.body}</div>
  </div>;
}
