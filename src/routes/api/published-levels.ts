import { createFileRoute } from "@tanstack/react-router";
import { proxyJson, rawQueryString } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/published-levels")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        proxyJson(`/published-levels?${rawQueryString(request)}`, 3 * 60 * 1000),
    },
  },
});
