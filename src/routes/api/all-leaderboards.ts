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
        const complete =
          cached && (cached.payload as { loaded: number; total: number }).loaded ===
            (cached.payload as { total: number }).total;
        const ttl = complete ? CACHE_TTL : PARTIAL_TTL;
        if (cached && Date.now() - cached.at < ttl) {
          return Response.json(cached.payload, {
            headers: { "cache-control": "public, max-age=120, stale-while-revalidate=900" },
          });
        }
        // Serve stale data instantly and refresh in the background.
        if (cached && complete && !refreshing[key]) {
          refreshing[key] = build(deep, key).finally(() => delete refreshing[key]);
          return Response.json(cached.payload, {
            headers: { "cache-control": "public, max-age=60, stale-while-revalidate=900" },
          });
        }
        const payload = await (refreshing[key] ?? build(deep, key));
        return Response.json(payload, {
          headers: { "cache-control": "public, max-age=120, stale-while-revalidate=900" },
        });
      },
    },
  },
});

const refreshing: Record<string, Promise<unknown> | undefined> = {};

async function build(deep: boolean, key: string) {
  {
    {
      {


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
        // Partial results are cached briefly too, so a slow upstream doesn't
        // make every visitor refetch all 64 boards from scratch.
        memo[key] = { at: Date.now(), payload };

        return Response.json(payload, {
          headers: { "cache-control": "public, max-age=120, stale-while-revalidate=900" },
        });

      },
    },
  },
});

