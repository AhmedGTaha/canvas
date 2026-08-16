import {
  boolean,
  bigint,
  char,
  index,
  integer,
  numeric,
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
export const changeSetOperation = pgEnum("change_set_operation", ["page_generate", "page_modify", "block_generate", "block_modify", "block_duplicate", "block_global_toggle", "block_usage_resolution", "block_archive", "page_section_add", "page_section_remove", "page_version_restore", "block_version_restore", "checkpoint_restore", "undo", "redo"]);
export const changeSetEntityType = pgEnum("change_set_entity_type", ["page", "building_block", "project"]);
export const generationOperation = pgEnum("generation_operation", ["assistant", "page_generate", "page_modify", "block_generate", "block_modify"]);
export const aiQueueStatus = pgEnum("ai_queue_status", ["queued", "paused", "claimed", "completed", "cancelled"]);
export const aiProviderKind = pgEnum("ai_provider_kind", ["gemini", "openai", "anthropic", "opencode", "openai_compatible"]);
export const aiConnectionTestStatus = pgEnum("ai_connection_test_status", ["untested", "passed", "failed"]);
export const aiModelSource = pgEnum("ai_model_source", ["discovered", "manual"]);
export const aiRequestKind = pgEnum("ai_request_kind", ["generation", "repair", "test_console"]);
export const aiCostSource = pgEnum("ai_cost_source", ["provider_reported", "canvas_estimate"]);

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
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
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
  provider: varchar("provider", { length: 40 }).notNull().default("unresolved"),
  providerModel: varchar("provider_model", { length: 120 }),
  providerRequestId: varchar("provider_request_id", { length: 255 }),
  errorCode: varchar("error_code", { length: 80 }),
  errorMessage: varchar("error_message", { length: 500 }),
  errorDiagnostic: varchar("error_diagnostic", { length: 500 }),
  resultMessageId: uuid("result_message_id"),
  resultChangeSetId: uuid("result_change_set_id"),
  queueItemId: uuid("queue_item_id"),
  aiConnectionId: uuid("ai_connection_id"),
  promptVersion: varchar("prompt_version", { length: 60 }),
  providerLatencyMs: integer("provider_latency_ms"),
  validationDurationMs: integer("validation_duration_ms"),
  repairAttemptCount: integer("repair_attempt_count").notNull().default(0),
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
}, (table) => [unique("generation_jobs_id_project_unique").on(table.id, table.projectId), unique("generation_jobs_queue_item_unique").on(table.queueItemId), index("generation_jobs_project_created_idx").on(table.projectId, table.createdAt), index("generation_jobs_claim_idx").on(table.status, table.availableAt, table.createdAt)]);

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

export const aiFollowUpQueue = pgTable("ai_follow_up_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  targetType: leaseTargetType("target_type").notNull(), targetId: uuid("target_id").notNull(),
  creatorUserId: uuid("creator_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  prompt: text("prompt").notNull(), selectedMediaIds: jsonb("selected_media_ids").notNull().default([]), selectedElement: jsonb("selected_element"),
  baseVersionId: uuid("base_version_id"), status: aiQueueStatus("status").notNull().default("queued"), pauseReason: varchar("pause_reason", { length: 500 }),
  sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity(), generationJobId: uuid("generation_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }), cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
}, (table) => [unique("ai_follow_up_queue_job_unique").on(table.generationJobId), index("ai_follow_up_queue_claim_idx").on(table.status, table.sequence), index("ai_follow_up_queue_project_target_idx").on(table.projectId, table.targetType, table.targetId, table.sequence), index("ai_follow_up_queue_user_idx").on(table.creatorUserId, table.status)]);

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

/**
 * A person's own provider credential (BYOK).
 *
 * Connections belong to an account, never to a workspace or a project, because the
 * credential spent on an AI job is the credential of the person who started it. Only the
 * ciphertext and a short masked hint are stored. Nothing in this table is readable
 * without the server-only Canvas master key, and no query path returns the ciphertext to
 * a browser.
 */
export const aiConnections = pgTable("ai_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: aiProviderKind("provider").notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  baseUrl: varchar("base_url", { length: 500 }),
  /**
   * Set only on connections created before credentials became account-scoped. It carries
   * no authorisation and grants no access: it exists so a credential sealed against the
   * old workspace binding stays decryptable until the key is next saved. See
   * `credential-cipher.ts`.
   */
  legacyWorkspaceId: uuid("legacy_workspace_id"),
  credentialCiphertext: text("credential_ciphertext").notNull(),
  credentialKeyVersion: integer("credential_key_version").notNull().default(1),
  credentialHint: varchar("credential_hint", { length: 24 }).notNull(),
  credentialUpdatedAt: timestamp("credential_updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true, mode: "date" }),
  lastTestStatus: aiConnectionTestStatus("last_test_status").notNull().default("untested"),
  lastTestError: varchar("last_test_error", { length: 300 }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
}, (table) => [unique("ai_connections_id_user_unique").on(table.id, table.userId), index("ai_connections_user_idx").on(table.userId, table.createdAt)]);

export const aiConnectionModels = pgTable("ai_connection_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull().references(() => aiConnections.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  modelId: varchar("model_id", { length: 200 }).notNull(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  source: aiModelSource("source").notNull().default("manual"),
  enabled: boolean("enabled").notNull().default(false),
  supportsStructuredOutput: boolean("supports_structured_output").notNull().default(true),
  supportsVision: boolean("supports_vision").notNull().default(false),
  contextWindow: integer("context_window"),
  maxOutputTokens: integer("max_output_tokens"),
  inputPricePerMillion: numeric("input_price_per_million"),
  outputPricePerMillion: numeric("output_price_per_million"),
  pricingCurrency: char("pricing_currency", { length: 3 }),
  pricingVersion: integer("pricing_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  unique("ai_connection_models_connection_model_unique").on(table.connectionId, table.modelId),
  unique("ai_connection_models_id_connection_unique").on(table.id, table.connectionId),
  index("ai_connection_models_connection_idx").on(table.connectionId, table.enabled),
  index("ai_connection_models_user_idx").on(table.userId, table.enabled),
]);

/** One AI selection per account: which connection, and which model on it. */
export const userAISettings = pgTable("user_ai_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").references(() => aiConnections.id, { onDelete: "set null" }),
  modelId: uuid("model_id").references(() => aiConnectionModels.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** One durable row per provider request. Never holds prompts, source, or credentials. */
export const aiUsageEvents = pgTable("ai_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Null for an account-scoped request such as the test console, which happens outside
  // any workspace.
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").references(() => aiConnections.id, { onDelete: "set null" }),
  generationJobId: uuid("generation_job_id"),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  provider: aiProviderKind("provider").notNull(),
  modelId: varchar("model_id", { length: 200 }).notNull(),
  requestKind: aiRequestKind("request_kind").notNull(),
  operation: varchar("operation", { length: 40 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 60 }),
  succeeded: boolean("succeeded").notNull(),
  errorCode: varchar("error_code", { length: 80 }),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  providerLatencyMs: integer("provider_latency_ms"),
  jobDurationMs: integer("job_duration_ms"),
  validationDurationMs: integer("validation_duration_ms"),
  costSource: aiCostSource("cost_source"),
  costAmount: numeric("cost_amount"),
  costCurrency: char("cost_currency", { length: 3 }),
  pricingInputPerMillion: numeric("pricing_input_per_million"),
  pricingOutputPerMillion: numeric("pricing_output_per_million"),
  pricingVersion: integer("pricing_version"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  index("ai_usage_events_project_created_idx").on(table.projectId, table.createdAt),
  index("ai_usage_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("ai_usage_events_job_idx").on(table.generationJobId),
]);

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
export type AIFollowUp = typeof aiFollowUpQueue.$inferSelect;
export type PageVersion = typeof pageVersions.$inferSelect;
export type ChangeSet = typeof changeSets.$inferSelect;
export type ChangeSetItem = typeof changeSetItems.$inferSelect;
export type ProjectCheckpoint = typeof projectCheckpoints.$inferSelect;
export type ProjectCheckpointItem = typeof projectCheckpointItems.$inferSelect;
export type ExportJob = typeof exportJobs.$inferSelect;
export type BuildingBlock = typeof buildingBlocks.$inferSelect;
export type BuildingBlockVersion = typeof buildingBlockVersions.$inferSelect;
export type BuildingBlockUsage = typeof buildingBlockUsages.$inferSelect;
export type AIConnection = typeof aiConnections.$inferSelect;
export type AIConnectionModel = typeof aiConnectionModels.$inferSelect;
export type UserAISettings = typeof userAISettings.$inferSelect;
export type AIUsageEvent = typeof aiUsageEvents.$inferSelect;
