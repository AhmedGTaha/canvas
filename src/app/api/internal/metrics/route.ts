import { timingSafeEqual } from "node:crypto";
import { metrics } from "@/server/observability/telemetry";

/**
 * Operational counters and durations for this process. Disabled unless
 * CANVAS_METRICS_TOKEN is configured, and never returns project or user data.
 */
export async function GET(request: Request) {
  const expected = process.env.CANVAS_METRICS_TOKEN;
  if (!expected) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json({ collectedAt: new Date().toISOString(), ...metrics.snapshot() }, { headers: { "Cache-Control": "no-store" } });
}
