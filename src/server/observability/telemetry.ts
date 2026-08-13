/**
 * Structured, redaction-safe telemetry for Canvas.
 *
 * Every operational event goes through here so the shape stays consistent and so a
 * single redaction pass protects secrets. Tokens, signed URLs, credentials, storage
 * keys, and prompt text must never be passed in; anything that still looks like a
 * secret is stripped before it reaches the log.
 */

export type TelemetrySeverity = "info" | "warn" | "error";
export type TelemetryFields = Record<string, unknown>;

/**
 * Keys whose values are never safe to log. Comparison is on a normalized key
 * (lowercased, separators removed) so camelCase, snake_case, and kebab-case all match.
 */
const SENSITIVE_KEY_PARTS = ["token", "secret", "password", "credential", "apikey", "authorization", "cookie", "signedurl", "storagekey", "privatekey", "sessionid"];
const SENSITIVE_KEY_EXACT = new Set(["prompt", "content", "sourcecode", "session", "email", "message"]);
function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_EXACT.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}
/** Value shapes that indicate an accidental secret even under an innocuous key. */
const SECRET_VALUE = /(eyJ[A-Za-z0-9_-]{10,}|(?:sk|pk|ghp|gho)_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|postgres(?:ql)?:\/\/[^\s]+|https?:\/\/[^\s]*[?&](?:token|signature|sig|key)=)/i;
const MAX_STRING = 300;

function redactValue(key: string, value: unknown, depth = 0): unknown {
  if (isSensitiveKey(key)) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (SECRET_VALUE.test(value)) return "[redacted]";
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item, index) => redactValue(String(index), item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([entryKey, entryValue]) => [entryKey, redactValue(entryKey, entryValue, depth + 1)]));
  }
  return "[unsupported]";
}

export function redactTelemetry(fields: TelemetryFields): TelemetryFields {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, redactValue(key, value)]));
}

type Sink = (line: string) => void;
let sink: Sink | null = null;
/** Test hook: capture emitted lines instead of writing to the console. */
export function setTelemetrySink(next: Sink | null) { sink = next; }

export function emit(event: string, fields: TelemetryFields = {}, severity: TelemetrySeverity = "info") {
  const line = JSON.stringify({ event, severity, at: new Date().toISOString(), ...redactTelemetry(fields) });
  if (sink) { sink(line); return; }
  if (severity === "error") console.error(line);
  else if (severity === "warn") console.warn(line);
  else console.info(line);
}

/** In-process counters and durations, exposed for the operational metrics endpoint. */
class MetricRegistry {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  count(name: string, labels: TelemetryFields = {}, value = 1) {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name: string, milliseconds: number, labels: TelemetryFields = {}) {
    const key = this.key(name, labels);
    const current = this.durations.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
    this.durations.set(key, { count: current.count + 1, totalMs: current.totalMs + milliseconds, maxMs: Math.max(current.maxMs, milliseconds) });
  }

  snapshot() {
    return {
      counters: Object.fromEntries(this.counters),
      durations: Object.fromEntries([...this.durations].map(([key, value]) => [key, { count: value.count, averageMs: Math.round(value.totalMs / value.count), maxMs: Math.round(value.maxMs) }])),
    };
  }

  reset() { this.counters.clear(); this.durations.clear(); }

  private key(name: string, labels: TelemetryFields) {
    const suffix = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${String(value)}`).join(",");
    return suffix ? `${name}{${suffix}}` : name;
  }
}

export const metrics = new MetricRegistry();

/** Times an operation, emitting a duration metric and a failure event when it throws. */
export async function timed<T>(event: string, fields: TelemetryFields, operation: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await operation();
    metrics.observe(`${event}.duration_ms`, performance.now() - started, { outcome: "success" });
    metrics.count(`${event}.total`, { outcome: "success" });
    return result;
  } catch (error) {
    metrics.observe(`${event}.duration_ms`, performance.now() - started, { outcome: "failure" });
    metrics.count(`${event}.total`, { outcome: "failure" });
    emit(`${event}.failed`, { ...fields, reason: errorCode(error) }, "error");
    throw error;
  }
}

/** Stable, user-safe classification of an error for logs and metrics. */
export function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as { exportCode?: string; historyCode?: string; blockCode?: string; code?: string; name?: string };
  return candidate.exportCode ?? candidate.historyCode ?? candidate.blockCode ?? candidate.code ?? candidate.name ?? "unknown";
}
