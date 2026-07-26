import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/level-details/$levelId")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        proxyJson(
          `/level-details/${encodeURIComponent(params.levelId)}?isCustomLevel=true`,
          15 * 60 * 1000,
        ),
    },
  },
});
