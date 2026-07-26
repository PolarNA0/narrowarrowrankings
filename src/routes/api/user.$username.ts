import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/user/$username")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        proxyJson(`/user/${encodeURIComponent(params.username)}`, 3 * 60 * 1000),
    },
  },
});
