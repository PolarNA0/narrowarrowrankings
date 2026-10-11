import { LeaderboardEntry, LevelInfo, InGameMedals } from "../types";

export interface ComputedMedals {
  first: number;
  second: number;
  third: number;
  top10: number;
  wrLevelIds: string[];
}

/** The four in-game medals, keyed by their threshold field on InGameMedals. */
export type MedalKey = "topTime" | "goldTime" | "silverTime" | "bronzeTime";

export const MEDAL_TIER_ORDER: { key: MedalKey; label: string; color: string }[] = [
  { key: "topTime", label: "Diamond", color: "text-sky-300" },
  { key: "goldTime", label: "Gold", color: "text-amber-400" },
  { key: "silverTime", label: "Silver", color: "text-slate-300" },
  { key: "bronzeTime", label: "Bronze", color: "text-orange-400" },
];

export interface MedalEaseRow {
  levelId: string;
  levelName: string;
  packId: string;
  /** Fastest merged run on the level, i.e. the current world record. */
  wrTime: number;
  /** The medal's cutoff time. */
  cutoff: number;
  /** cutoff - wrTime. Larger means the medal sits further below the WR, so it is easier. */
  difference: number;
  /** True when the WR run already meets the cutoff. */
  achieved: boolean;
}

/**
 * Ranks pack levels by how much room there is between a medal's cutoff and the
 * level's world record. A big gap means the medal is comfortably clear of the
 * best time and therefore the easiest to earn.
 */
export function computeMedalEase(
  levels: LevelInfo[],
  data: Record<string, LeaderboardEntry[]>,
  medals: Record<string, InGameMedals>,
  tier: MedalKey,
): MedalEaseRow[] {
  const rows: MedalEaseRow[] = [];
  for (const level of levels) {
    const medal = medals[level.id.toUpperCase()];
    const standings = toStandings(data[level.id] ?? []);
    const wrTime = standings[0]?.completion_time;
    if (!medal || wrTime == null) continue;
    const cutoff = medal[tier];
    if (!Number.isFinite(cutoff) || cutoff <= 0) continue;
    rows.push({
      levelId: level.id,
      levelName: level.name,
      packId: level.packId,
      wrTime,
      cutoff,
      difference: cutoff - wrTime,
      achieved: wrTime <= cutoff,
    });
  }
  return rows.sort((a, b) => b.difference - a.difference);
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
