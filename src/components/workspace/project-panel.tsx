import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronRight, Package, ShieldCheck, Sparkles, UserRound, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { BlockLibrary } from "@/components/blocks/block-library";
import { InviteManager } from "@/components/collaboration/invite-manager";
import { MemberList } from "@/components/collaboration/member-list";
import { ExportManager } from "@/components/export/export-manager";
import { BrandLogoSettings } from "@/components/media/brand-logo-settings";
import { MediaManager } from "@/components/media/media-manager";
import { PageSettingsEditor } from "@/components/pages/page-tree-manager";
import { ProjectInstructionsEditor } from "@/components/projects/project-instructions-editor";
import { RenameProjectDialog } from "@/components/projects/project-forms";
import { ThemeEditor } from "@/components/theme/theme-editor";
import { InlineAlert } from "@/components/ui/feedback";
import { Section } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { PanelLink } from "@/components/workspace/panel-link";
import { PanelSection } from "@/components/workspace/panel-section";
import { type PanelName } from "@/components/workspace/panel-names";
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
import { WORKSPACE_SHORTCUTS } from "@/domain/commands/registry";

export type PanelView = { title: string; description?: string; size: "wide" | "drawer"; actions?: ReactNode; body: ReactNode };

/**
 * Resolves a panel name to its heading and content, fetching only that panel's
 * data. It is called from the project page for whatever `?tool=` names, so a
 * tool opened from the menu bar, from a bookmark, or after a reload is always
 * the same render over the same workspace.
 */
export async function resolvePanel(projectId: string, name: PanelName, options: { nodeId?: string; blockId?: string; assetId?: string; section?: string } = {}): Promise<PanelView> {
  const user = await requireAuthenticatedUser();

  if (name === "shortcuts") {
    return { title: "Keyboard shortcuts", size: "drawer", body: <Shortcuts /> };
  }

  if (name === "overview") {
    let access;
    try { access = await new ProjectService().readWithRole(user.id, projectId); } catch { notFound(); }
    const { project, role, owner } = access;
    return {
      title: "Website settings",
      // Only says "add one" where adding one is possible: the description is
      // set when the website is created, and nothing here edits it.
      description: project.description || "No description yet.",
      size: "drawer",
      actions: role === "owner" ? <RenameProjectDialog id={project.id} name={project.name} /> : undefined,
      body: <>
        <Section title="This website">
          <dl className="detail-list">
            <div><dt><ShieldCheck size={14} />Status</dt><dd><StatusBadge status={project.status} /></dd></div>
            <div><dt><UserRound size={14} />Owner</dt><dd>{owner.displayName}</dd></div>
            <div><dt><UsersRound size={14} />Your role</dt><dd style={{ textTransform: "capitalize" }}>{role}</dd></div>
            <div><dt><CalendarDays size={14} />Created</dt><dd>{project.createdAt.toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" })}</dd></div>
          </dl>
        </Section>
        <Section title="Settings for this website">
          <nav className="destination-list" aria-label="Website settings">
            <PanelLink tool="settings" className="destination"><Sparkles size={16} /><span><strong>Agent guidance</strong><small>What the agent should always know</small></span><ChevronRight size={15} /></PanelLink>
            <PanelLink tool="collaborators" className="destination"><UsersRound size={16} /><span><strong>Collaborators</strong><small>Who else can work on this website</small></span><ChevronRight size={15} /></PanelLink>
            <PanelLink tool="export" className="destination"><Package size={16} /><span><strong>Export website</strong><small>Check it, build it, download the ZIP</small></span><ChevronRight size={15} /></PanelLink>
          </nav>
        </Section>
      </>,
    };
  }

  if (name === "pages") {
    let project; let nodes;
    try { [project, nodes] = await Promise.all([new ProjectService().read(user.id, projectId), new PageTreeService().listTree(user.id, projectId)]); } catch { notFound(); }
    const node = options.nodeId ? nodes.find((item) => item.id === options.nodeId) : undefined;
    return { title: node?.type === "folder" ? "Folder settings" : "Page settings", description: node ? `The address, title and description for ${node.name}.` : "Pick a page or folder in the Website sidebar to edit its details.", size: "drawer", body: node ? <PageSettingsEditor projectId={project.id} node={node} nodes={nodes} /> : <EmptyState title="No page chosen" description="Close this and pick a page or folder in the Website sidebar to edit its details." /> };
  }

  if (name === "media") {
    let project; let library;
    try { [project, library] = await Promise.all([new ProjectService().read(user.id, projectId), new MediaService().list(user.id, { projectId })]); } catch { notFound(); }
    return {
      title: "Images",
      description: "Upload and organize the images this website can use.",
      size: "wide",
      body: <MediaManager projectId={project.id} initialFolders={library.folders} initialAssets={library.assets} initialAssetId={options.assetId} />,
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
      description: "Navigation bars, footers, cards and other sections you can use on many pages at once.",
      size: "wide",
      body: <BlockLibrary projectId={project.id} initialBlocks={blocks} initialBlockId={options.blockId} initialSession={session} initialPreviewError={previewError} initialInstanceId={randomUUID()} mediaAssets={media.assets} mediaFolders={media.folders} />,
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
      title: "Brand and design",
      description: "The logo, colours, type and spacing shared by every page of this website.",
      size: "wide",
      body: <div className="brand-page-stack">
        <PanelSection focus={options.section === "identity"} />
        <BrandLogoSettings projectId={project.id} assets={media.assets} folders={media.folders} initialPrimaryId={brand.primaryLogoMediaId} initialAlternateId={brand.alternateLogoMediaId} />
        <PanelSection focus={options.section === "theme"} />
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
      description: "Who can open this website, and how to invite more people.",
      size: "drawer",
      body: <div className="collaboration-layout">
        {access.role === "owner"
          ? <Section title="Invite by link" description="Share a link with someone to give them access to this website.">
              <InviteManager projectId={project.id} currentInvite={currentInvite ? { id: currentInvite.id, expiresAt: currentInvite.expiresAt.toISOString() } : undefined} />
            </Section>
          : <InlineAlert tone="info" title="You are a collaborator here">You can work on this website. Only its owner can invite or remove people.</InlineAlert>}
        <Section title="People with access" description={people.collaborators.length ? undefined : "Only you, so far."}>
          <MemberList projectId={project.id} owner={people.owner} collaborators={people.collaborators} canManage={access.role === "owner"} />
        </Section>
      </div>,
    };
  }

  // settings
  let project; let instructions;
  try { [project, instructions] = await Promise.all([new ProjectService().read(user.id, projectId), new ProjectInstructionService().read(user.id, projectId)]); } catch { notFound(); }
  return {
    title: "Agent guidance",
    description: "Standing instructions the agent follows on every change to this website.",
    size: "drawer",
    body: <ProjectInstructionsEditor projectId={project.id} initialContent={instructions.content} initialRevision={instructions.revisionNumber} />,
  };
}

function Shortcuts() {
  return <div className="ws-keys">
    <section>
      <h2>Workspace</h2>
      {WORKSPACE_SHORTCUTS.map((item) => <div key={item.id}><span>{item.label}</span><kbd>{item.shortcut}</kbd></div>)}
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
