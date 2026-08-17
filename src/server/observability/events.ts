import { emit, errorCode, metrics } from "./telemetry";

/**
 * The operational event vocabulary. Callers use these helpers instead of ad-hoc log
 * lines so event names, fields, and metric counters stay consistent across domains.
 * No helper accepts prompt text, tokens, storage keys, or credentials.
 */
export const observe = {
  authFailed(reason: "invalid_credentials" | "rate_limited" | "invalid_session" | "invalid_invite", fields: { scope?: string } = {}) {
    metrics.count("auth.failure", { reason });
    emit("auth.failed", { reason, ...fields }, "warn");
  },
  accessDenied(fields: { userId?: string; projectId?: string; resource: string; reason: string }) {
    metrics.count("access.denied", { resource: fields.resource });
    emit("access.denied", fields, "warn");
  },
  permissionChanged(action: "member_added" | "member_removed" | "role_changed" | "ownership_transferred", fields: { projectId: string; actorUserId?: string; subjectUserId?: string }) {
    metrics.count("permission.changed", { action });
    emit("permission.changed", { action, ...fields });
  },
  inviteLifecycle(action: "created" | "revoked" | "accepted" | "rejected", fields: { projectId?: string; inviteId?: string; reason?: string }) {
    metrics.count("invite.lifecycle", { action });
    emit(`invite.${action}`, fields, action === "rejected" ? "warn" : "info");
  },
  generationJob(action: "created" | "started" | "completed" | "failed" | "cancelled" | "retried", fields: { jobId: string; projectId: string; operation?: string; targetId?: string | null; reason?: string; durationMs?: number; providerLatencyMs?: number; repairAttempts?: number; promptVersion?: string; pipelineStage?: string; provider?: string | null; model?: string | null; diagnostic?: string | null }) {
    metrics.count("generation.job", { action, operation: fields.operation });
    if (typeof fields.durationMs === "number") metrics.observe("generation.duration_ms", fields.durationMs, { operation: fields.operation });
    // Provider latency is kept apart from job duration: they answer different questions.
    if (typeof fields.providerLatencyMs === "number") metrics.observe("generation.provider_latency_ms", fields.providerLatencyMs, { operation: fields.operation });
    emit(`generation.${action}`, fields, action === "failed" ? "error" : "info");
  },
  /** Handing a generation job to (or withholding it from) the durable queue. */
  generationDispatch(action: "published" | "skipped" | "failed", fields: { jobId: string; projectId?: string; mode: "queue" | "worker"; reason: string; attempt?: number; round?: number; duplicate?: boolean; error?: string }) {
    metrics.count("generation.dispatch", { action, mode: fields.mode });
    emit(`generation.dispatch_${action}`, fields, action === "failed" ? "error" : "info");
  },
  /** One consumer delivery of a generation job, including deliveries that do no work. */
  generationDelivery(action: "processed" | "requeued" | "skipped" | "deferred" | "watchdog", fields: { jobId: string; projectId?: string; reason?: string; status?: string; deliveryCount?: number; retryAfterSeconds?: number; round?: number; verdict?: string }) {
    metrics.count("generation.delivery", { action, reason: fields.reason });
    emit(`generation.delivery_${action}`, fields);
  },
  exportDispatch(action: "published" | "skipped" | "failed", fields: { jobId: string; projectId?: string; mode: "queue" | "worker"; reason: string; attempt?: number; round?: number; duplicate?: boolean; error?: string }) {
    metrics.count("export.dispatch", { action, mode: fields.mode, reason: fields.reason });
    emit(`export.dispatch_${action}`, fields, action === "failed" ? "error" : "info");
  },
  exportDelivery(action: "processed" | "requeued" | "skipped" | "deferred" | "watchdog", fields: { jobId: string; projectId?: string; reason?: string; status?: string; deliveryCount?: number; retryAfterSeconds?: number; round?: number; verdict?: string }) {
    metrics.count("export.delivery", { action });
    emit(`export.delivery_${action}`, fields, "info");
  },
  validationFailed(kind: "page" | "block" | "export" | "restore", fields: { projectId?: string; jobId?: string; entityId?: string; reason?: string; diagnostic?: string | null; pipelineStage?: string; provider?: string | null; model?: string | null }) {
    metrics.count("validation.failure", { kind });
    emit("validation.failed", { kind, ...fields }, "warn");
  },
  previewDocumentFailed(fields: { projectId: string; pageId?: string; versionId?: string; reason?: string }) {
    metrics.count("preview.document_failure");
    emit("preview.document_failed", fields, "error");
  },
  previewSessionFailed(fields: { projectId?: string; code: string; reason?: string }) {
    metrics.count("preview.session_failure", { code: fields.code });
    emit("preview.session_failed", fields, "error");
  },
  previewRuntimeFailed(fields: { projectId?: string; pageId?: string | null; blockId?: string | null; route?: string; reason?: string }) {
    metrics.count("preview.runtime_failure");
    emit("preview.runtime_failed", fields, "error");
  },
  historyAction(action: "undo" | "redo" | "page_restore" | "block_restore" | "checkpoint_created" | "checkpoint_restored" | "conflict", fields: { projectId: string; changeSetId?: string; entityId?: string; reason?: string }) {
    metrics.count("history.action", { action });
    emit(`history.${action}`, fields, action === "conflict" ? "warn" : "info");
  },
  exportJob(action: "created" | "started" | "validated" | "completed" | "failed", fields: { exportId: string; projectId: string; reason?: string; fileCount?: number; bytes?: number; durationMs?: number }) {
    metrics.count("export.job", { action });
    if (typeof fields.durationMs === "number") metrics.observe("export.duration_ms", fields.durationMs, { outcome: action });
    emit(`export.${action}`, fields, action === "failed" ? "error" : "info");
  },
  storageFailure(operation: "put" | "get" | "delete" | "exists", error: unknown, fields: { projectId?: string } = {}) {
    metrics.count("storage.failure", { operation });
    emit("storage.failed", { operation, reason: errorCode(error), ...fields }, "error");
  },
  maintenance(action: "leases_expired" | "jobs_recovered" | "exports_pruned" | "temp_cleaned", fields: { count: number; durationMs?: number }) {
    metrics.count("maintenance.action", { action }, fields.count);
    emit(`maintenance.${action}`, fields);
  },
};
