import { LeaderboardEntry, RankInfo } from "../types";

export function assignRank(
  entry: LeaderboardEntry, 
  rankConfig: Record<string, RankInfo>,
  rankOrder: string[]
): string {
  const time = entry.completion_time;
  
  // Find the highest rank where the player's time is faster than the cutoff
  // rankOrder is assumed to be sorted from best to worst (e.g., Champion to Beginner)
  for (const rankId of rankOrder) {
    const rank = rankConfig[rankId];
    if (rank && time <= rank.timeCutoff) {
      return rankId;
    }
  }
  
  return rankOrder[rankOrder.length - 1] || "Beginner";
}
