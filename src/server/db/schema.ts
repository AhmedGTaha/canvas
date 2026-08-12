import {
  boolean,
  bigint,
  char,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const projectStatus = pgEnum("project_status", ["active", "archived", "deleted"]);
export const projectRole = pgEnum("project_role", ["owner", "collaborator"]);
export const leaseTargetType = pgEnum("lease_target_type", ["page", "building_block"]);
export const pageNodeType = pgEnum("page_node_type", ["page", "folder"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  normalizedEmail: text("normalized_email").notNull().unique(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const authCredentials = pgTable("auth_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("sessions_user_id_idx").on(table.userId), index("sessions_expires_at_idx").on(table.expiresAt)]);

export const authRateLimits = pgTable("auth_rate_limits", {
  scope: varchar("scope", { length: 32 }).notNull(),
  subjectHash: char("subject_hash", { length: 64 }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(1),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.scope, table.subjectHash] })]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("workspaces_owner_user_id_idx").on(table.ownerUserId), unique("workspaces_id_owner_unique").on(table.id, table.ownerUserId)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  ownerUserId: uuid("owner_user_id").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  description: varchar("description", { length: 500 }),
  status: projectStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (table) => [index("projects_workspace_status_idx").on(table.workspaceId, table.status), index("projects_owner_user_id_idx").on(table.ownerUserId)]);

export const projectMembers = pgTable("project_members", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: projectRole("role").notNull().default("collaborator"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.projectId, table.userId] }), index("project_members_user_id_idx").on(table.userId)]);

export const projectInvites = pgTable("project_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("project_invites_project_id_idx").on(table.projectId)]);

export const editingLeases = pgTable("editing_leases", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  targetType: leaseTargetType("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("editing_leases_target_unique").on(table.projectId, table.targetType, table.targetId),
  index("editing_leases_expires_at_idx").on(table.expiresAt),
  index("editing_leases_user_id_idx").on(table.userId),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("audit_events_project_created_idx").on(table.projectId, table.createdAt)]);

export const pageNodes = pgTable("page_nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  type: pageNodeType("type").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 100 }),
  routePath: varchar("route_path", { length: 1000 }),
  position: integer("position").notNull(),
  isHomepage: boolean("is_homepage").notNull().default(false),
  pageTitle: varchar("page_title", { length: 100 }),
  metaDescription: varchar("meta_description", { length: 300 }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  unique("page_nodes_id_project_unique").on(table.id, table.projectId),
  index("page_nodes_project_parent_position_idx").on(table.projectId, table.parentId, table.position),
  index("page_nodes_parent_id_idx").on(table.parentId),
]);

export const projectBrandSettings = pgTable("project_brand_settings", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  companyName: varchar("company_name", { length: 120 }).notNull(),
  companyDescription: varchar("company_description", { length: 2000 }),
  brandNotes: varchar("brand_notes", { length: 4000 }),
  primaryLogoMediaId: uuid("primary_logo_media_id"),
  alternateLogoMediaId: uuid("alternate_logo_media_id"),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const mediaFolders = pgTable("media_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  name: varchar("name", { length: 120 }).notNull(),
  position: integer("position").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  unique("media_folders_id_project_unique").on(table.id, table.projectId),
  index("media_folders_project_parent_position_idx").on(table.projectId, table.parentId, table.position),
]);

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id"),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 160 }).notNull(),
  storageKey: text("storage_key").notNull().unique(),
  mimeType: varchar("mime_type", { length: 32 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  altText: varchar("alt_text", { length: 500 }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  unique("media_assets_id_project_unique").on(table.id, table.projectId),
  index("media_assets_project_folder_created_idx").on(table.projectId, table.folderId, table.createdAt),
]);

export const projectThemeSettings = pgTable("project_theme_settings", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  lightTokens: jsonb("light_tokens").notNull(),
  darkTokens: jsonb("dark_tokens").notNull(),
  radiusScale: integer("radius_scale").notNull().default(50),
  spacingScale: integer("spacing_scale").notNull().default(50),
  shadowScale: integer("shadow_scale").notNull().default(50),
  fontScale: integer("font_scale").notNull().default(50),
  borderScale: integer("border_scale").notNull().default(50),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type ProjectInvite = typeof projectInvites.$inferSelect;
export type EditingLease = typeof editingLeases.$inferSelect;
export type PageNode = typeof pageNodes.$inferSelect;
export type ProjectBrandSettings = typeof projectBrandSettings.$inferSelect;
export type ProjectThemeSettings = typeof projectThemeSettings.$inferSelect;
export type MediaFolder = typeof mediaFolders.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
