import type { LeaderboardEntry, RankInfo } from "../types";

/**
 * Rank Points.
 *
 * Every map awards points for the rank a player's PB falls into. Maps without
 * hand-authored rank requirements get cutoffs derived from the level's own
 * leaderboard: a WR multiplier curve blended with the times of real players at
 * key positions, taking whichever is stricter.
 */

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
  perLevel: Record<string, LevelPointResult>;
}

/**
 * Aggregate rank points for every player across the supplied levels.
 */
export function computeRankPoints(
  levelIds: string[],
  data: Record<string, LeaderboardEntry[]>,
  authoredByLevel: Record<string, Record<string, RankInfo> | undefined> = {},
): { players: PlayerPointTotals[]; levelTimes: Record<string, LevelRankTimes> } {
  const totals = new Map<string, PlayerPointTotals>();
  const levelTimes: Record<string, LevelRankTimes> = {};

  for (const levelId of levelIds) {
    const entries = data[levelId];
    if (!entries || entries.length === 0) continue;
    const times = deriveLevelRankTimes(entries, authoredByLevel[levelId]);
    if (!times) continue;
    levelTimes[levelId] = times;

    // Best run per player on this level.
    const best = new Map<string, { entry: LeaderboardEntry; position: number }>();
    [...entries]
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
      row.perLevel[levelId] = { levelId, time: entry.completion_time, rank, points, isWr, position };
    }
  }

  const players = [...totals.values()].sort(
    (a, b) => b.total - a.total || b.wrs - a.wrs || a.mapsPlayed - b.mapsPlayed,
  );
  return { players, levelTimes };
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
