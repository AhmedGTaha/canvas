export const COMMAND_CATEGORIES = [
  "Navigation", "Pages", "Assets", "Design", "Reusable sections", "Agent",
  "History", "Preview", "Collaboration", "Website", "Export", "Account",
] as const;

export type CommandCategory = (typeof COMMAND_CATEGORIES)[number];
export type CommandAvailability = { available: boolean; reason?: string };
export type WorkspaceCommand = {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon: string;
  shortcut?: string;
  synonyms?: string[];
  permitted: boolean;
  availability: CommandAvailability;
  target?: string;
  run?: () => void | Promise<void>;
};

export type CommandPage = { id: string; name: string; slug: string | null; routePath: string | null; type: "page" | "folder" };
export type CommandResult =
  | { type: "command"; key: string; score: number; command: WorkspaceCommand }
  | { type: "page"; key: string; score: number; page: CommandPage };
