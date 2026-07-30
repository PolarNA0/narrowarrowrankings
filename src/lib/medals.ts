import { LeaderboardEntry } from "../types";

export interface ComputedMedals {
  first: number;
  second: number;
  third: number;
  top10: number;
  wrLevelIds: string[];
}

/**
 * Best-run-per-player standings for a single level.
 * The incoming array is already merged (API + legacy) and stripped of removed runs,
 * so we only need to de-duplicate players and keep their fastest run.
 */
export function toStandings(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    if (!entry?.username) continue;
    const key = entry.username.toLowerCase();
    const current = best.get(key);
    if (!current || entry.completion_time < current.completion_time) {
      best.set(key, entry);
    }
  }
  return [...best.values()].sort((a, b) => a.completion_time - b.completion_time);
}

/**
 * Recomputes medals from the merged standings instead of trusting the game API,
 * so legacy runs count as records and removed runs never do.
 */
export function computeMedals(
  username: string,
  levelIds: string[],
  data: Record<string, LeaderboardEntry[]>,
): ComputedMedals {
  const target = username.toLowerCase();
  const result: ComputedMedals = { first: 0, second: 0, third: 0, top10: 0, wrLevelIds: [] };

  for (const levelId of levelIds) {
    const standings = toStandings(data[levelId] || []);
    const index = standings.findIndex((e) => e.username.toLowerCase() === target);
    if (index < 0) continue;
    if (index === 0) {
      result.first += 1;
      result.wrLevelIds.push(levelId);
    } else if (index === 1) {
      result.second += 1;
    } else if (index === 2) {
      result.third += 1;
    }
    if (index < 10) result.top10 += 1;
  }

  return result;
}
