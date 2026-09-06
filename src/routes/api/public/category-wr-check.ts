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
        if (!force && Date.now() - lastRun < 90_000) {
          return Response.json({ skipped: true, reason: "cooldown" });
        }
        lastRun = Date.now();

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
        const previous = (stateRow?.data ?? {}) as RecordState;
        const isFirstRun = Object.keys(previous).length === 0;

        const next: RecordState = { ...previous };
        const messages: string[] = [];

        await Promise.all(
          LEVELS.map(async (level) => {
            let board;
            try {
              board = await fetchLevelBoard(level.id, { deep: true });
            } catch {
              return;
            }
            if (!board.length) return;

            const overallWr = Math.min(...board.map((r) => r.completion_time));

            for (const arrow of ARROWS) {
              const runs = board.filter(
                (r) => (r.arrow_name || "").toLowerCase() === arrow.toLowerCase(),
              );
              if (!runs.length) continue;
              const best = runs.reduce((a, b) => (a.completion_time <= b.completion_time ? a : b));
              const key = `${level.id}|${ARROW_KEY[arrow]}`;
              const prior = previous[key];
              next[key] = { username: best.username, time: best.completion_time };

              if (isFirstRun || !prior) continue;
              if (best.completion_time >= prior.time - 0.0005) continue;

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
            }
          }),
        );

        await supabaseAdmin
          .from("app_docs")
          .upsert(
            { collection: "configs", doc_id: "categoryRecordState", data: next as never },
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
