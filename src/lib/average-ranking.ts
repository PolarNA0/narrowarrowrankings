/**
 * Ordering and rank resolution for the "Total time & average" table.
 *
 * The table exposes two orderings because they are genuinely different: the
 * average leaderboard position rewards a player whose *typical* placement is
 * high, while total time rewards a player who is simply fast everywhere. A lower
 * total does not imply a better average position, because playing more levels
 * adds time but can improve the average — so the two orderings can disagree, and
 * neither is a "corrected" version of the other.
 *
 * Overall rank is a pure function of total time against per-rank cutoffs, so the
 * table can also report the *next* rank and the exact time still to be saved,
 * rather than only the rank already earned.
 */

import type { RankInfo } from "@/types";

export type AverageSort = "position" | "total";

/** The minimal shape the table ranks: an average position and a summed time. */
export interface RankableRow {
  avgPosition: number;
  totalTime: number;
}

/**
 * Order rows by the selected metric, falling back to the other metric so equal
 * values still have a stable, meaningful order.
 */
export function sortAverageRows<T extends RankableRow>(rows: readonly T[], mode: AverageSort): T[] {
  return [...rows].sort((a, b) =>
    mode === "total"
      ? a.totalTime - b.totalTime || a.avgPosition - b.avgPosition
      : a.avgPosition - b.avgPosition || a.totalTime - b.totalTime,
  );
}

export interface OverallRankResult {
  /** The rank the total time currently satisfies. */
  rankId: string;
  /** The rank one step faster, or null when already at the top rank. */
  nextRankId: string | null;
  /** The total time needed for `nextRankId`, or null when there is no next rank. */
  nextCutoff: number | null;
}

/**
 * Resolve a total time to its overall rank and the cutoff that would promote it.
 *
 * `order` runs fastest-first (Champion → Beginner+), matching `RANK_ORDER`, and a
 * rank is earned when `totalTime <= cutoff`. A rank with a missing or non-positive
 * cutoff is skipped: a 0 cutoff would otherwise be satisfied by every time and
 * would swallow the whole table.
 */
export function resolveOverallRank(
  totalTime: number,
  order: readonly string[],
  config: Record<string, RankInfo>,
  scaleFactor = 1,
): OverallRankResult {
  const safeOrder = Array.isArray(order) ? order : [];
  const safeConfig = config ?? {};

  for (let i = 0; i < safeOrder.length; i++) {
    const rank = safeConfig[safeOrder[i]];
    if (!rank || !(rank.timeCutoff > 0)) continue;
    const cutoff = rank.timeCutoff * scaleFactor;
    if (totalTime <= cutoff) {
      const nextId = safeOrder[i - 1];
      const nextRank = nextId ? safeConfig[nextId] : undefined;
      const hasNext = nextId != null && nextRank != null && nextRank.timeCutoff > 0;
      return {
        rankId: safeOrder[i],
        nextRankId: hasNext ? nextId : null,
        nextCutoff: hasNext ? (nextRank as RankInfo).timeCutoff * scaleFactor : null,
      };
    }
  }

  const lastId = safeOrder[safeOrder.length - 1] ?? "Beginner";
  return { rankId: lastId, nextRankId: null, nextCutoff: null };
}

/**
 * The time still to be saved to reach the next rank, or null when there is none.
 * Clamped at zero: a row already inside the next cutoff reports no gap.
 */
export function timeToNextRank(totalTime: number, result: OverallRankResult): number | null {
  if (result.nextCutoff == null) return null;
  return Math.max(0, totalTime - result.nextCutoff);
}
