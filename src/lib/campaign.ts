/**
 * Campaign scoring.
 *
 * A campaign is a fixed set of hand-picked levels run inside a window (all
 * levels released together). Each level awards up to `CAMPAIGN_MAX_POINTS`
 * (1000) and a player's campaign total is the sum over **all** campaign levels,
 * counting only their fastest run on any one arrow.
 *
 * ## Why time dominates position
 *
 * A score is driven by how close the run is to the level's world record, with
 * leaderboard position applied as a *small* modifier. Placement alone must not
 * pay: finishing 2nd on a weak board is not the same achievement as finishing
 * 2nd a hundredth off the WR, and the brief is explicit that a good placement
 * with a mediocre time should not score well. So position can cost at most
 * `MAX_POSITION_PENALTY` of the score — enough to separate equal times, never
 * enough to rescue a slow one.
 *
 * ## Why the anchor is the all-time WR, not the campaign's own best
 *
 * Anchoring to the best time set *during* the campaign would mean a player's
 * score falls when somebody else improves — you would lose points for not
 * racing. Anchoring to the level's all-time WR keeps every score monotonic: it
 * only moves when *you* improve. The WR run (and anything tied with it) is
 * therefore the 1000.
 */

import type { LeaderboardEntry } from "../types";
import { toStandings } from "./medals";

/** Maximum points a single level can award. */
export const CAMPAIGN_MAX_POINTS = 1000;

/**
 * Steepness of the time decay. A run `g` (relative) off the WR scores
 * `MAX / (1 + g * GAP_STEEPNESS)`, so a larger value makes a given gap cost more.
 */
export const GAP_STEEPNESS = 18;

/** Largest fraction of the score position alone can cost. */
export const MAX_POSITION_PENALTY = 0.1;

/** One curated level in a campaign, tagged with its own free colour. */
export interface CampaignLevel {
  id: string;
  name: string;
  /**
   * Hex colour the curator assigned to this level, e.g. `#38BDF8`. Purely
   * presentational — it is the level's identity in the list, not a grouping
   * that affects scoring.
   */
  color: string;
}

/**
 * A campaign. `levels` is the **frozen** curated list: editing it after the
 * campaign starts would rescale every player's total, so a change is a new
 * campaign rather than an edit.
 */
export interface Campaign {
  id: string;
  name: string;
  /** Epoch ms. All levels are open for the whole window. */
  startsAt: number;
  endsAt: number;
  levels: CampaignLevel[];
}

/**
 * The colours a freshly added level cycles through, so a new campaign is
 * visually varied without the curator touching a picker. Any hex is accepted;
 * these are only a pleasant default sequence.
 */
export const CAMPAIGN_COLOR_PALETTE = [
  "#38bdf8",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#22d3ee",
  "#a3e635",
  "#f97316",
  "#c084fc",
] as const;

/** The palette colour at `index`, wrapping. */
export function campaignPaletteColor(index: number): string {
  return CAMPAIGN_COLOR_PALETTE[index % CAMPAIGN_COLOR_PALETTE.length];
}

/** Shown when a stored colour is missing or unparsable. */
export const CAMPAIGN_FALLBACK_COLOR = "#64748b";

/**
 * Normalises a colour to a `#rrggbb` string, falling back when it is absent or
 * unparsable. Accepts a bare `#rgb`/`#rrggbb` and expands the short form, so a
 * colour typed into a picker and one stored by an older payload agree.
 */
export function normalizeCampaignColor(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return CAMPAIGN_FALLBACK_COLOR;
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  return CAMPAIGN_FALLBACK_COLOR;
}

export interface CampaignLevelScore {
  levelId: string;
  levelName: string;
  /** The level's own colour, copied through for the per-level rows. */
  color: string;
  /** The player's fastest run on this level, any arrow. */
  time: number;
  wrTime: number;
  position: number;
  entrants: number;
  points: number;
}

export interface CampaignStanding {
  username: string;
  /** Sum of `levels[].points`, counting every campaign level. */
  points: number;
  /** `levels.length * CAMPAIGN_MAX_POINTS` — the perfect campaign. */
  maxPoints: number;
  levelsPlayed: number;
  levelCount: number;
  /** Best (lowest) finish across the campaign, or null if unplayed. */
  bestFinish: number | null;
  /** Sum of the times that earned the points. Used only to break equal points. */
  totalTime: number;
  levels: CampaignLevelScore[];
}

export type CampaignStatus = "upcoming" | "live" | "ended";

/**
 * Points for one run, out of `CAMPAIGN_MAX_POINTS`.
 *
 * A run at or under the WR is a perfect score. Otherwise the time gap sets the
 * pace score and the position applies a bounded penalty on top.
 */
export function campaignLevelPoints(time: number, wrTime: number, position: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(wrTime) || time <= 0 || wrTime <= 0) return 0;
  if (time <= wrTime) return CAMPAIGN_MAX_POINTS;

  const gapRatio = (time - wrTime) / wrTime;
  const paceScore = CAMPAIGN_MAX_POINTS / (1 + gapRatio * GAP_STEEPNESS);

  // log10 keeps the penalty gentle near the top and saturating far down the
  // board, so rank 2 is barely docked while a tail finish is capped.
  const positionPenalty = Math.min(MAX_POSITION_PENALTY, Math.log10(Math.max(1, position)) * 0.05);

  return Math.max(0, Math.round(paceScore * (1 - positionPenalty)));
}

export function campaignStatus(campaign: Campaign, now: number): CampaignStatus {
  if (now < campaign.startsAt) return "upcoming";
  if (now > campaign.endsAt) return "ended";
  return "live";
}

/**
 * Builds the campaign standings from the merged boards.
 *
 * Each player is scored once per level on their fastest run (any arrow), and a
 * level they never ran simply contributes nothing — the campaign counts all 25
 * levels, so skipping one is a real loss rather than a re-scaled average.
 */
export function buildCampaignStandings(
  campaign: Campaign,
  data: Record<string, LeaderboardEntry[]>,
): CampaignStanding[] {
  const players = new Map<string, CampaignStanding>();
  const levelCount = campaign.levels.length;
  const maxPoints = levelCount * CAMPAIGN_MAX_POINTS;

  const ensure = (username: string): CampaignStanding => {
    let row = players.get(username);
    if (!row) {
      row = {
        username,
        points: 0,
        maxPoints,
        levelsPlayed: 0,
        levelCount,
        bestFinish: null,
        totalTime: 0,
        levels: [],
      };
      players.set(username, row);
    }
    return row;
  };

  for (const level of campaign.levels) {
    const standings = toStandings(data[level.id] || []);
    if (standings.length === 0) continue;

    const wrTime = standings[0].completion_time;

    // Competition ranking: equal times share the best of their positions.
    let position = 0;
    let previousTime: number | null = null;
    standings.forEach((entry, index) => {
      if (previousTime === null || entry.completion_time !== previousTime) {
        position = index + 1;
        previousTime = entry.completion_time;
      }

      const points = campaignLevelPoints(entry.completion_time, wrTime, position);
      const row = ensure(entry.username);
      row.points += points;
      row.levelsPlayed += 1;
      row.totalTime += entry.completion_time;
      if (row.bestFinish === null || position < row.bestFinish) row.bestFinish = position;
      row.levels.push({
        levelId: level.id,
        levelName: level.name,
        color: level.color,
        time: entry.completion_time,
        wrTime,
        position,
        entrants: standings.length,
        points,
      });
    });
  }

  // Points decide the campaign; total time only breaks an exact tie.
  return [...players.values()].sort(
    (a, b) =>
      b.points - a.points || a.totalTime - b.totalTime || a.username.localeCompare(b.username),
  );
}

/**
 * Re-colours a stored (frozen) standings snapshot from the campaign's current
 * level list, dropping the legacy `classId`.
 *
 * A snapshot taken before per-level colours was saved with a `classId` per
 * level, so serving it verbatim would leave every per-level row colourless. The
 * times and points are the historical record and are left untouched — only the
 * colour, which is presentation, is re-derived.
 */
export function applyLevelColors(
  standings: CampaignStanding[],
  levels: CampaignLevel[],
): CampaignStanding[] {
  const colorOf = new Map(levels.map((l) => [l.id, l.color]));
  return standings.map((row) => ({
    ...row,
    levels: row.levels.map((l) => {
      const legacy = l as CampaignLevelScore & { classId?: string };
      return {
        levelId: legacy.levelId,
        levelName: legacy.levelName,
        time: legacy.time,
        wrTime: legacy.wrTime,
        position: legacy.position,
        entrants: legacy.entrants,
        points: legacy.points,
        color: colorOf.get(legacy.levelId) ?? normalizeCampaignColor(legacy.color),
      };
    }),
  }));
}

/** Time left as a compact "12d 4h" / "3h 20m" / "18m" string. */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "closed";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
