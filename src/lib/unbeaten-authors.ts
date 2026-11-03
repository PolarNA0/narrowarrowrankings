/**
 * "Unbeaten authors": community levels whose creator's own time is still the
 * fastest anyone has recorded.
 *
 * A community level's `medals.topTime` is the *author's* completion time — the
 * level's top/diamond threshold is seeded from the author's run, so it matches
 * the creator's own leaderboard entry exactly (verified on 15/15 sampled custom
 * levels). The level is unbeaten while no recorded run has gone under that time.
 * On an *official pack* level `topTime` is instead a designed cutoff (Highway
 * Jet: WR 13.779 but `topTime` 16.7), so those levels carry no author-time
 * signal and are excluded outright rather than offered as a toggle.
 *
 * Pure, so the view and `scripts/verify-unbeaten-authors.ts` share one
 * definition of "unbeaten".
 */
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";

/** The `/published-levels` fields this view reads. */
export interface CustomLevelEntry {
  level_id?: string;
  name?: string;
  creator_name?: string | null;
  like_count?: number | null;
  play_count?: number | null;
  created_at?: string | null;
  /** Official pack levels carry a pack object; community levels carry null. */
  pack?: { slug?: string; name?: string } | null;
  world_record?: {
    completion_time?: number;
    username?: string;
    arrow_name?: string;
  } | null;
  medals?: { topTime?: number; finisherCount?: number } | null;
}

/**
 * The projection of a feed entry that the snapshot stores. A raw feed entry
 * carries the level's whole obstacle list (~80KB each), so keeping it verbatim
 * would make the snapshot and every response tens of megabytes.
 */
export interface CustomLevelCompact {
  level_id: string;
  name: string;
  creator_name: string | null;
  like_count: number;
  play_count: number;
  created_at: string | null;
  pack: { slug?: string; name?: string } | null;
  world_record: { completion_time: number; username: string; arrow_name: string } | null;
  medals: { topTime?: number; finisherCount: number } | null;
}

export interface UnbeatenAuthorRow {
  levelId: string;
  levelName: string;
  author: string;
  /** The author's own completion time, from the level's `topTime`. */
  authorTime: number;
  /** The fastest recorded run on the level. */
  bestTime: number;
  /** Who holds that fastest run. */
  holder: string;
  /** True when the holder is the creator, i.e. the author still tops the board. */
  authorHoldsRecord: boolean;
  /** `bestTime - authorTime`: how far the author still leads (0 when merely tied). */
  gap: number;
  arrow: string;
  plays: number;
  likes: number;
  finishers: number;
  createdAt: string | null;
}

export interface UnbeatenAuthorOptions {
  /** Drop levels played fewer than this many times (default 0). */
  minPlays?: number;
  /** Restrict to one arrow. */
  arrow?: ArrowKind;
}

/**
 * Half a 240Hz tick. The feed's times are floats, so an exact `>=` could flip a
 * genuinely tied record; this absorbs that noise without hiding a real beating.
 */
export const UNBEATEN_TOLERANCE = 0.002;

/**
 * A time at or under this is a joke level (or a cheat): the feed contains levels
 * whose "record" is a few milliseconds long, and listing them would make the
 * table meaningless.
 */
export const MIN_RECORD_SECONDS = 1;

/** Player names are compared case- and whitespace-insensitively. */
function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x.length > 0 && x === y;
}

/**
 * The author's own time on a community level, or null when it is unknowable —
 * an official pack level (where `topTime` is a designed cutoff), a level with no
 * medal data, or one whose `topTime` is absent or below the joke-level floor.
 */
export function authorTimeOf(entry: CustomLevelEntry): number | null {
  if (entry.pack) return null;
  const time = entry.medals?.topTime;
  if (typeof time !== "number" || !Number.isFinite(time) || time < MIN_RECORD_SECONDS) return null;
  return time;
}

/** The fastest recorded run on the level, or null when it has none. */
function bestTimeOf(entry: CustomLevelEntry): number | null {
  const best = entry.world_record?.completion_time;
  if (typeof best !== "number" || !Number.isFinite(best) || best < MIN_RECORD_SECONDS) return null;
  return best;
}

/**
 * True while the author's own time stands: the fastest recorded run has not gone
 * under it. A run that merely ties the author is not a beating, so it stays.
 */
export function isAuthorUnbeaten(entry: CustomLevelEntry): boolean {
  const authorTime = authorTimeOf(entry);
  const best = bestTimeOf(entry);
  if (authorTime === null || best === null) return false;
  return best >= authorTime - UNBEATEN_TOLERANCE;
}

/** Every level whose author time still stands, as table rows. */
export function buildUnbeatenAuthorRows(
  entries: Iterable<CustomLevelEntry>,
  options: UnbeatenAuthorOptions = {},
): UnbeatenAuthorRow[] {
  const rows: UnbeatenAuthorRow[] = [];
  for (const entry of entries) {
    if (!entry?.level_id) continue;
    const authorTime = authorTimeOf(entry);
    const best = bestTimeOf(entry);
    if (authorTime === null || best === null) continue;
    if (best < authorTime - UNBEATEN_TOLERANCE) continue;
    const arrow = entry.world_record?.arrow_name ?? "";
    if (options.arrow && arrowKind(arrow) !== options.arrow) continue;
    const plays = Number(entry.play_count) || 0;
    if (plays < (options.minPlays ?? 0)) continue;
    rows.push({
      levelId: entry.level_id,
      levelName: entry.name || entry.level_id,
      author: (entry.creator_name ?? "").trim(),
      authorTime,
      bestTime: best,
      holder: (entry.world_record?.username ?? "").trim(),
      authorHoldsRecord: sameName(entry.creator_name, entry.world_record?.username),
      gap: Math.max(0, best - authorTime),
      arrow,
      plays,
      likes: Number(entry.like_count) || 0,
      finishers: Number(entry.medals?.finisherCount) || 0,
      createdAt: entry.created_at ?? null,
    });
  }
  return rows;
}

export type UnbeatenSort = "plays" | "gap" | "time" | "recent" | "author";

/**
 * `plays` puts the most-contested unbeaten times first, which is the honest
 * ranking of "hardest to take" — a time nobody has played against proves little.
 * `gap` is the widest margin the author still holds, `time` the fastest author
 * time, `recent` the newest level, `author` groups by name.
 */
export function sortUnbeatenAuthorRows(
  rows: UnbeatenAuthorRow[],
  by: UnbeatenSort,
): UnbeatenAuthorRow[] {
  const sorted = [...rows];
  const byName = (a: UnbeatenAuthorRow, b: UnbeatenAuthorRow) =>
    a.levelName.localeCompare(b.levelName);
  switch (by) {
    case "gap":
      return sorted.sort((a, b) => b.gap - a.gap || byName(a, b));
    case "time":
      return sorted.sort((a, b) => a.authorTime - b.authorTime || byName(a, b));
    case "recent":
      return sorted.sort(
        (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || byName(a, b),
      );
    case "author":
      return sorted.sort(
        (a, b) => a.author.localeCompare(b.author) || a.authorTime - b.authorTime || byName(a, b),
      );
    default:
      return sorted.sort((a, b) => b.plays - a.plays || byName(a, b));
  }
}

export interface UnbeatenAuthorSummary {
  levels: number;
  authors: number;
  /** Summed plays across the unbeaten levels — how contested the set is. */
  plays: number;
  /** The fastest author time, in seconds, or null when there are no rows. */
  fastest: number | null;
  /** The narrowest surviving margin — the record most likely to fall next. */
  closest: number | null;
}

export function summariseUnbeatenAuthors(rows: UnbeatenAuthorRow[]): UnbeatenAuthorSummary {
  const authors = new Set<string>();
  let plays = 0;
  let fastest: number | null = null;
  let closest: number | null = null;
  for (const row of rows) {
    authors.add(row.author.trim().toLowerCase());
    plays += row.plays;
    if (fastest === null || row.authorTime < fastest) fastest = row.authorTime;
    if (closest === null || row.gap < closest) closest = row.gap;
  }
  return { levels: rows.length, authors: authors.size, plays, fastest, closest };
}

export interface AuthorTally {
  author: string;
  /** How many of the author's levels still stand unbeaten. */
  defended: number;
  /** The most-played unbeaten level, so a tie can be broken sensibly. */
  topPlays: number;
}

/** One row per author, most unbeaten levels first. */
export function tallyUnbeatenAuthors(rows: UnbeatenAuthorRow[]): AuthorTally[] {
  const byAuthor = new Map<string, AuthorTally>();
  for (const row of rows) {
    const key = row.author.trim().toLowerCase();
    const current = byAuthor.get(key);
    if (current) {
      current.defended += 1;
      current.topPlays = Math.max(current.topPlays, row.plays);
    } else {
      byAuthor.set(key, { author: row.author, defended: 1, topPlays: row.plays });
    }
  }
  return [...byAuthor.values()].sort(
    (a, b) =>
      b.defended - a.defended || b.topPlays - a.topPlays || a.author.localeCompare(b.author),
  );
}
