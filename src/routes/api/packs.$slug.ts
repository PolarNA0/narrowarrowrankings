import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/packs/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        proxyJson(`/packs/${encodeURIComponent(params.slug)}`, 10 * 60 * 1000),
    },
  },
});
