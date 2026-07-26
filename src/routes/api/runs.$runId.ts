import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/runs/$runId")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        proxyJson(`/runs/${encodeURIComponent(params.runId)}`, 15 * 60 * 1000),
    },
  },
});
