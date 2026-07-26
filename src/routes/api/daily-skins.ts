import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/daily-skins")({
  server: {
    handlers: {
      GET: async () => proxyJson("/daily-skins", 10 * 60 * 1000),
    },
  },
});
