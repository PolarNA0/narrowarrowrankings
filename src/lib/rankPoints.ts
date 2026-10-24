import type { LeaderboardEntry, RankInfo } from "../types";
import { arrowKind, type ArrowKind } from "./arrow-sprites";

/**
 * Rank Points.
 *
 * Every map awards points for the rank a player's PB falls into. Maps without
 * hand-authored rank requirements get cutoffs derived from the level's own
 * leaderboard: a WR multiplier curve blended with the times of real players at
 * key positions, taking whichever is stricter.
 *
 * Two scoring modes share that machinery:
 *  - `best-arrow` counts each map once, for the player's fastest run on any
 *    arrow (72 maps).
 *  - `all-arrows` counts each map once per arrow, so a player can score on all
 *    three (72 maps x 3 arrows). Cutoffs are derived per arrow, because the
 *    arrow that is fastest on a map differs and a single curve would make one
 *    arrow's ranks trivial and another's unreachable.
 */

export type RankPointsMode = "best-arrow" | "all-arrows";

export const RANK_POINTS_MODE_LABEL: Record<RankPointsMode, string> = {
  "best-arrow": "Best Arrow",
  "all-arrows": "All Arrows",
};

/** Display name for each arrow bucket, used in the per-map breakdown. */
export const ARROW_KIND_LABEL: Record<ArrowKind, string> = {
  narrow: "Narrow",
  speedy: "Speedy",
  energy: "Energy",
};

/** Maps an arrow bucket back to the authored-config key (`ArrowScope`). */
const ARROW_KIND_SCOPE: Record<ArrowKind, string> = {
  narrow: "Narrow Arrow",
  speedy: "Speedy Arrow",
  energy: "Energy Arrow",
};

/**
 * An arrow is bucketed by sprite kind, not by exact name: submissions spell the
 * same arrow inconsistently ("Narrow Arrow", "narrow", …), so grouping on the
 * raw string would split one arrow's board into several.
 */
export function arrowBucket(entry: LeaderboardEntry): ArrowKind {
  return arrowKind(entry.arrow_name);
}

export const RANK_POINTS: Record<string, number> = {
  Champion: 9,
  Elite: 8,
  Legend: 7,
  Expert: 6,
  Master: 5,
  Pro: 4,
  Skilled: 3,
  Average: 2,
  Beginner: 1,
  "Beginner+": -1,
};

/** Bonus on top of Champion for holding (or tying) the world record. */
export const WR_BONUS = 2;
export const WR_POINTS = RANK_POINTS.Champion + WR_BONUS;

export const POINT_RANK_ORDER = [
  "Champion",
  "Elite",
  "Legend",
  "Expert",
  "Master",
  "Pro",
  "Skilled",
  "Average",
  "Beginner",
  "Beginner+",
] as const;

export type PointRank = (typeof POINT_RANK_ORDER)[number];

// Multipliers applied to the world record time. Tight at the top so Champion
// stays genuinely hard, loosening quickly toward the casual ranks.
const WR_MULTIPLIER: Record<string, number> = {
  Champion: 1.015,
  Elite: 1.04,
  Legend: 1.075,
  Expert: 1.12,
  Master: 1.19,
  Pro: 1.3,
  Skilled: 1.45,
  Average: 1.75,
  Beginner: 2.3,
};

// Leaderboard positions that should roughly correspond to each rank. Used so
// densely-contested maps stay strict and quiet maps stay attainable.
const POSITION_TARGET: Record<string, number> = {
  Champion: 3,
  Elite: 6,
  Legend: 10,
  Expert: 18,
  Master: 30,
  Pro: 50,
  Skilled: 80,
  Average: 130,
  Beginner: 220,
};

export interface LevelRankTimes {
  wr: number;
  cutoffs: Record<string, number>;
}

function positionTime(sorted: number[], position: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, position - 1));
  return sorted[index];
}

/**
 * Rank cutoff times for one level. Authored cutoffs (admin configs) win; the
 * rest are generated from the board itself.
 */
export function deriveLevelRankTimes(
  entries: LeaderboardEntry[],
  authored?: Record<string, RankInfo> | null,
): LevelRankTimes | null {
  const times = entries.map((e) => e.completion_time).filter((t) => Number.isFinite(t) && t > 0);
  if (times.length === 0) return null;
  times.sort((a, b) => a - b);
  const wr = times[0];

  const cutoffs: Record<string, number> = {};
  for (const rank of POINT_RANK_ORDER) {
    if (rank === "Beginner+") continue;

    const authoredCutoff = authored?.[rank]?.timeCutoff;
    if (typeof authoredCutoff === "number" && authoredCutoff > 0 && authoredCutoff < 9000) {
      cutoffs[rank] = authoredCutoff;
      continue;
    }

    const byMultiplier = wr * WR_MULTIPLIER[rank];
    const byPosition = positionTime(times, POSITION_TARGET[rank]);
    // Stricter of the two for the elite ranks, kinder for the casual ones.
    const strict = rank === "Champion" || rank === "Elite" || rank === "Legend";
    cutoffs[rank] =
      byPosition == null
        ? byMultiplier
        : strict
          ? Math.min(byMultiplier, byPosition)
          : Math.max(byMultiplier, byPosition);
  }

  // Keep the ladder monotonic after blending.
  let previous = 0;
  for (const rank of POINT_RANK_ORDER) {
    if (rank === "Beginner+") continue;
    cutoffs[rank] = Math.max(cutoffs[rank], previous + 0.001);
    previous = cutoffs[rank];
  }

  return { wr, cutoffs };
}

export function rankForTime(time: number, times: LevelRankTimes): PointRank {
  for (const rank of POINT_RANK_ORDER) {
    if (rank === "Beginner+") continue;
    if (time <= times.cutoffs[rank]) return rank;
  }
  return "Beginner+";
}

export function pointsForTime(time: number, times: LevelRankTimes): { rank: PointRank; points: number } {
  const isWr = time <= times.wr + 0.0005;
  const rank = rankForTime(time, times);
  return { rank, points: isWr ? WR_POINTS : RANK_POINTS[rank] };
}

export interface LevelPointResult {
  levelId: string;
  /** Empty in `best-arrow` mode, where the map is scored once regardless of arrow. */
  arrow: ArrowKind | "";
  time: number;
  rank: PointRank;
  points: number;
  isWr: boolean;
  position: number;
}

export interface PlayerPointTotals {
  username: string;
  total: number;
  mapsPlayed: number;
  wrs: number;
  champions: number;
  /** Keyed by `levelId` in `best-arrow` mode, `levelId|arrow` in `all-arrows`. */
  perLevel: Record<string, LevelPointResult>;
}

export interface RankPointsResult {
  players: PlayerPointTotals[];
  /** Keyed by `levelId` in `best-arrow` mode, `levelId|arrow` in `all-arrows`. */
  levelTimes: Record<string, LevelRankTimes>;
  /** Distinct scored slots: levels in `best-arrow`, level-arrow pairs in `all-arrows`. */
  slotsScored: number;
}

/** One scored slot: a level in `best-arrow`, or a level+arrow pair in `all-arrows`. */
interface ScoreSlot {
  levelId: string;
  arrow: ArrowKind | "";
  key: string;
  entries: LeaderboardEntry[];
  authored?: Record<string, RankInfo> | null;
}

/**
 * Split each level's board into the slots that score, one per arrow in
 * `all-arrows` mode and one covering the whole board in `best-arrow` mode.
 * An arrow with no runs is skipped so it never contributes a slot.
 */
function scoreSlots(
  levelId: string,
  entries: LeaderboardEntry[],
  mode: RankPointsMode,
  authored: Record<string, RankInfo> | undefined,
  authoredArrowRanks?: Partial<Record<string, Record<string, number>>>,
): ScoreSlot[] {
  if (mode === "best-arrow") {
    return [{ levelId, arrow: "", key: levelId, entries, authored }];
  }

  const byArrow = new Map<ArrowKind, LeaderboardEntry[]>();
  for (const entry of entries) {
    const kind = arrowBucket(entry);
    const bucket = byArrow.get(kind);
    if (bucket) bucket.push(entry);
    else byArrow.set(kind, [entry]);
  }

  return (["narrow", "speedy", "energy"] as ArrowKind[])
    .filter((kind) => byArrow.has(kind))
    .map((kind) => {
      // A per-arrow authored override wins over the shared rank config; when
      // absent, cutoffs are derived from this arrow's own board.
      const overrides = authoredArrowRanks?.[ARROW_KIND_SCOPE[kind]];
      const authoredForArrow = overrides
        ? Object.fromEntries(
            Object.entries(authored ?? {}).map(([rank, info]) => [
              rank,
              { ...info, timeCutoff: overrides[rank] ?? info.timeCutoff },
            ]),
          )
        : authored;
      return {
        levelId,
        arrow: kind,
        key: `${levelId}|${kind}`,
        entries: byArrow.get(kind) as LeaderboardEntry[],
        authored: authoredForArrow,
      };
    });
}

/**
 * Aggregate rank points for every player across the supplied levels.
 *
 * `arrowRanksByLevel` carries the per-arrow authored overrides when an admin
 * has set them; without it each arrow's cutoffs are derived from its own board.
 */
export function computeRankPoints(
  levelIds: string[],
  data: Record<string, LeaderboardEntry[]>,
  authoredByLevel: Record<string, Record<string, RankInfo> | undefined> = {},
  mode: RankPointsMode = "best-arrow",
  arrowRanksByLevel: Record<
    string,
    Partial<Record<string, Record<string, number>>> | undefined
  > = {},
): RankPointsResult {
  const totals = new Map<string, PlayerPointTotals>();
  const levelTimes: Record<string, LevelRankTimes> = {};

  for (const levelId of levelIds) {
    const entries = data[levelId];
    if (!entries || entries.length === 0) continue;

    const slots = scoreSlots(
      levelId,
      entries,
      mode,
      authoredByLevel[levelId],
      arrowRanksByLevel[levelId],
    );

    for (const slot of slots) {
      const times = deriveLevelRankTimes(slot.entries, slot.authored);
      if (!times) continue;
      levelTimes[slot.key] = times;

      // Best run per player within this slot.
      const best = new Map<string, { entry: LeaderboardEntry; position: number }>();
      [...slot.entries]
        .sort((a, b) => a.completion_time - b.completion_time)
        .forEach((entry, index) => {
          const key = entry.username.toLowerCase();
          if (!best.has(key)) best.set(key, { entry, position: index + 1 });
        });

      for (const { entry, position } of best.values()) {
        const key = entry.username.toLowerCase();
        const { rank, points } = pointsForTime(entry.completion_time, times);
        const isWr = entry.completion_time <= times.wr + 0.0005;
        let row = totals.get(key);
        if (!row) {
          row = { username: entry.username, total: 0, mapsPlayed: 0, wrs: 0, champions: 0, perLevel: {} };
          totals.set(key, row);
        }
        row.total += points;
        row.mapsPlayed += 1;
        if (isWr) row.wrs += 1;
        if (rank === "Champion") row.champions += 1;
        row.perLevel[slot.key] = {
          levelId: slot.levelId,
          arrow: slot.arrow,
          time: entry.completion_time,
          rank,
          points,
          isWr,
          position,
        };
      }
    }
  }

  const players = [...totals.values()].sort(
    (a, b) => b.total - a.total || b.wrs - a.wrs || a.mapsPlayed - b.mapsPlayed,
  );
  return { players, levelTimes, slotsScored: Object.keys(levelTimes).length };
}

export const RANK_TEXT_COLOR: Record<string, string> = {
  Champion: "text-[#D300CF]",
  Elite: "text-[#A804D6]",
  Legend: "text-[#7681FF]",
  Expert: "text-[#14E6FF]",
  Master: "text-[#8DFF00]",
  Pro: "text-[#FACC15]",
  Skilled: "text-[#FB923C]",
  Average: "text-[#FF5031]",
  Beginner: "text-[#B91C1C]",
  "Beginner+": "text-[#92400E]",
};
