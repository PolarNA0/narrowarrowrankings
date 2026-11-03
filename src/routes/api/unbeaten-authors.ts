import { createFileRoute } from "@tanstack/react-router";
import {
  advanceCustomLevelSweep,
  readCustomLevelSnapshot,
  snapshotLevels,
} from "@/lib/custom-levels.server";

// A full sweep of the published-levels feed is ~300 upstream pages, far past
// the ~120/min budget and well beyond this handler's patience. So each request
// advances one bounded batch and serves the persisted snapshot, exactly as
// `all-leaderboards` warms the board snapshot. A cold server needs ~50 requests
// to cover everything; until then the view shows what has been swept so far.
const MIN_REFRESH_GAP = 15 * 1000;

let memo: Awaited<ReturnType<typeof readCustomLevelSnapshot>> = null;
let refreshing: Promise<void> | null = null;
let lastRefresh = 0;

const headers = { "cache-control": "public, max-age=60, stale-while-revalidate=600" };
// While the sweep is still warming, every response must reach the server or the
// browser's cache would swallow the polls that advance it (the view polls every
// 15s, well inside a 60s max-age).
const warmingHeaders = { "cache-control": "no-store" };

export const Route = createFileRoute("/api/unbeaten-authors")({
  server: {
    handlers: {
      GET: async () => {
        if (!memo) memo = await readCustomLevelSnapshot();
        const now = Date.now();
        if (!refreshing && now - lastRefresh > MIN_REFRESH_GAP) {
          lastRefresh = now;
          refreshing = advanceCustomLevelSweep()
            .then((snap) => {
              memo = snap;
            })
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
          {
            levels,
            total: levels.length,
            done,
            at: snapshot?.at ?? 0,
          },
          { headers: done ? headers : warmingHeaders },
        );
      },
    },
  },
});
