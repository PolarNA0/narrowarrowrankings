/**
 * The TAS record tracker.
 *
 * It compares the fastest TAS run per level+arrow against the last announced
 * baseline (`configs/tasRecordState`) and posts a Discord message for every new
 * record. Each message shows how far the TAS time is ahead of the real world
 * record (`[WR -x.xxx]`) and how much it improved on the previous TAS record
 * (`[TAS -x.xxx]`).
 *
 * It is driven from two places: the `tas-wr-check` route (the admin "check now"
 * button and any cron the deployment configures) and the TAS upload handler, so
 * a record is announced the moment it is submitted rather than only on the next
 * poll. Both paths share this module, so a message looks the same either way.
 */
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

export const DEFAULT_TAS_TEMPLATES: Record<"narrow" | "speedy" | "energy", string> = {
  narrow:
    "{champion}{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [WR {wrDiff}] [TAS -{catDiff}]",
  speedy:
    "{champion}{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [WR {wrDiff}] [TAS -{catDiff}]",
  energy:
    "{champion}{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [WR {wrDiff}] [TAS -{catDiff}]",
};

/** Champion badge shown first, before the per-arrow emoji. */
export const DEFAULT_TAS_CHAMPION = "🏆";

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
  /** Badge prefixed before the arrow emoji, e.g. 🏆. */
  tasChampion?: string;
}

interface TasRecordState {
  [key: string]: { username: string; time: number };
}

export interface TasCheckResult {
  tracked?: number;
  newRecords?: number;
  sent?: number;
  baseline?: boolean;
  skipped?: boolean;
  reason?: string;
  intervalMinutes?: number;
}

/**
 * Check the given levels for new TAS records and announce them. Passing
 * `force` ignores the poll interval — the upload path uses it so a fresh
 * submission is announced immediately.
 */
export async function runTasCheck(
  levelIds: string[],
  opts: { force?: boolean } = {},
): Promise<TasCheckResult> {
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
  if (!opts.force && lastRunAt && Date.now() - lastRunAt < intervalMs - 30_000) {
    return { skipped: true, reason: "interval", intervalMinutes: intervalMs / 60_000 };
  }

  const { __lastRunAt: _ignored, ...previousRecords } = stateData;
  const previous = previousRecords as TasRecordState;
  const isFirstRun = Object.keys(previous).length === 0;

  const next: TasRecordState = { ...previous };
  const messages: string[] = [];

  const byId = new Map(LEVELS.map((l) => [l.id, l]));
  const queue = levelIds.map((id) => byId.get(id)).filter((l): l is (typeof LEVELS)[number] => !!l);

  // Only levels that already have a TAS board need the real WR lookup, so the
  // upstream boards are fetched lazily and only for those levels.
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
        const champion = config.tasChampion ?? DEFAULT_TAS_CHAMPION;
        // TAS run minus the human time: negative means the TAS beats the human WR.
        const wrDiff = overallWr != null ? (timeSec - overallWr).toFixed(3) : "0.000";
        messages.push(
          template
            .replaceAll("{champion}", champion)
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

  return {
    tracked: Object.keys(next).length,
    newRecords: messages.length,
    sent,
    baseline: isFirstRun,
  };
}
