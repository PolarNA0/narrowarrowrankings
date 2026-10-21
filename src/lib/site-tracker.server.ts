/**
 * The site level record tracker.
 *
 * Site levels are hosted here and carry their own single leaderboard (one board
 * per level, not one per arrow), so they get their own Discord feed rather than
 * riding on the real-game category or TAS trackers. It compares each level's
 * fastest submitted run against the last announced baseline
 * (`configs/siteRecordState`) and posts a message for every new record, showing
 * the gain over the previous record.
 *
 * It is driven from two places: the `site-wr-check` route (the admin "check now"
 * button and any cron the deployment configures) and the score submit handler,
 * so a record is announced the moment it is submitted rather than only on the
 * next poll. Both paths share this module, so a message looks the same either
 * way.
 */
import { listSiteLevels } from "@/lib/site-levels.server";
import { readSiteScores, sortSiteScores } from "@/lib/site-scores.server";
import { arrowKind } from "@/lib/arrow-sprites";

export type SiteArrowSlot = "narrow" | "speedy" | "energy";

/** Default message: the arrow emoji, the player, the level, the time and the gain. */
export const DEFAULT_SITE_TEMPLATE =
  "{emoji}{siteBadge} **{player}** set a new site record on **{level}** with **{time}** [{siteTag}]";

/** No badge by default; the tag exists so a deployment can add e.g. a globe. */
export const DEFAULT_SITE_BADGE = "";

export const DEFAULT_SITE_EMOJIS: Record<SiteArrowSlot, string> = {
  narrow: "<:narrow:1356331491746910319>",
  speedy: "<:speedy:1356331493160386620>",
  energy: "<:energy:1356331490010464421>",
};

export interface SiteMessageValues {
  emoji: string;
  siteBadge: string;
  player: string;
  level: string;
  time: string;
  clock: string;
  arrow: string;
  author: string;
  /** "custom" when the level uses the site-only puzzle/field mechanics, else "". */
  custom: string;
  /** Ready-made bracket content, e.g. `SITE -0.155`; empty on a level's first record. */
  siteTag: string;
  /** Raw gain in seconds, or "—" when there is nothing to compare against. */
  diff: string;
  previous: string;
}

/**
 * Templates often carry a literal sign in front of a diff that already has one
 * (`[SITE -{diff}]` with `0.155` renders `[SITE --0.155]`), and a tag with no
 * value leaves an empty bracket pair. Collapse both so every bracket reads
 * cleanly, whichever template the deployment has saved.
 */
export function tidySiteTags(content: string): string {
  return content
    .replace(/\[(SITE|site) ([+-])[+-]/g, "[$1 $2")
    .replace(/ \[(SITE|site)\s*(-?—)?\s*\]/g, "")
    .replace(/\[\s*\] ?/g, "")
    .trim();
}

/** Fill a saved (or default) template with a record's values. */
export function renderSiteMessage(template: string, v: SiteMessageValues): string {
  return tidySiteTags(
    template
      .replaceAll("{emoji}", v.emoji)
      .replaceAll("{siteBadge}", v.siteBadge)
      .replaceAll("{player}", v.player)
      .replaceAll("{level}", v.level)
      .replaceAll("{time}", v.time)
      .replaceAll("{clock}", v.clock)
      .replaceAll("{arrow}", v.arrow)
      .replaceAll("{author}", v.author)
      .replaceAll("{custom}", v.custom)
      .replaceAll("{siteTag}", v.siteTag)
      .replaceAll("{diff}", v.diff)
      .replaceAll("{previous}", v.previous)
      // `{tags}` is the ready-made bracket content; a template wraps it as
      // `[{tags}]` and empty tags collapse without leaving a stray `[]`.
      .replaceAll("{tags}", v.siteTag),
  );
}

export interface SitePrior {
  username: string;
  timeMs: number;
}

export interface SiteDecision {
  /** The run is the level's fastest so far. */
  isNew: boolean;
  /** The run should be announced now. */
  announce: boolean;
  /** Gain over the previous record in seconds, or null on a level's first record. */
  diffSec: number | null;
}

/**
 * Decide whether a level's best run is a record worth announcing.
 *
 * A faster run than the baselined best is always a record. The one silent case
 * is a *bulk poll* seeding a cold tracker: when the feed is switched on it would
 * otherwise post every pre-existing level's record at once, so the run that sets
 * a level's baseline is quiet there.
 *
 * A live submission (`fromSubmit`) is never that case — the player just set the
 * level's best, and there is no backlog to protect against — so a new level's
 * first record is announced immediately rather than swallowed as a baseline.
 */
export function decideSiteRecord(
  prior: SitePrior | undefined,
  bestMs: number,
  opts: { isFirstRun: boolean; announceAll?: boolean; fromSubmit?: boolean },
): SiteDecision {
  const isNew = !prior || bestMs < prior.timeMs;
  const seedingBaseline = !prior && opts.isFirstRun && !opts.fromSubmit;
  const announce = !!opts.announceAll || (isNew && !seedingBaseline);
  return { isNew, announce, diffSec: prior ? (prior.timeMs - bestMs) / 1000 : null };
}

interface SiteTrackerConfig {
  webhookUrl?: string;
  enabled?: boolean;
  intervalMinutes?: number;
  siteWebhookUrl?: string;
  siteEnabled?: boolean;
  siteIntervalMinutes?: number;
  siteTemplate?: string;
  siteBadge?: string;
  siteEmojis?: Partial<Record<SiteArrowSlot, string>>;
}

interface SiteRecordState {
  [levelId: string]: SitePrior;
}

export interface SiteCheckResult {
  tracked?: number;
  newRecords?: number;
  sent?: number;
  baseline?: boolean;
  skipped?: boolean;
  reason?: string;
  intervalMinutes?: number;
}

/** "1:02.345" — the site board's own clock format, for the `{clock}` tag. */
function clock(ms: number): string {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** A Discord webhook URL, checked before we treat a value as deliverable. */
export function isDiscordWebhook(url: string | undefined | null): boolean {
  return !!url && url.trim().startsWith("https://discord.com/api/webhooks/");
}

/**
 * Post one message to a Discord webhook. Mentions are always disabled so a
 * player name can never ping a role, and delivery is best effort — a dead or
 * slow webhook returns false rather than throwing into the caller's request.
 */
export async function postDiscordMessage(webhookUrl: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Local dev has no service-role key, so config/state are kept in memory there,
 *  mirroring the site level and score stores. Production always uses Supabase. */
const memoryDocs = new Map<string, unknown>();
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Build the Discord message for a level's record run. Pure, so the exact content
 * the tracker would post is testable without a webhook.
 */
export function buildSiteRecordMessage(
  level: { name: string; author: string; arrowName: string; hasCustomMechanics: boolean },
  best: { username: string; timeMs: number; arrowName: string },
  prior: SitePrior | undefined,
  config: Pick<SiteTrackerConfig, "siteTemplate" | "siteBadge" | "siteEmojis"> = {},
): string {
  const slot = arrowKind(best.arrowName || level.arrowName);
  const diffSec = prior ? (prior.timeMs - best.timeMs) / 1000 : null;
  return renderSiteMessage(config.siteTemplate || DEFAULT_SITE_TEMPLATE, {
    emoji: config.siteEmojis?.[slot] || DEFAULT_SITE_EMOJIS[slot],
    siteBadge: config.siteBadge ?? DEFAULT_SITE_BADGE,
    player: best.username,
    level: level.name,
    time: `${(best.timeMs / 1000).toFixed(3)}s`,
    clock: clock(best.timeMs),
    arrow: best.arrowName || level.arrowName,
    author: level.author,
    custom: level.hasCustomMechanics ? "custom" : "",
    siteTag: diffSec == null ? "" : `SITE -${diffSec.toFixed(3)}`,
    diff: diffSec == null ? "—" : diffSec.toFixed(3),
    previous: prior?.username ?? "—",
  });
}

async function readDoc(docId: string): Promise<unknown> {
  if (memoryStoreEnabled()) return memoryDocs.get(docId) ?? null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_docs")
    .select("data")
    .eq("collection", "configs")
    .eq("doc_id", docId)
    .maybeSingle();
  return data?.data ?? null;
}

async function writeDoc(docId: string, data: unknown): Promise<void> {
  if (memoryStoreEnabled()) {
    memoryDocs.set(docId, data);
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("app_docs").upsert(
    {
      collection: "configs",
      doc_id: docId,
      data: data as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
}

/**
 * Check the given site levels for new records and announce them. Passing `force`
 * ignores the poll interval — the submit path uses it so a fresh record is
 * announced immediately.
 */
export async function runSiteCheck(
  levelIds: string[],
  opts: { force?: boolean; announceAll?: boolean; fromSubmit?: boolean } = {},
): Promise<SiteCheckResult> {
  let configRow: unknown;
  let stateRow: unknown;
  try {
    [configRow, stateRow] = await Promise.all([
      readDoc("discordTracker"),
      readDoc("siteRecordState"),
    ]);
  } catch {
    return { skipped: true, reason: "storage" };
  }

  const config = (configRow ?? {}) as SiteTrackerConfig;
  const stateData = (stateRow ?? {}) as SiteRecordState & { __lastRunAt?: string };

  // The site feed shares the Discord webhook by default; an override lets it
  // post elsewhere without touching the other feeds.
  const webhookUrl = (config.siteWebhookUrl || config.webhookUrl || "").trim();
  const enabled = config.siteEnabled !== false && config.enabled !== false;

  const intervalMs =
    Math.max(5, Number(config.siteIntervalMinutes ?? config.intervalMinutes) || 5) * 60_000;
  const lastRunAt = stateData.__lastRunAt ? Date.parse(String(stateData.__lastRunAt)) : 0;
  if (!opts.force && lastRunAt && Date.now() - lastRunAt < intervalMs - 30_000) {
    return { skipped: true, reason: "interval", intervalMinutes: intervalMs / 60_000 };
  }

  const { __lastRunAt: _ignored, ...previousRecords } = stateData;
  const previous = previousRecords as SiteRecordState;
  const isFirstRun = Object.keys(previous).length === 0;

  const next: SiteRecordState = { ...previous };
  const messages: string[] = [];

  const wanted = new Set(levelIds);
  const levels = (await listSiteLevels()).filter((l) => wanted.has(l.id));

  // A handful of levels, each one board read; four at a time keeps a large
  // manifest from serialising every read.
  const queue = [...levels];
  const worker = async () => {
    for (;;) {
      const level = queue.shift();
      if (!level) return;

      const entries = sortSiteScores(await readSiteScores(level.id));
      const best = entries[0];
      if (!best) continue;

      const prior = previous[level.id];
      const decision = decideSiteRecord(prior, best.timeMs, {
        isFirstRun,
        announceAll: opts.announceAll,
        fromSubmit: opts.fromSubmit,
      });
      next[level.id] = { username: best.username, timeMs: best.timeMs };
      if (!decision.announce) continue;

      messages.push(
        buildSiteRecordMessage(
          level,
          {
            username: best.username,
            timeMs: best.timeMs,
            arrowName: best.arrowName || level.arrowName,
          },
          prior,
          config,
        ),
      );
    }
  };

  await Promise.all(Array.from({ length: 4 }, worker));

  await writeDoc("siteRecordState", { ...next, __lastRunAt: new Date().toISOString() });

  let sent = 0;
  if (enabled && isDiscordWebhook(webhookUrl) && messages.length) {
    for (const content of messages.slice(0, 20)) {
      if (await postDiscordMessage(webhookUrl, content)) sent += 1;
    }
  }

  return {
    tracked: Object.keys(next).length,
    newRecords: messages.length,
    sent,
    baseline: isFirstRun,
  };
}
