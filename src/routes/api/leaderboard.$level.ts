import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

// Upstream caps the leaderboard at 150 rows and ignores `depth`; `limit` is the
// parameter that actually deepens the board past the default top 100.
const MAX_LIMIT = 150;

export const Route = createFileRoute("/api/leaderboard/$level")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const incoming = new URL(request.url).searchParams;
        const upstream = new URLSearchParams();
        upstream.set("levelId", params.level);

        const arrowFilter = incoming.get("arrowFilter");
        if (arrowFilter) upstream.set("arrowFilter", arrowFilter);

        const requested = Number(incoming.get("limit") ?? incoming.get("depth"));
        const limit =
          incoming.get("infiniteLeaderboard") === "true"
            ? MAX_LIMIT
            : Number.isFinite(requested) && requested > 0
              ? Math.min(requested, MAX_LIMIT)
              : MAX_LIMIT;
        upstream.set("limit", String(limit));

        return proxyJson(`/leaderboard?${upstream.toString()}`, 45 * 1000);
      },
    },
  },
});
