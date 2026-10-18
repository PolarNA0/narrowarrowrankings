import { createFileRoute } from "@tanstack/react-router";
import {
  readSiteLevelPublic,
  removeSiteLevel,
  verifyAdminRequest,
} from "@/lib/site-levels.server";

export const Route = createFileRoute("/api/site-levels/$level")({
  server: {
    handlers: {
      /** One level's full payload, so Play and the replay viewer can load it. */
      GET: async ({ params }) => {
        const level = await readSiteLevelPublic(params.level);
        if (!level) return Response.json({ error: "Level not found" }, { status: 404 });
        return Response.json({ level }, { headers: { "cache-control": "no-store" } });
      },
      /** Admin-only: unpublish a level. */
      DELETE: async ({ params, request }) => {
        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Only admins can remove site levels." }, { status: 403 });
        }
        const levels = await removeSiteLevel(params.level);
        return Response.json({ levels });
      },
    },
  },
});
