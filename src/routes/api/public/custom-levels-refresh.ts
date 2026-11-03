import { createFileRoute } from "@tanstack/react-router";
import {
  advanceCustomLevelSweep,
  readCustomLevelSnapshot,
  sweepDue,
} from "@/lib/custom-levels.server";
import { verifyAdminRequest } from "@/lib/tas-board.server";

/**
 * Cron target that drives the community-level sweep to completion.
 *
 * A full sweep is ~303 upstream pages and the proxy paces calls 520ms apart, so
 * it cannot fit in one request (nor in Cloudflare's subrequest cap). This advances
 * **bounded batches** and returns early: call it on a schedule (e.g. hourly) and
 * the snapshot converges over a few calls, after which it is complete and nothing
 * is requested upstream until `SWEEP_INTERVAL_MS` (4h) has passed. The cadence is
 * enforced in `sweepDue`, so however often the cron fires, a completed sweep is
 * not re-walked inside its window — the cost is bounded per four hours, not per
 * call.
 *
 * `?force=1` (admin only) ignores the freshness gate for a "refresh now". Without
 * it, `force` would let any caller burn a full sweep on demand.
 *
 * `MAX_BATCHES` batches of up to `BATCH` (6) upstream pages is 42 subrequests —
 * under Cloudflare's free-tier cap of 50 per request. A full sweep is ~303 pages,
 * so it takes ~8 calls, which is why this is a scheduled endpoint.
 */
const MAX_BATCHES = 7;
/** Stop before the platform's request timeout; 42 paced pages is ~22s of work. */
const MAX_MS = 60 * 1000;

export const Route = createFileRoute("/api/public/custom-levels-refresh")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const wantsForce = url.searchParams.get("force") === "1";
        // A forced sweep bypasses the cost window, so it must be an admin action.
        const force = wantsForce && (await verifyAdminRequest(request));
        const pagesParam = Number(url.searchParams.get("pages"));
        const maxBatches =
          Number.isFinite(pagesParam) && pagesParam > 0
            ? Math.min(pagesParam, MAX_BATCHES)
            : MAX_BATCHES;

        const started = Date.now();
        let snapshot = await readCustomLevelSnapshot();
        if (!force && !sweepDue(snapshot)) {
          return Response.json({
            skipped: true,
            reason: "sweep is fresh",
            levels: snapshot ? Object.keys(snapshot.levels).length : 0,
            done: snapshot?.done ?? false,
            at: snapshot?.at ?? 0,
          });
        }

        let batches = 0;
        let swept = 0;
        for (let i = 0; i < maxBatches; i++) {
          if (Date.now() - started > MAX_MS) break;
          // Only the first batch of a forced run restarts the cursors; the rest
          // continue it, or every batch would re-sweep from page 0.
          const result = await advanceCustomLevelSweep({ force: force && i === 0 });
          snapshot = result.snapshot;
          batches += 1;
          swept += result.swept;
          // A batch that requested nothing means the sweep is fresh/complete.
          if (result.swept === 0) break;
          if (result.done && !force) break;
        }

        return Response.json({
          skipped: false,
          batches,
          swept,
          levels: snapshot ? Object.keys(snapshot.levels).length : 0,
          done: snapshot?.done ?? false,
          at: snapshot?.at ?? 0,
          elapsedMs: Date.now() - started,
        });
      },
    },
  },
});
