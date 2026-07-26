import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

const MAX_DEPTH = 150;

export const Route = createFileRoute("/api/leaderboard/$level")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const incoming = new URL(request.url).searchParams;
        const upstream = new URLSearchParams();
        upstream.set("levelId", params.level);

        const arrowFilter = incoming.get("arrowFilter");
        if (arrowFilter) upstream.set("arrowFilter", arrowFilter);

        // The upstream API rejects unknown params and caps depth at 150, so the
        // legacy `infiniteLeaderboard=true` flag maps to the maximum depth.
        const requestedDepth = Number(incoming.get("depth"));
        const depth = incoming.get("infiniteLeaderboard") === "true"
          ? MAX_DEPTH
          : Number.isFinite(requestedDepth) && requestedDepth > 0
            ? Math.min(requestedDepth, MAX_DEPTH)
            : undefined;
        if (depth) upstream.set("depth", String(depth));

        return proxyJson(`/leaderboard?${upstream.toString()}`, 45 * 1000);
      },
    },
  },
});
