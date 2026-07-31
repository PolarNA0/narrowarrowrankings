import type { LeaderboardEntry } from "../types";
import { toStandings } from "./medals";

export const MAX_SCORE = 1000;

export interface LevelScore {
  levelId: string;
  levelName: string;
  packId: string;
  time: number;
  wrTime: number;
  position: number;
  entrants: number;
  gap: number;
  points: number;
  isLegacy?: boolean;
}

export interface PlayerScore {
  username: string;
  total: number;
  average: number;
  levelsPlayed: number;
  perfects: number;
  levels: LevelScore[];
}

export interface ScoreTier {
  name: string;
  color: string;
  min: number;
}

/** Tier thresholds are based on the average score across played levels. */
export const SCORE_TIERS: ScoreTier[] = [
  { name: "Mythic", color: "#F472B6", min: 985 },
  { name: "Grandmaster", color: "#FBBF24", min: 960 },
  { name: "Master", color: "#A78BFA", min: 925 },
  { name: "Diamond", color: "#38BDF8", min: 880 },
  { name: "Platinum", color: "#2DD4BF", min: 820 },
  { name: "Gold", color: "#FCD34D", min: 740 },
  { name: "Silver", color: "#CBD5E1", min: 640 },
  { name: "Bronze", color: "#D97706", min: 500 },
  { name: "Unranked", color: "#64748B", min: 0 },
];

export function tierFor(average: number): ScoreTier {
  return SCORE_TIERS.find((t) => average >= t.min) ?? SCORE_TIERS[SCORE_TIERS.length - 1];
}

/**
 * Points out of 1000 for one run on one level.
 *
 * - The world record (and anything tied with it) is always exactly 1000.
 * - Everything else is scaled by how close the time is to the WR, then given a
 *   small penalty for leaderboard position so ties on time still rank sensibly.
 */
export function scoreRun(time: number, wrTime: number, position: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(wrTime) || time <= 0 || wrTime <= 0) return 0;
  if (time <= wrTime) return MAX_SCORE;

  // Relative gap to the WR, e.g. 0.05 = 5% slower.
  const gapRatio = (time - wrTime) / wrTime;

  // Steep at the top (hundredths matter), gentle further down the board.
  const paceScore = MAX_SCORE / (1 + gapRatio * 9);

  // Position penalty: up to 8% off, saturating around rank 60.
  const positionPenalty = Math.min(0.08, Math.log10(Math.max(1, position)) * 0.045);

  return Math.max(0, Math.round(paceScore * (1 - positionPenalty)));
}

interface LevelMeta {
  id: string;
  name: string;
  packId: string;
}

/** Builds NarrowScore cards for every player present on the given levels. */
export function computeNarrowScores(
  levels: LevelMeta[],
  data: Record<string, LeaderboardEntry[]>,
): PlayerScore[] {
  const players = new Map<string, PlayerScore>();

  for (const level of levels) {
    const standings = toStandings(data[level.id] || []);
    if (standings.length === 0) continue;
    const wrTime = standings[0].completion_time;

    standings.forEach((entry, index) => {
      const key = entry.username.toLowerCase();
      let player = players.get(key);
      if (!player) {
        player = {
          username: entry.username,
          total: 0,
          average: 0,
          levelsPlayed: 0,
          perfects: 0,
          levels: [],
        };
        players.set(key, player);
      }
      const points = scoreRun(entry.completion_time, wrTime, index + 1);
      player.levels.push({
        levelId: level.id,
        levelName: level.name,
        packId: level.packId,
        time: entry.completion_time,
        wrTime,
        position: index + 1,
        entrants: standings.length,
        gap: entry.completion_time - wrTime,
        points,
        isLegacy: entry.isLegacy,
      });
      player.total += points;
      player.levelsPlayed += 1;
      if (points >= MAX_SCORE) player.perfects += 1;
    });
  }

  const result = [...players.values()];
  for (const player of result) {
    player.average = player.levelsPlayed ? player.total / player.levelsPlayed : 0;
    player.levels.sort((a, b) => b.points - a.points);
  }
  return result.sort((a, b) => b.total - a.total);
}

/** Levels where the player has the most headroom left (biggest available gains). */
export function biggestGains(player: PlayerScore, count = 5): LevelScore[] {
  return [...player.levels]
    .filter((l) => l.points < MAX_SCORE)
    .sort((a, b) => a.points - b.points)
    .slice(0, count);
}
