import { createFileRoute } from "@tanstack/react-router";
import {
  advanceCustomLevelSweep,
  readCustomLevelSnapshot,
  snapshotLevels,
  sweepDue,
} from "@/lib/custom-levels.server";

/**
 * The "Unbeaten authors" view's read endpoint.
 *
 * The snapshot is refreshed **at most once per `SWEEP_INTERVAL_MS` (4h)**, and
 * that is the entire cost control: however much traffic the view gets, upstream
 * sees one sweep per window. Opening the view never starts a sweep of its own —
 * it only continues one that is already due.
 *
 * A full sweep is ~303 upstream pages, which cannot fit in one request (the deploy
 * target caps subrequests well below that), so each request advances a bounded
 * batch and the snapshot converges over several. The client polls until it
 * completes; once `done`, nothing is requested upstream until the window elapses
 * again.
 *
 * The cron target `GET /api/public/custom-levels-refresh` drives the same sweep
 * for a deployment that configures an external scheduler.
 */
const MIN_REFRESH_GAP = 15 * 1000;
/**
 * Batches advanced per read. One batch is up to `BATCH` (6) upstream pages, ~3s
 * of paced work, so a read stays responsive — the point of this route is to serve
 * the table, not to do the sweep. The scheduled
 * `GET /api/public/custom-levels-refresh` is the real driver; this only lets a
 * deployment without a scheduler fill in slowly as the view is polled.
 */
const READ_BATCHES = 1;

let memo: Awaited<ReturnType<typeof readCustomLevelSnapshot>> = null;
let memoLoadedAt = 0;
let refreshing: Promise<void> | null = null;
let lastRefresh = 0;

const doneHeaders = { "cache-control": "public, max-age=300, stale-while-revalidate=3600" };
// While the sweep is filling in, responses must reach the server or the client's
// polls would be served from cache and never observe progress.
const warmingHeaders = { "cache-control": "no-store" };

export const Route = createFileRoute("/api/unbeaten-authors")({
  server: {
    handlers: {
      GET: async () => {
        // Re-read while the snapshot is still filling in, so a read observes the
        // cron's progress rather than pinning the first snapshot it happened to
        // see for the isolate's lifetime. Once complete it is memoised, since a
        // finished snapshot only changes when the 4h window rolls over.
        if (!memo || !memo.done || Date.now() - memoLoadedAt > 60 * 1000) {
          const loaded = await readCustomLevelSnapshot();
          if (loaded) memo = loaded;
          memoLoadedAt = Date.now();
        }
        const now = Date.now();
        if (!refreshing && sweepDue(memo) && now - lastRefresh > MIN_REFRESH_GAP) {
          lastRefresh = now;
          refreshing = (async () => {
            for (let i = 0; i < READ_BATCHES; i++) {
              const result = await advanceCustomLevelSweep();
              memo = result.snapshot;
              if (result.swept === 0 || result.done) break;
            }
          })()
            .catch(() => undefined)
            .finally(() => {
              refreshing = null;
            });
        }
        // Await the bounded batch so it actually completes on the Worker.
        if (refreshing) {
          await Promise.race([refreshing, new Promise((r) => setTimeout(r, 20000))]);
        }
        const snapshot = memo;
        const levels = snapshotLevels(snapshot);
        const done = snapshot?.done ?? false;
        return Response.json(
          { levels, total: levels.length, done, at: snapshot?.at ?? 0 },
          { headers: done ? doneHeaders : warmingHeaders },
        );
      },
    },
  },
});
