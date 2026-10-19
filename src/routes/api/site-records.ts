import { createFileRoute } from "@tanstack/react-router";
import { listSiteRecords } from "@/lib/site-records.server";

export const Route = createFileRoute("/api/site-records")({
  server: {
    handlers: {
      GET: async () => {
        const records = await listSiteRecords();
        return Response.json({ records }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
