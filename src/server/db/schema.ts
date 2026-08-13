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
export const aiMessageRole = pgEnum("ai_message_role", ["user", "assistant", "system_internal"]);
export const generationTargetType = pgEnum("generation_target_type", ["project", "page", "building_block"]);
export const generationJobStatus = pgEnum("generation_job_status", ["queued", "preparing_context", "generating", "validating", "applying", "completed", "failed", "cancelled"]);
export const exportJobStatus = pgEnum("export_job_status", ["queued", "validating", "assembling", "building", "packaging", "completed", "failed"]);
export const changeSetOperation = pgEnum("change_set_operation", ["page_generate", "page_modify", "block_generate", "block_modify", "block_duplicate", "block_global_toggle", "block_archive", "page_version_restore", "block_version_restore", "checkpoint_restore", "undo", "redo"]);
export const changeSetEntityType = pgEnum("change_set_entity_type", ["page", "building_block", "project"]);
export const generationOperation = pgEnum("generation_operation", ["assistant", "page_generate", "page_modify", "block_generate", "block_modify"]);

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
  currentInstructionId: uuid("current_instruction_id"),
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
  currentVersionId: uuid("current_version_id"),
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

export const projectInstructions = pgTable("project_instructions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  revisionNumber: integer("revision_number").notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("project_instructions_project_revision_unique").on(table.projectId, table.revisionNumber)]);

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pageId: uuid("page_id"),
  buildingBlockId: uuid("building_block_id"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
}, (table) => [unique("ai_conversations_id_project_unique").on(table.id, table.projectId), index("ai_conversations_project_updated_idx").on(table.projectId, table.updatedAt)]);

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: aiMessageRole("role").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [index("ai_messages_conversation_created_idx").on(table.conversationId, table.createdAt)]);

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id"),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  targetType: generationTargetType("target_type").notNull(),
  targetId: uuid("target_id"),
  operation: generationOperation("operation").notNull().default("assistant"),
  basePageVersionId: uuid("base_page_version_id"),
  resultPageVersionId: uuid("result_page_version_id"),
  baseBlockVersionId: uuid("base_block_version_id"),
  resultBlockVersionId: uuid("result_block_version_id"),
  promptMessageId: uuid("prompt_message_id"),
  status: generationJobStatus("status").notNull().default("queued"),
  progressStage: varchar("progress_stage", { length: 80 }).notNull().default("Queued"),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerModel: varchar("provider_model", { length: 120 }),
  providerRequestId: varchar("provider_request_id", { length: 255 }),
  errorCode: varchar("error_code", { length: 80 }),
  errorMessage: varchar("error_message", { length: 500 }),
  errorDiagnostic: varchar("error_diagnostic", { length: 500 }),
  resultMessageId: uuid("result_message_id"),
  resultChangeSetId: uuid("result_change_set_id"),
  usageMetadata: jsonb("usage_metadata"),
  contextFingerprint: char("context_fingerprint", { length: 64 }),
  contextMetadata: jsonb("context_metadata"),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true, mode: "date" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  workerId: varchar("worker_id", { length: 120 }),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
}, (table) => [unique("generation_jobs_id_project_unique").on(table.id, table.projectId), index("generation_jobs_project_created_idx").on(table.projectId, table.createdAt), index("generation_jobs_claim_idx").on(table.status, table.availableAt, table.createdAt)]);

export const pageVersions = pgTable("page_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  sourceCode: text("source_code").notNull(),
  manifest: jsonb("manifest").notNull(),
  seoMetadata: jsonb("seo_metadata").notNull(),
  changeSummary: jsonb("change_summary").notNull(),
  sourceHash: char("source_hash", { length: 64 }).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  generationJobId: uuid("generation_job_id"),
  changeSetId: uuid("change_set_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("page_versions_page_number_unique").on(table.pageId, table.versionNumber), unique("page_versions_generation_job_unique").on(table.generationJobId), unique("page_versions_id_page_project_unique").on(table.id, table.pageId, table.projectId), index("page_versions_page_created_idx").on(table.projectId, table.pageId, table.createdAt)]);

export const generationJobMedia = pgTable("generation_job_media", {
  generationJobId: uuid("generation_job_id").notNull(),
  projectId: uuid("project_id").notNull(),
  mediaAssetId: uuid("media_asset_id").notNull(),
  position: integer("position").notNull(),
}, (table) => [primaryKey({ columns: [table.generationJobId, table.mediaAssetId] }), unique("generation_job_media_job_position_unique").on(table.generationJobId, table.position), index("generation_job_media_project_idx").on(table.projectId, table.mediaAssetId)]);

export const buildingBlocks = pgTable("building_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 40 }).notNull().default("custom"),
  isGlobal: boolean("is_global").notNull().default(false),
  currentVersionId: uuid("current_version_id"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (table) => [unique("building_blocks_id_project_unique").on(table.id, table.projectId), index("building_blocks_project_updated_idx").on(table.projectId, table.updatedAt)]);

export const buildingBlockVersions = pgTable("building_block_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  buildingBlockId: uuid("building_block_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  sourceCode: text("source_code").notNull(),
  manifest: jsonb("manifest").notNull(),
  changeSummary: jsonb("change_summary").notNull().default({}),
  sourceHash: char("source_hash", { length: 64 }).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  generationJobId: uuid("generation_job_id"),
  changeSetId: uuid("change_set_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("building_block_versions_block_number_unique").on(table.buildingBlockId, table.versionNumber),
  unique("building_block_versions_generation_job_unique").on(table.generationJobId),
  unique("building_block_versions_id_block_project_unique").on(table.id, table.buildingBlockId, table.projectId),
  index("building_block_versions_block_created_idx").on(table.projectId, table.buildingBlockId, table.createdAt),
]);

export const buildingBlockUsages = pgTable("building_block_usages", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").notNull(),
  buildingBlockId: uuid("building_block_id").notNull(),
  buildingBlockVersionId: uuid("building_block_version_id"),
  usageKey: varchar("usage_key", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("building_block_usages_page_key_unique").on(table.pageId, table.usageKey),
  index("building_block_usages_block_idx").on(table.projectId, table.buildingBlockId),
  index("building_block_usages_page_idx").on(table.pageId),
]);

export const changeSets = pgTable("change_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  operation: changeSetOperation("operation").notNull(),
  summary: varchar("summary", { length: 300 }).notNull(),
  reversible: boolean("reversible").notNull().default(true),
  sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity(),
  generationJobId: uuid("generation_job_id"),
  sourceChangeSetId: uuid("source_change_set_id"),
  undoneAt: timestamp("undone_at", { withTimezone: true, mode: "date" }),
  undoneByChangeSetId: uuid("undone_by_change_set_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("change_sets_id_project_unique").on(table.id, table.projectId), index("change_sets_project_sequence_idx").on(table.projectId, table.sequence)]);

export const changeSetItems = pgTable("change_set_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  changeSetId: uuid("change_set_id").notNull(),
  projectId: uuid("project_id").notNull(),
  entityType: changeSetEntityType("entity_type").notNull(),
  entityId: uuid("entity_id"),
  beforeVersionId: uuid("before_version_id"),
  afterVersionId: uuid("after_version_id"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  position: integer("position").notNull(),
}, (table) => [unique("change_set_items_set_position_unique").on(table.changeSetId, table.position), index("change_set_items_entity_idx").on(table.projectId, table.entityType, table.entityId)]);

export const projectCheckpoints = pgTable("project_checkpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  projectState: jsonb("project_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [unique("project_checkpoints_id_project_unique").on(table.id, table.projectId), index("project_checkpoints_project_created_idx").on(table.projectId, table.createdAt)]);

export const projectCheckpointItems = pgTable("project_checkpoint_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  checkpointId: uuid("checkpoint_id").notNull(),
  projectId: uuid("project_id").notNull(),
  entityType: changeSetEntityType("entity_type").notNull(),
  entityId: uuid("entity_id"),
  versionId: uuid("version_id"),
  entityState: jsonb("entity_state").notNull().default({}),
  position: integer("position").notNull(),
}, (table) => [unique("project_checkpoint_items_position_unique").on(table.checkpointId, table.position), unique("project_checkpoint_items_entity_unique").on(table.checkpointId, table.entityType, table.entityId), index("project_checkpoint_items_checkpoint_idx").on(table.checkpointId, table.position)]);

export const exportJobs = pgTable("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: exportJobStatus("status").notNull().default("queued"),
  progressStage: varchar("progress_stage", { length: 80 }).notNull().default("Queued"),
  validation: jsonb("validation"),
  errorCode: varchar("error_code", { length: 80 }),
  errorMessage: varchar("error_message", { length: 500 }),
  artifactStorageKey: text("artifact_storage_key"),
  artifactFileName: varchar("artifact_file_name", { length: 160 }),
  artifactBytes: bigint("artifact_bytes", { mode: "number" }),
  artifactFileCount: integer("artifact_file_count"),
  artifactPrunedAt: timestamp("artifact_pruned_at", { withTimezone: true, mode: "date" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  workerId: varchar("worker_id", { length: 120 }),
  attemptCount: integer("attempt_count").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
}, (table) => [unique("export_jobs_id_project_unique").on(table.id, table.projectId), index("export_jobs_project_created_idx").on(table.projectId, table.createdAt)]);

export const aiJobRateLimits = pgTable("ai_job_rate_limits", {
  scope: varchar("scope", { length: 16 }).notNull(),
  subjectId: uuid("subject_id").notNull(),
  attemptCount: integer("attempt_count").notNull().default(1),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.scope, table.subjectId] })]);

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
export type ProjectInstruction = typeof projectInstructions.$inferSelect;
export type AIConversation = typeof aiConversations.$inferSelect;
export type AIMessage = typeof aiMessages.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type PageVersion = typeof pageVersions.$inferSelect;
export type ChangeSet = typeof changeSets.$inferSelect;
export type ChangeSetItem = typeof changeSetItems.$inferSelect;
export type ProjectCheckpoint = typeof projectCheckpoints.$inferSelect;
export type ProjectCheckpointItem = typeof projectCheckpointItems.$inferSelect;
export type ExportJob = typeof exportJobs.$inferSelect;
export type BuildingBlock = typeof buildingBlocks.$inferSelect;
export type BuildingBlockVersion = typeof buildingBlockVersions.$inferSelect;
export type BuildingBlockUsage = typeof buildingBlockUsages.$inferSelect;
