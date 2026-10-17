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
import { arrowKind } from "@/lib/arrow-sprites";
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
    "{champion}{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [{wrTag}] [{tasTag}]",
  speedy:
    "{champion}{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [{wrTag}] [{tasTag}]",
  energy:
    "{champion}{emoji} **{player}** set a new TAS world record on **{level}** with **{time}** [{wrTag}] [{tasTag}]",
};

/** Champion badge shown first, before the per-arrow emoji. */
export const DEFAULT_TAS_CHAMPION = "<:champion:1351205618534449223>";

export const DEFAULT_TAS_EMOJIS: Record<"narrow" | "speedy" | "energy", string> = {
  narrow: "<:narrow:1356331491746910319>",
  speedy: "<:speedy:1356331493160386620>",
  energy: "<:energy:1356331490010464421>",
};

/** The old built-in emoji set, so a saved config that still carries it picks up
 *  the new custom ones instead of overriding them. */
const LEGACY_TAS_EMOJIS = new Set(["🏆", "🏹", "💨", "⚡"]);

/**
 * Templates often carry a literal sign in front of a diff that already has one
 * (`[WR -{wrDiff}]` with `-0.155` renders `[WR --0.155]`), and a tag with no
 * value leaves an empty bracket pair. Collapse both so every bracket reads
 * cleanly, whichever template the deployment has saved.
 */
function tidyTags(content: string): string {
  return content
    .replace(/\[(WR|wr|TAS|tas) ([+-])[+-]/g, "[$1 $2")
    .replace(/ \[(WR|wr|TAS|tas)\s*(-?—)?\s*\]/g, "")
    .replace(/\[\s*\] ?/g, "");
}

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
  opts: { force?: boolean; announceAll?: boolean } = {},
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
        const runs = tasEntries.filter((e) => arrowKind(e.arrowName) === ARROW_KEY[arrow]);
        if (!runs.length) return;
        const best = runs.reduce((a, b) => (a.timeMs <= b.timeMs ? a : b));
        const timeSec = best.timeMs / 1000;
        const key = `${level.id}|${ARROW_KEY[arrow]}`;
        const prior = previous[key];
        const isNew = !prior || timeSec < prior.time - 0.0005;
        next[key] = { username: best.username, time: timeSec };

        // A level+arrow is baselined once we've recorded a best for it. A run
        // that improves on a baselined best is a record — including the very
        // first run on a level whose board was empty at the last check, which
        // otherwise went unannounced. Only a run that *sets* the baseline (the
        // first observation of that level+arrow) stays silent, and `announceAll`
        // re-announces even those.
        if (!opts.announceAll && (!isNew || (!prior && isFirstRun))) return;

        const slot = ARROW_KEY[arrow];
        // A template saved before the `{wrTag}`/`{tasTag}` split carries a
        // literal sign in front of a diff that already has one, which is what
        // printed `[WR --0.155]`. Detect that shape and use the fixed default
        // instead, so existing deployments heal without a manual re-save.
        const savedTemplate = config.tasTemplates?.[slot];
        const legacyTemplate = !!savedTemplate && /-[{]?(wrDiff|catDiff)[}]/.test(savedTemplate);
        const template =
          savedTemplate && !legacyTemplate ? savedTemplate : DEFAULT_TAS_TEMPLATES[slot];
        const savedEmoji = config.tasEmojis?.[slot];
        const emoji =
          savedEmoji && !LEGACY_TAS_EMOJIS.has(savedEmoji) ? savedEmoji : DEFAULT_TAS_EMOJIS[slot];
        const champion =
          config.tasChampion && !LEGACY_TAS_EMOJIS.has(config.tasChampion)
            ? config.tasChampion
            : DEFAULT_TAS_CHAMPION;
        // TAS run minus the human time: negative means the TAS beats the human WR.
        const wrDiff = overallWr != null ? timeSec - overallWr : null;
        // Gain over the previous TAS record; absent on a level+arrow's first run.
        const catDiff = prior ? prior.time - timeSec : null;
        // The tag is omitted entirely when there is nothing to compare against,
        // so a lone record reads `[WR -0.155]`, never `[WR -0.155] [TAS --]`.
        const wrTag =
          wrDiff == null ? "" : `WR ${wrDiff <= 0 ? "-" : "+"}${Math.abs(wrDiff).toFixed(3)}`;
        const tasTag = catDiff == null ? "" : `TAS -${catDiff.toFixed(3)}`;
        const rendered = template
          .replaceAll("{champion}", champion)
          .replaceAll("{emoji}", emoji)
          .replaceAll("{player}", best.username)
          .replaceAll("{level}", level.name)
          .replaceAll("{arrow}", arrow)
          .replaceAll("{time}", `${timeSec.toFixed(3)}s`)
          .replaceAll("{wr}", overallWr != null ? `${overallWr.toFixed(3)}s` : "—")
          .replaceAll("{wrDiff}", wrDiff != null ? wrDiff.toFixed(3) : "—")
          .replaceAll("{catDiff}", catDiff != null ? catDiff.toFixed(3) : "—")
          .replaceAll("{previous}", prior?.username ?? "—")
          .replaceAll("{wrTag}", wrTag)
          .replaceAll("{tasTag}", tasTag)
          // `{tags}` is the ready-made bracket content; a template wraps it as
          // `[{tags}]` and empty tags collapse without leaving a stray `[]`.
          .replaceAll("{tags}", [wrTag, tasTag].filter(Boolean).join("] ["));
        messages.push(tidyTags(rendered));
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
