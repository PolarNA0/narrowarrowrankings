import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard, type BoardEntry } from "@/lib/leaderboard-source";
import { LEVELS } from "@/constants";

/** One request that returns every official leaderboard, warmed server-side. */
export const Route = createFileRoute("/api/all-leaderboards")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const deep = new URL(request.url).searchParams.get("deep") === "1";
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

        return Response.json(
          { boards, loaded: Object.keys(boards).length, total: LEVELS.length },
          { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=900" } },
        );
      },
    },
  },
});
