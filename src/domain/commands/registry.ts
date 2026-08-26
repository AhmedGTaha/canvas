import type { WorkspaceCommand } from "./types";

export type WorkspaceCommandContext = {
  canManageProject: boolean; hasPage: boolean; hasSelection: boolean; activeWork: boolean;
  canUndo: boolean; canRedo: boolean; explorerOpen: boolean; agentOpen: boolean;
  openPanel: (name: string) => void; navigate: (href: string) => void;
  openPalette: () => void; openTasks: () => void; openHistory: () => void; openCheckpoints: () => void;
  openWebsite: () => void; newPage: () => void; newFolder: () => void; viewCode: () => void;
  openAssets: () => void; openDesign: () => void; openSections: () => void;
  toggleExplorer: () => void; toggleAgent: () => void; undo: () => void; redo: () => void;
  setTheme: (theme: "light" | "dark") => void; setDevice: (device: "desktop" | "tablet" | "mobile") => void;
  refreshPreview: () => void; toggleFullScreen: () => void; signOut: () => void;
};

export const WORKSPACE_SHORTCUTS = [
  { id: "navigation.palette", label: "Open the command palette", shortcut: "Ctrl / ⌘ + K" },
  { id: "navigation.explorer", label: "Show or hide the website sidebar", shortcut: "Ctrl / ⌘ + B" },
  { id: "agent.toggle", label: "Show or hide Canvas Agent", shortcut: "Ctrl / ⌘ + J" },
] as const;

const yes = { available: true } as const;
const no = (reason: string) => ({ available: false, reason });
const command = (value: Omit<WorkspaceCommand, "permitted" | "availability"> & Partial<Pick<WorkspaceCommand, "permitted" | "availability">>): WorkspaceCommand => ({ permitted: true, availability: yes, ...value });

/** WF-01: the single declarative source used by menus, shortcuts and palette. */
export function createWorkspaceCommands(c: WorkspaceCommandContext): WorkspaceCommand[] {
  const panel = (name: string) => () => c.openPanel(name);
  return [
    command({ id: "navigation.palette", label: "Open command palette", category: "Navigation", icon: "search", shortcut: WORKSPACE_SHORTCUTS[0].shortcut, run: c.openPalette, synonyms: ["search", "actions"] }),
    command({ id: "navigation.projects", label: "All websites", category: "Navigation", icon: "grid", target: "/dashboard", run: () => c.navigate("/dashboard"), synonyms: ["dashboard", "projects"] }),
    command({ id: "navigation.workspaces", label: "Workspaces", category: "Navigation", icon: "grid", target: "/workspaces", run: () => c.navigate("/workspaces") }),
    command({ id: "pages.manage", label: "Website structure", description: "Browse pages and folders", category: "Pages", icon: "tree", run: c.openWebsite, synonyms: ["pages", "folders", "routes", "slugs"] }),
    command({ id: "pages.new", label: "New page", description: "Create a page inline in Website", category: "Pages", icon: "file-plus", run: c.newPage }),
    command({ id: "pages.new-folder", label: "New folder", description: "Create a folder inline in Website", category: "Pages", icon: "folder-plus", run: c.newFolder }),
    command({ id: "assets.media", label: "Assets", description: "Browse and manage images", category: "Assets", icon: "images", run: c.openAssets, synonyms: ["media", "images", "uploads"] }),
    command({ id: "design.brand", label: "Design", description: "Edit brand, colours, type, and spacing", category: "Design", icon: "palette", run: c.openDesign, synonyms: ["brand", "logo", "colors", "colours", "fonts"] }),
    command({ id: "blocks.manage", label: "Reusable Sections", description: "Manage shared sections", category: "Reusable sections", icon: "blocks", run: c.openSections, synonyms: ["building blocks", "reusable", "shared", "components"] }),
    command({ id: "agent.toggle", label: c.agentOpen ? "Hide Canvas Agent" : "Show Canvas Agent", category: "Agent", icon: "panel-right", shortcut: WORKSPACE_SHORTCUTS[2].shortcut, run: c.toggleAgent, synonyms: ["chat", "assistant"] }),
    command({ id: "agent.tasks", label: "Background tasks", description: "AI updates and exports in progress or queued", category: "Agent", icon: "activity", run: c.openTasks, synonyms: ["jobs", "progress", "failures", "queue"] }),
    command({ id: "history.undo", label: "Undo last change", category: "History", icon: "undo", availability: c.canUndo ? yes : no("There is nothing to undo."), run: c.undo }),
    command({ id: "history.redo", label: "Redo last change", category: "History", icon: "redo", availability: c.canRedo ? yes : no("There is nothing to redo."), run: c.redo }),
    command({ id: "history.versions", label: "Version history", category: "History", icon: "history", availability: c.hasPage ? yes : no("Select a page first."), run: c.openHistory }),
    command({ id: "history.checkpoints", label: "Checkpoints", description: "Save or restore the whole website", category: "History", icon: "save", run: c.openCheckpoints, synonyms: ["snapshot", "restore"] }),
    command({ id: "preview.refresh", label: "Refresh preview", category: "Preview", icon: "refresh", run: c.refreshPreview }),
    command({ id: "preview.light", label: "Light preview appearance", category: "Preview", icon: "sun", run: () => c.setTheme("light"), synonyms: ["theme"] }),
    command({ id: "preview.dark", label: "Dark preview appearance", category: "Preview", icon: "moon", run: () => c.setTheme("dark"), synonyms: ["theme"] }),
    command({ id: "preview.desktop", label: "Preview on desktop", category: "Preview", icon: "monitor", run: () => c.setDevice("desktop") }),
    command({ id: "preview.tablet", label: "Preview on tablet", category: "Preview", icon: "tablet", run: () => c.setDevice("tablet") }),
    command({ id: "preview.mobile", label: "Preview on phone", category: "Preview", icon: "phone", run: () => c.setDevice("mobile") }),
    command({ id: "preview.fullscreen", label: "Toggle full screen", category: "Preview", icon: "maximize", run: c.toggleFullScreen }),
    command({ id: "preview.code", label: "View code", description: "Inspect the current page's HTML, CSS and JavaScript (read-only)", category: "Preview", icon: "code", availability: c.hasPage ? yes : no("Select a page first."), run: c.viewCode, synonyms: ["source", "html", "css", "javascript", "inspect"] }),
    command({ id: "collaboration.manage", label: "Collaborators", category: "Collaboration", icon: "users", run: panel("collaborators") }),
    command({ id: "project.details", label: "Website settings", category: "Website", icon: "settings", run: panel("overview"), synonyms: ["details"] }),
    command({ id: "project.agent-guidance", label: "Agent guidance", category: "Website", icon: "sparkles", run: panel("settings"), synonyms: ["instructions"] }),
    command({ id: "export.open", label: "Export website", category: "Export", icon: "download", run: panel("export"), availability: c.activeWork ? no("Wait for the current update to finish.") : yes }),
    command({ id: "account.open", label: "Account", category: "Account", icon: "user", target: "/account", run: () => c.navigate("/account") }),
    command({ id: "account.shortcuts", label: "Keyboard shortcuts", category: "Account", icon: "keyboard", run: panel("shortcuts"), synonyms: ["keys", "help"] }),
    command({ id: "account.sign-out", label: "Sign out", category: "Account", icon: "logout", run: c.signOut }),
    command({ id: "navigation.explorer", label: c.explorerOpen ? "Hide the website sidebar" : "Show the website sidebar", category: "Navigation", icon: "panel-left", shortcut: WORKSPACE_SHORTCUTS[1].shortcut, run: c.toggleExplorer }),
  ];
}
