import { createFileRoute } from "@tanstack/react-router";
import { proxyJson, queryString } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/leaderboard/$level")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        proxyJson(
          `/leaderboard?levelId=${encodeURIComponent(params.level)}${queryString(request)}`,
          45 * 1000,
        ),
    },
  },
});
