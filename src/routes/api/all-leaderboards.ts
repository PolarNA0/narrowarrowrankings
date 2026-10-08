import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard, type BoardEntry } from "@/lib/leaderboard-source";
import { readSnapshot, writeSnapshot, type BoardSnapshot } from "@/lib/board-snapshot.server";
import { LEVELS } from "@/constants";

// The game API allows ~120 requests/minute and a full deep load needs 216.
// Background work is killed once a Worker responds, so each request refreshes
// a small batch of the stalest levels inline, then serves the saved snapshot.
const LEVEL_FRESH_MS = 5 * 60 * 1000;
const BATCH = 6; // 18 upstream requests per refresh
const MIN_REFRESH_GAP = 15 * 1000;

type Snap = BoardSnapshot & { levelAt?: Record<string, number> };

let memo: Snap | null = null;
let refreshing: Promise<void> | null = null;
let lastRefresh = 0;

const headers = { "cache-control": "public, max-age=30, stale-while-revalidate=300" };

export const Route = createFileRoute("/api/all-leaderboards")({
  server: {
    handlers: {
      GET: async () => {
        if (!memo) memo = (await readSnapshot()) as Snap | null;
        const now = Date.now();
        if (!refreshing && now - lastRefresh > MIN_REFRESH_GAP) {
          lastRefresh = now;
          refreshing = refreshBatch().finally(() => {
            refreshing = null;
          });
        }
        // Await the bounded batch so it actually completes on the Worker.
        if (refreshing) {
          await Promise.race([refreshing, new Promise((r) => setTimeout(r, 20000))]);
        }
        const snap = memo ?? { boards: {}, loaded: 0, total: LEVELS.length, at: 0 };
        return Response.json(snap, { headers: snap.loaded > 0 ? headers : { "cache-control": "no-store" } });
      },
    },
  },
});

async function refreshBatch() {
  const base: Snap = memo ?? { boards: {}, loaded: 0, total: LEVELS.length, at: 0, levelAt: {} };
  const levelAt = { ...(base.levelAt ?? {}) };
  const now = Date.now();
  const due = LEVELS.filter((l) => now - (levelAt[l.id] ?? 0) > LEVEL_FRESH_MS)
    .sort((a, b) => (levelAt[a.id] ?? 0) - (levelAt[b.id] ?? 0))
    .slice(0, base.loaded === 0 ? LEVELS.length : BATCH);
  if (due.length === 0) return;

  const boards: Record<string, BoardEntry[]> = { ...base.boards };
  await Promise.all(
    due.map(async (level) => {
      try {
        const entries = await fetchLevelBoard(level.id, { deep: true });
        if (entries.length > 0) {
          boards[level.id] = entries;
          levelAt[level.id] = Date.now();
        }
      } catch {
        /* keep previous copy */
      }
    }),
  );
  const snap: Snap = {
    boards,
    levelAt,
    loaded: Object.keys(boards).length,
    total: LEVELS.length,
    at: Date.now(),
  };
  memo = snap;
  await writeSnapshot(snap);
}
