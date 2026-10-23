import { createFileRoute } from "@tanstack/react-router";
import { RACE_MATCH_PAGE, readRecentMatches } from "@/lib/race-matches.server";

/**
 * The recent-matches feed for the Rankings tab. Public and read-only: a match is
 * already public knowledge (both players saw the lobby code), and this only ever
 * returns finished matches.
 */
export const Route = createFileRoute("/api/race-matches/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const raw = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(raw) && raw > 0 ? raw : RACE_MATCH_PAGE;
        const matches = await readRecentMatches(limit);
        return Response.json({ matches }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
