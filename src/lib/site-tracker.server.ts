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

/**
 * The world-record message (a run that takes first place) and the position
 * message (a run that places second or worse). They are separate templates
 * because they say different things: one beats the record, the other joins the
 * board behind it.
 */
export const DEFAULT_SITE_WR_TEMPLATE =
  "{champion}{emoji} **{player}** beat the world record on {siteBadge}**{level}** with **{time}** [{wrDiff}]";

export const DEFAULT_SITE_POSITION_TEMPLATE =
  "{emoji} **{player}** took position **{position}** on **{level}** with **{time}** [{wrDiff}]";

/**
 * The default before the WR/position split. A config saved back then holds this
 * string verbatim; it is treated as "never customized" so the new wording takes
 * effect, while a hand-written template is always left alone.
 */
export const LEGACY_SITE_TEMPLATE =
  "{emoji}{siteBadge} **{player}** set a new site record on **{level}** with **{time}** [{siteTag}]";

/** No badge by default; the tag exists so a deployment can add e.g. a globe. */
export const DEFAULT_SITE_BADGE = "";
/** No champion emote by default; the tag marks a world record. */
export const DEFAULT_SITE_CHAMPION = "";

export const DEFAULT_SITE_EMOJIS: Record<SiteArrowSlot, string> = {
  narrow: "<:narrow:1356331491746910319>",
  speedy: "<:speedy:1356331493160386620>",
  energy: "<:energy:1356331490010464421>",
};

export interface SiteMessageValues {
  emoji: string;
  siteBadge: string;
  /** Marks a world record, e.g. a trophy; empty on a position message. */
  champion: string;
  player: string;
  level: string;
  time: string;
  clock: string;
  arrow: string;
  author: string;
  /** "custom" when the level uses the site-only puzzle/field mechanics, else "". */
  custom: string;
  /** The player's place on the board, e.g. "3". */
  position: string;
  /** Ready-made bracket content, e.g. `WR -0.155` or `WR +1.204`. */
  wrDiff: string;
  /** Alias of `{wrDiff}`, kept so older templates that used `{siteTag}` still fill. */
  siteTag: string;
  /** Raw signed gap in seconds: "-0.155" when ahead of the WR, "+1.204" behind, "—" with no WR. */
  diff: string;
  previous: string;
  /** The record holder's name, or "—" when the board has no other run. */
  recordHolder: string;
}

/**
 * Templates often carry a literal sign in front of a diff that is already
 * signed (`[WR +{diff}]` with `-0.155` renders `[WR +-0.155]`), and a tag with
 * no value leaves an empty bracket pair. Collapse both so every bracket reads
 * cleanly, whichever template the deployment has saved.
 *
 * Two signs in a row are resolved in favour of the *value's* sign, which is the
 * meaningful one: `[WR --3.000]` and `[WR +-3.000]` both mean 3.000 ahead, so
 * both must render `[WR -3.000]`. Dropping the literal sign rather than the
 * value's is what keeps a genuine negative gain from flipping to a positive one.
 */
export function tidySiteTags(content: string): string {
  return content
    .replace(/\[(WR|SITE|site) [+-](?=[+-])/g, "[$1 ")
    .replace(/ ?\[(WR|SITE|site)\s*[+-]?\s*—?\s*\]/g, "")
    .replace(/\[\s*\] ?/g, "")
    .trim();
}

/** Fill a saved (or default) template with a record's values. */
export function renderSiteMessage(template: string, v: SiteMessageValues): string {
  return tidySiteTags(
    template
      .replaceAll("{emoji}", v.emoji)
      .replaceAll("{siteBadge}", v.siteBadge)
      .replaceAll("{champion}", v.champion)
      .replaceAll("{player}", v.player)
      .replaceAll("{level}", v.level)
      .replaceAll("{time}", v.time)
      .replaceAll("{clock}", v.clock)
      .replaceAll("{arrow}", v.arrow)
      .replaceAll("{author}", v.author)
      .replaceAll("{custom}", v.custom)
      .replaceAll("{position}", v.position)
      .replaceAll("{wrDiff}", v.wrDiff)
      // `{tags}` and `{siteTag}` are the same ready-made bracket content; a
      // template wraps them as `[{tags}]` and empty tags collapse cleanly.
      .replaceAll("{siteTag}", v.siteTag)
      .replaceAll("{tags}", v.siteTag)
      .replaceAll("{diff}", v.diff)
      .replaceAll("{previous}", v.previous)
      .replaceAll("{recordHolder}", v.recordHolder),
  );
}

/**
 * Pick the template to render with. A config that predates the WR/position
 * split holds the old default verbatim, which is treated as "not customized" so
 * the new pair applies; anything hand-written is used as-is.
 */
export function resolveSiteTemplate(saved: string | undefined, kind: "wr" | "position"): string {
  const fallback = kind === "wr" ? DEFAULT_SITE_WR_TEMPLATE : DEFAULT_SITE_POSITION_TEMPLATE;
  if (!saved || saved === LEGACY_SITE_TEMPLATE) return fallback;
  return saved;
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
  /** Legacy single template (pre WR/position split); read, never written anew. */
  siteTemplate?: string;
  /** Template for a run that takes first place. */
  siteWrTemplate?: string;
  /** Template for a run that places second or worse. */
  sitePositionTemplate?: string;
  siteBadge?: string;
  siteChampion?: string;
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
  /** The messages this check built, in order. Exposed so a caller can preview
   *  exactly what would be posted (and so the tracker's behaviour is testable
   *  without a webhook). */
  messages?: string[];
}

/**
 * A live submission the tracker should announce: the run that was just added to
 * a level's board. The route supplies it so a run that places second or worse
 * can be announced as a position, which a bulk poll cannot see (it only compares
 * each level's best against the baseline).
 */
export interface SiteSubmission {
  levelId: string;
  /** The stored entry's id, used to find its place on the board. */
  id: string;
  username: string;
  timeMs: number;
  arrowName: string;
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
 * Build the Discord message for a run that takes first place. Pure, so the exact
 * content the tracker would post is testable without a webhook. The bracket is
 * `WR -x.xxx` (the gain over the previous record), or empty on a level's first
 * record where there is nothing to compare against.
 */
export function buildSiteRecordMessage(
  level: { name: string; author: string; arrowName: string; hasCustomMechanics: boolean },
  best: { username: string; timeMs: number; arrowName: string },
  prior: SitePrior | undefined,
  config: Pick<
    SiteTrackerConfig,
    "siteTemplate" | "siteWrTemplate" | "siteBadge" | "siteChampion" | "siteEmojis"
  > = {},
): string {
  const slot = arrowKind(best.arrowName || level.arrowName);
  const diffSec = prior ? (prior.timeMs - best.timeMs) / 1000 : null;
  return renderSiteMessage(
    resolveSiteTemplate(config.siteWrTemplate ?? config.siteTemplate, "wr"),
    {
      emoji: config.siteEmojis?.[slot] || DEFAULT_SITE_EMOJIS[slot],
      siteBadge: config.siteBadge ?? DEFAULT_SITE_BADGE,
      champion: config.siteChampion ?? DEFAULT_SITE_CHAMPION,
      player: best.username,
      level: level.name,
      time: `${(best.timeMs / 1000).toFixed(3)}s`,
      clock: clock(best.timeMs),
      arrow: best.arrowName || level.arrowName,
      author: level.author,
      custom: level.hasCustomMechanics ? "custom" : "",
      position: "1",
      wrDiff: diffSec == null ? "" : `WR -${diffSec.toFixed(3)}`,
      siteTag: diffSec == null ? "" : `WR -${diffSec.toFixed(3)}`,
      diff: diffSec == null ? "—" : `-${diffSec.toFixed(3)}`,
      previous: prior?.username ?? "—",
      recordHolder: prior?.username ?? "—",
    },
  );
}

/**
 * Build the Discord message for a run that places second or worse. `wrTimeMs` is
 * the board's fastest time (the world record), so the bracket reads `WR +x.xxx`
 * — how far this run sits behind it.
 */
export function buildSitePositionMessage(
  level: { name: string; author: string; arrowName: string; hasCustomMechanics: boolean },
  run: { username: string; timeMs: number; arrowName: string; position: number },
  wr: SitePrior | undefined,
  config: Pick<SiteTrackerConfig, "sitePositionTemplate" | "siteBadge" | "siteEmojis"> = {},
): string {
  const slot = arrowKind(run.arrowName || level.arrowName);
  const gapSec = wr ? (run.timeMs - wr.timeMs) / 1000 : null;
  return renderSiteMessage(resolveSiteTemplate(config.sitePositionTemplate, "position"), {
    emoji: config.siteEmojis?.[slot] || DEFAULT_SITE_EMOJIS[slot],
    siteBadge: config.siteBadge ?? DEFAULT_SITE_BADGE,
    // A position message is never a record, so the champion mark is empty.
    champion: "",
    player: run.username,
    level: level.name,
    time: `${(run.timeMs / 1000).toFixed(3)}s`,
    clock: clock(run.timeMs),
    arrow: run.arrowName || level.arrowName,
    author: level.author,
    custom: level.hasCustomMechanics ? "custom" : "",
    position: String(run.position),
    wrDiff: gapSec == null ? "" : `WR +${gapSec.toFixed(3)}`,
    siteTag: gapSec == null ? "" : `WR +${gapSec.toFixed(3)}`,
    diff: gapSec == null ? "—" : `+${gapSec.toFixed(3)}`,
    previous: wr?.username ?? "—",
    recordHolder: wr?.username ?? "—",
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
 *
 * `submission` is a live run the route just stored. When the level's best is a
 * new record it is announced as a world record (the usual path); when it is not
 * — the run placed second or worse — it is announced as a position instead,
 * which the poll alone cannot see. The record path is deliberately unchanged:
 * the submission only *adds* a position message, it never suppresses the record
 * message, so a submission that does set the record still announces it exactly
 * once.
 */
export async function runSiteCheck(
  levelIds: string[],
  opts: {
    force?: boolean;
    announceAll?: boolean;
    fromSubmit?: boolean;
    submission?: SiteSubmission;
  } = {},
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
  // A level whose best run set a record, so the position pass knows to leave it
  // alone (its run was already announced as the world record).
  const announcedRecords = new Set<string>();

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

      // With a live submission in hand, announce the level best only when the
      // submission *is* that best. A submission that placed lower is announced
      // by the position pass below; announcing the existing best here would
      // credit the record holder's run to this submission instead.
      const sub = opts.submission;
      if (sub && sub.levelId === level.id && best.id !== sub.id) continue;
      if (!decision.announce) continue;

      announcedRecords.add(level.id);
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

  // A live submission that did not set the record: announce where it placed.
  // Only the submission path can do this — the poll sees a level's best, not the
  // run that was just added — so it is gated on `submission` being present.
  if (opts.submission) {
    const sub = opts.submission;
    const level = levels.find((l) => l.id === sub.levelId);
    if (level && !announcedRecords.has(level.id)) {
      const entries = sortSiteScores(await readSiteScores(level.id));
      const rank = entries.findIndex((e) => e.id === sub.id);
      const wr = entries[0];
      // rank 0 is the record (handled above); a missing id means the board
      // changed under us, so there is nothing reliable to announce.
      if (rank > 0 && wr) {
        messages.push(
          buildSitePositionMessage(
            level,
            {
              username: sub.username,
              timeMs: sub.timeMs,
              arrowName: sub.arrowName || level.arrowName,
              position: rank + 1,
            },
            { username: wr.username, timeMs: wr.timeMs },
            config,
          ),
        );
      }
    }
  }

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
    messages,
  };
}
