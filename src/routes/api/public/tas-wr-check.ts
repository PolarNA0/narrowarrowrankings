import { createFileRoute } from "@tanstack/react-router";
import { LEVELS } from "@/constants";
import { runTasCheck } from "@/lib/tas-tracker.server";

// Re-exported so the admin UI and any docs can import the defaults from here.
export { DEFAULT_TAS_TEMPLATES, DEFAULT_TAS_EMOJIS } from "@/lib/tas-tracker.server";

/**
 * The TAS record tracker endpoint.
 *
 * `GET` scans the levels' TAS boards for new records and announces them through
 * the configured Discord webhook. `?force=1` ignores the poll interval. Uploads
 * call the same `runTasCheck` directly, so this endpoint is for the admin "check
 * now" button and any external cron a deployment configures.
 */
export const Route = createFileRoute("/api/public/tas-wr-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const force = new URL(request.url).searchParams.get("force") === "1";
        const result = await runTasCheck(
          LEVELS.map((l) => l.id),
          { force },
        );
        return Response.json(result);
      },

      /** Send a single test message through the configured webhook. */
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          webhookUrl?: string;
          content?: string;
        };
        if (!body.webhookUrl?.startsWith("https://discord.com/api/webhooks/")) {
          return Response.json({ error: "A valid Discord webhook URL is required" }, { status: 400 });
        }
        const res = await fetch(body.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: body.content || "✅ Narrow Arrow Rankings TAS tracker connected.",
            allowed_mentions: { parse: [] },
          }),
        });
        return Response.json({ ok: res.ok, status: res.status });
      },
    },
  },
});
