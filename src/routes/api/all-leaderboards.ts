import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard, type BoardEntry } from "@/lib/leaderboard-source";
import { readSnapshot, writeSnapshot, type BoardSnapshot } from "@/lib/board-snapshot.server";
import { LEVELS } from "@/constants";

// The game API allows ~120 requests/minute, and a full deep load needs 216,
// so boards are served from a saved snapshot and refreshed in the background.
const FRESH_MS = 4 * 60 * 1000;

let memo: BoardSnapshot | null = null;
let refreshing: Promise<BoardSnapshot> | null = null;

const headers = { "cache-control": "public, max-age=60, stale-while-revalidate=900" };

export const Route = createFileRoute("/api/all-leaderboards")({
  server: {
    handlers: {
      GET: async () => {
        if (!memo) memo = await readSnapshot();
        const stale = !memo || Date.now() - memo.at > FRESH_MS || memo.loaded < memo.total;
        if (stale && !refreshing) {
          refreshing = build().finally(() => {
            refreshing = null;
          });
        }
        if (memo && memo.loaded > 0) return Response.json(memo, { headers });
        // Nothing saved yet — wait (bounded) for the first build.
        const first = await Promise.race([
          refreshing!,
          new Promise<null>((r) => setTimeout(() => r(null), 25000)),
        ]);
        return Response.json(first ?? { boards: {}, loaded: 0, total: LEVELS.length, at: 0 }, {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});

async function build(): Promise<BoardSnapshot> {
  const previous = memo?.boards ?? {};
  const boards: Record<string, BoardEntry[]> = {};
  await Promise.all(
    LEVELS.map(async (level) => {
      try {
        const entries = await fetchLevelBoard(level.id, { deep: true });
        if (entries.length > 0) boards[level.id] = entries;
      } catch {
        /* keep previous copy */
      }
    }),
  );
  for (const level of LEVELS) {
    if (!boards[level.id] && previous[level.id]?.length) boards[level.id] = previous[level.id];
  }
  const snap: BoardSnapshot = {
    boards,
    loaded: Object.keys(boards).length,
    total: LEVELS.length,
    at: Date.now(),
  };
  memo = snap;
  await writeSnapshot(snap);
  return snap;
}
