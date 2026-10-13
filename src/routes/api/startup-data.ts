import { createFileRoute } from "@tanstack/react-router";
import { proxyJson } from "@/lib/na-proxy";

export const Route = createFileRoute("/api/startup-data")({
  server: {
    handlers: {
      GET: async () => {
        const res = await proxyJson("/startup-data", 10 * 60 * 1000);
        // Upstream no longer serves this endpoint (404); daily data is optional.
        if (!res.ok) {
          return Response.json({}, { headers: { "Cache-Control": "public, max-age=600" } });
        }
        return res;
      },
    },
  },
});
