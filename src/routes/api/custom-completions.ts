import { createFileRoute } from "@tanstack/react-router";
import { getCustomCompletions } from "@/lib/custom-completions";

export const Route = createFileRoute("/api/custom-completions")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const pages = Number(new URL(request.url).searchParams.get("pages"));
        const snapshot = getCustomCompletions(
          Number.isFinite(pages) && pages > 0 ? Math.min(pages, 12) : 6,
        );
        return Response.json(snapshot);
      },
    },
  },
});
