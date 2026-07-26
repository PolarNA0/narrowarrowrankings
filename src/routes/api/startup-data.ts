import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/startup-data")({
  server: {
    handlers: {
      GET: async () => proxyJson("/startup-data", 10 * 60 * 1000),
    },
  },
});
