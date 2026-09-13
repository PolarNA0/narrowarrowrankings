import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard, type BoardEntry } from "@/lib/leaderboard-source";
import { LEVELS } from "@/constants";

const CACHE_TTL = 3 * 60 * 1000;
const PARTIAL_TTL = 20 * 1000;

const memo: Record<string, { at: number; payload: unknown }> = {};

/** One request that returns every official leaderboard, warmed server-side. */
export const Route = createFileRoute("/api/all-leaderboards")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const deep = new URL(request.url).searchParams.get("deep") === "1";
        const key = deep ? "deep" : "flat";
        const cached = memo[key];
        if (cached && Date.now() - cached.at < CACHE_TTL) {
          return Response.json(cached.payload, {
            headers: { "cache-control": "public, max-age=60, stale-while-revalidate=900" },
          });
        }

        const boards: Record<string, BoardEntry[]> = {};

        await Promise.all(
          LEVELS.map(async (level) => {
            try {
              boards[level.id] = await fetchLevelBoard(level.id, { deep });
            } catch {
              /* skip; the client retries individual levels */
            }
          }),
        );

        const payload = { boards, loaded: Object.keys(boards).length, total: LEVELS.length };
        if (Object.keys(boards).length === LEVELS.length) memo[key] = { at: Date.now(), payload };

        return Response.json(payload, {
          headers: { "cache-control": "public, max-age=60, stale-while-revalidate=900" },
        });
      },
    },
  },
});

