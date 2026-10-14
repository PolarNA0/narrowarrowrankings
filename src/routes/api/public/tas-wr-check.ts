import { createFileRoute } from "@tanstack/react-router";
import { fetchLevelBoard } from "@/lib/leaderboard-source";
import { readTasBoard } from "@/lib/tas-board.server";
import { LEVELS } from "@/constants";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;
type Arrow = (typeof ARROWS)[number];

const ARROW_KEY: Record<Arrow, "narrow" | "speedy" | "energy"> = {
  "Narrow Arrow": "narrow",
  "Speedy Arrow": "speedy",
  "Energy Arrow": "energy",
};

/**
 * The TAS feed only ever announces tool-assisted records. Each message shows how
 * far the TAS time is ahead of the real world record (`[WR -x.xxx]`) and how much
 * it improved on the previous TAS record (`[TAS -x.xxx]`).
 */
export const DEFAULT_TAS_TEMPLATES: Record<"narrow" | "speedy" | "energy", string> = {
  narrow:
    "{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [WR -{wrDiff}] [TAS -{catDiff}]",
  speedy:
    "{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [WR -{wrDiff}] [TAS -{catDiff}]",
  energy:
    "{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [WR -{wrDiff}] [TAS -{catDiff}]",
};

export const DEFAULT_TAS_EMOJIS: Record<"narrow" | "speedy" | "energy", string> = {
  narrow: "🏹",
  speedy: "💨",
  energy: "⚡",
};

interface TrackerConfig {
  webhookUrl?: string;
  enabled?: boolean;
  intervalMinutes?: number;
  tasWebhookUrl?: string;
  tasEnabled?: boolean;
  tasIntervalMinutes?: number;
  tasTemplates?: Partial<Record<"narrow" | "speedy" | "energy", string>>;
  tasEmojis?: Partial<Record<"narrow" | "speedy" | "energy", string>>;
}

interface TasRecordState {
  [key: string]: { username: string; time: number };
}

export const Route = createFileRoute("/api/public/tas-wr-check")({
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
            .eq("doc_id", "tasRecordState")
            .maybeSingle(),
        ]);

        const config = (configRow?.data ?? {}) as TrackerConfig;
        const stateData = (stateRow?.data ?? {}) as TasRecordState & { __lastRunAt?: string };

        // The TAS tracker shares the Discord webhook by default; an override lets it
        // post elsewhere without touching the category feed.
        const webhookUrl = (config.tasWebhookUrl || config.webhookUrl || "").trim();
        const enabled = config.tasEnabled !== false && config.enabled !== false;

        const intervalMs =
          Math.max(5, Number(config.tasIntervalMinutes ?? config.intervalMinutes) || 5) * 60_000;
        const lastRunAt = stateData.__lastRunAt ? Date.parse(String(stateData.__lastRunAt)) : 0;
        if (!force && lastRunAt && Date.now() - lastRunAt < intervalMs - 30_000) {
          return Response.json({
            skipped: true,
            reason: "interval",
            intervalMinutes: intervalMs / 60_000,
          });
        }
        const { __lastRunAt: _ignored, ...previousRecords } = stateData;
        const previous = previousRecords as TasRecordState;
        const isFirstRun = Object.keys(previous).length === 0;

        const next: TasRecordState = { ...previous };
        const messages: string[] = [];

        // Only levels that already have a TAS board need the real WR lookup, so the
        // upstream boards are fetched lazily and only for those levels.
        const queue = [...LEVELS];
        const worker = async () => {
          for (;;) {
            const level = queue.shift();
            if (!level) return;

            const tasEntries = await readTasBoard(level.id);
            if (!tasEntries.length) continue;

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
            const overallWr = all.length ? Math.min(...all.map((r) => r.completion_time)) : null;

            ARROWS.forEach((arrow) => {
              const runs = tasEntries.filter((e) => e.arrowName === arrow);
              if (!runs.length) return;
              const best = runs.reduce((a, b) => (a.timeMs <= b.timeMs ? a : b));
              const timeSec = best.timeMs / 1000;
              const key = `${level.id}|${ARROW_KEY[arrow]}`;
              const prior = previous[key];
              next[key] = { username: best.username, time: timeSec };

              if (isFirstRun || !prior) return;
              if (timeSec >= prior.time - 0.0005) return;

              const slot = ARROW_KEY[arrow];
              const template = config.tasTemplates?.[slot] || DEFAULT_TAS_TEMPLATES[slot];
              const emoji = config.tasEmojis?.[slot] || DEFAULT_TAS_EMOJIS[slot];
              const wrDiff =
                overallWr != null ? Math.max(0, overallWr - timeSec).toFixed(3) : "0.000";
              messages.push(
                template
                  .replaceAll("{emoji}", emoji)
                  .replaceAll("{player}", best.username)
                  .replaceAll("{level}", level.name)
                  .replaceAll("{arrow}", arrow)
                  .replaceAll("{time}", `${timeSec.toFixed(3)}s`)
                  .replaceAll("{wr}", overallWr != null ? `${overallWr.toFixed(3)}s` : "—")
                  .replaceAll("{wrDiff}", wrDiff)
                  .replaceAll("{catDiff}", (prior.time - timeSec).toFixed(3))
                  .replaceAll("{previous}", prior.username),
              );
            });
          }
        };

        await Promise.all(Array.from({ length: 6 }, worker));

        await supabaseAdmin.from("app_docs").upsert(
          {
            collection: "configs",
            doc_id: "tasRecordState",
            data: { ...next, __lastRunAt: new Date().toISOString() } as never,
          },
          { onConflict: "collection,doc_id" },
        );

        let sent = 0;
        if (enabled && webhookUrl && messages.length) {
          for (const content of messages.slice(0, 20)) {
            try {
              const res = await fetch(webhookUrl, {
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
          return Response.json(
            { error: "A valid Discord webhook URL is required" },
            { status: 400 },
          );
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
