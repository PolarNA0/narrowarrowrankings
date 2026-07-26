import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/packs/")({
  server: {
    handlers: {
      GET: async () => proxyJson("/packs", 10 * 60 * 1000),
    },
  },
});
