import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard } from "@/lib/leaderboard-source";
import { LEVELS } from "@/constants";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;
type Arrow = (typeof ARROWS)[number];

const ARROW_KEY: Record<Arrow, "narrow" | "speedy" | "energy"> = {
  "Narrow Arrow": "narrow",
  "Speedy Arrow": "speedy",
  "Energy Arrow": "energy",
};

export const DEFAULT_TEMPLATES: Record<"narrow" | "speedy" | "energy", string> = {
  narrow:
    "{emoji} **{player}** set a new category world record on **{level}** with **{time}** [wr +{wrDiff}] [narrow wr -{catDiff}]",
  speedy:
    "{emoji} **{player}** set a new category world record on **{level}** with **{time}** [wr +{wrDiff}] [speedy wr -{catDiff}]",
  energy:
    "{emoji} **{player}** set a new category world record on **{level}** with **{time}** [wr +{wrDiff}] [energy wr -{catDiff}]",
};

const DEFAULT_EMOJI: Record<"narrow" | "speedy" | "energy", string> = {
  narrow: "🏹",
  speedy: "💨",
  energy: "⚡",
};

interface TrackerConfig {
  webhookUrl?: string;
  enabled?: boolean;
  intervalMinutes?: number;
  templates?: Partial<Record<"narrow" | "speedy" | "energy", string>>;
  emojis?: Partial<Record<"narrow" | "speedy" | "energy", string>>;
}

interface RecordState {
  [key: string]: { username: string; time: number };
}

let lastRun = 0;

export const Route = createFileRoute("/api/public/category-wr-check")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const force = new URL(request.url).searchParams.get("force") === "1";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const [{ data: configRow }, { data: stateRow }] = await Promise.all([
          supabaseAdmin
            .from("app_docs")
            .select("data")
            .eq("collection", "configs")
            .eq("doc_id", "discordTracker")
            .maybeSingle(),
          supabaseAdmin
            .from("app_docs")
            .select("data")
            .eq("collection", "configs")
            .eq("doc_id", "categoryRecordState")
            .maybeSingle(),
        ]);

        const config = (configRow?.data ?? {}) as TrackerConfig;
        const stateData = (stateRow?.data ?? {}) as RecordState & { __lastRunAt?: string };

        // Cron polls every 5 minutes; the admin-set interval decides how often
        // a poll actually does work.
        const intervalMs = Math.max(5, Number(config.intervalMinutes) || 5) * 60_000;
        const lastRunAt = stateData.__lastRunAt ? Date.parse(String(stateData.__lastRunAt)) : 0;
        if (!force && lastRunAt && Date.now() - lastRunAt < intervalMs - 30_000) {
          return Response.json({ skipped: true, reason: "interval", intervalMinutes: intervalMs / 60_000 });
        }
        lastRun = Date.now();

        const { __lastRunAt: _ignored, ...previousRecords } = stateData;
        const previous = previousRecords as RecordState;
        const isFirstRun = Object.keys(previous).length === 0;

        const next: RecordState = { ...previous };
        const messages: string[] = [];

        // Only the three arrow boards are needed; the overall WR is their minimum.
        // Running six levels at a time keeps the upstream API from rate limiting.
        const queue = [...LEVELS];
        const worker = async () => {
          for (;;) {
            const level = queue.shift();
            if (!level) return;

            const boards = await Promise.all(
              ARROWS.map(async (arrow) => {
                try {
                  return await fetchLevelBoard(level.id, { arrowFilter: arrow });
                } catch {
                  return [];
                }
              }),
            );

            const all = boards.flat();
            if (!all.length) continue;
            const overallWr = Math.min(...all.map((r) => r.completion_time));

            ARROWS.forEach((arrow, index) => {
              const runs = boards[index];
              if (!runs.length) return;
              const best = runs.reduce((a, b) => (a.completion_time <= b.completion_time ? a : b));
              const key = `${level.id}|${ARROW_KEY[arrow]}`;
              const prior = previous[key];
              next[key] = { username: best.username, time: best.completion_time };

              if (isFirstRun || !prior) return;
              if (best.completion_time >= prior.time - 0.0005) return;

              const slot = ARROW_KEY[arrow];
              const template = config.templates?.[slot] || DEFAULT_TEMPLATES[slot];
              const emoji = config.emojis?.[slot] || DEFAULT_EMOJI[slot];
              messages.push(
                template
                  .replaceAll("{emoji}", emoji)
                  .replaceAll("{player}", best.username)
                  .replaceAll("{level}", level.name)
                  .replaceAll("{arrow}", arrow)
                  .replaceAll("{time}", `${best.completion_time.toFixed(3)}s`)
                  .replaceAll("{wrDiff}", (best.completion_time - overallWr).toFixed(3))
                  .replaceAll("{catDiff}", (prior.time - best.completion_time).toFixed(3))
                  .replaceAll("{previous}", prior.username),
              );
            });
          }
        };

        await Promise.all(Array.from({ length: 6 }, worker));


        await supabaseAdmin
          .from("app_docs")
          .upsert(
            {
              collection: "configs",
              doc_id: "categoryRecordState",
              data: { ...next, __lastRunAt: new Date().toISOString() } as never,
            },
            { onConflict: "collection,doc_id" },
          );

        let sent = 0;
        if (config.enabled !== false && config.webhookUrl && messages.length) {
          for (const content of messages.slice(0, 20)) {
            try {
              const res = await fetch(config.webhookUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
              });
              if (res.ok) sent += 1;
            } catch {
              /* webhook delivery is best effort */
            }
          }
        }

        return Response.json({
          tracked: Object.keys(next).length,
          newRecords: messages.length,
          sent,
          baseline: isFirstRun,
        });
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
            content: body.content || "✅ Narrow Arrow Rankings webhook connected.",
            allowed_mentions: { parse: [] },
          }),
        });
        return Response.json({ ok: res.ok, status: res.status });
      },
    },
  },
});
