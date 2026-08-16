import { MaintenanceService } from "@/domain/maintenance/service";
import { promoteQueuedFollowUp } from "@/domain/ai-queue/service";
import { recoverStalledGenerationJobs } from "@/server/jobs/generation-execution";
import { emit } from "@/server/observability/telemetry";

/**
 * The housekeeping the long-lived worker used to do on its idle path.
 *
 * Three jobs, all idempotent and safe to run concurrently with the queue consumer:
 * promote the next follow-up instruction if a target is free, republish generation jobs
 * whose queue message was lost or whose runner died, and run the ordinary maintenance
 * pass (stale leases, abandoned jobs, export pruning, scratch directories).
 *
 * This runs once a day — the most a Hobby deployment allows — and no normal generation
 * depends on it. Recovery for an individual job rides on the queue instead: every dispatch
 * arms a delayed watchdog message that re-checks the job minutes later. This sweep is the
 * last-resort net for jobs whose whole watchdog chain failed to publish, plus the ordinary
 * daily housekeeping.
 *
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  // On Vercel the secret is required: an unauthenticated route here would let anyone
  // drive maintenance. Locally it is optional so `npm run dev` can call it by hand.
  if (!secret) return !process.env.VERCEL;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Not authorized." }, { status: 401 });

  const promoted = await promoteQueuedFollowUp();
  const recovery = await recoverStalledGenerationJobs();
  const maintenance = await new MaintenanceService().run();
  emit("maintenance.completed", { ...maintenance, ...recovery, promotedFollowUp: promoted ? 1 : 0 });

  return Response.json({ promotedFollowUp: promoted?.id ?? null, ...recovery, maintenance }, { headers: { "Cache-Control": "no-store" } });
}
