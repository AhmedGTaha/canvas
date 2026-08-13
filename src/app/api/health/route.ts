import { sql } from "@/server/db/client";

/** Liveness/readiness probe: reports database reachability without leaking details. */
export async function GET() {
  const started = performance.now();
  try {
    await sql`SELECT 1`;
    return Response.json({ status: "ok", database: "ok", latencyMs: Math.round(performance.now() - started) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
