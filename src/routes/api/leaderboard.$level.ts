import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard } from "@/lib/leaderboard-source";

export const Route = createFileRoute("/api/leaderboard/$level")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const incoming = new URL(request.url).searchParams;
        const arrowFilter = incoming.get("arrowFilter") ?? undefined;
        // `deep` merges the per-arrow boards so players outside the global
        // top 150 (the hard upstream cap) still show up.
        const deep = incoming.get("deep") === "1" && !arrowFilter;

        try {
          const entries = await fetchLevelBoard(params.level, { deep, arrowFilter });
          return Response.json(entries, {
            headers: { "cache-control": "public, max-age=45, stale-while-revalidate=600" },
          });
        } catch (error) {
          console.error("leaderboard fetch failed", params.level, error);
          return Response.json({ error: "Upstream leaderboard request failed" }, { status: 502 });
        }
      },
    },
  },
});
