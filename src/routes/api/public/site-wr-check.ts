import { createFileRoute } from "@tanstack/react-router";
import {
  DEFAULT_SITE_EMOJIS,
  DEFAULT_SITE_TEMPLATE,
  isDiscordWebhook,
  postDiscordMessage,
  runSiteCheck,
} from "@/lib/site-tracker.server";
import { listSiteLevels } from "@/lib/site-levels.server";

// Re-exported so the admin UI and any docs can import the defaults from here.
export { DEFAULT_SITE_TEMPLATE, DEFAULT_SITE_EMOJIS } from "@/lib/site-tracker.server";

/**
 * The site level record tracker endpoint.
 *
 * `GET` scans the site levels' boards for new records and announces them through
 * the configured Discord webhook. `?force=1` ignores the poll interval, and
 * `?announce=all` re-announces every level's current record. Score submissions
 * call `runSiteCheck` directly, so this endpoint is for the admin "check now"
 * button and any external cron a deployment configures.
 */
export const Route = createFileRoute("/api/public/site-wr-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "1";
        const announceAll = url.searchParams.get("announce") === "all";
        const levels = await listSiteLevels();
        const result = await runSiteCheck(
          levels.map((l) => l.id),
          { force, announceAll },
        );
        return Response.json(result);
      },

      /** Send a single test message through the configured webhook. */
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          webhookUrl?: string;
          content?: string;
        };
        if (!isDiscordWebhook(body.webhookUrl)) {
          return Response.json(
            { error: "A valid Discord webhook URL is required" },
            { status: 400 },
          );
        }
        const ok = await postDiscordMessage(
          body.webhookUrl!.trim(),
          body.content || "✅ Narrow Arrow Rankings site record tracker connected.",
        );
        return Response.json({ ok });
      },
    },
  },
});
