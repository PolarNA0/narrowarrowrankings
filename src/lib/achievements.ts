import type { LeaderboardEntry, LevelInfo, LevelPack } from "../types";
import { toStandings } from "./medals";
import { scoreRun, MAX_SCORE, tierFor } from "./narrowscore";
import { arrowKind, type ArrowKind } from "./arrow-sprites";

export type Tone = "gold" | "accent" | "emerald" | "fuchsia" | "slate";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  progress: number; // 0..1
  detail: string;
  tone: Tone;
  /** Grouping label for the profile grid. */
  category: string;
}

/**
 * A player's career boiled down to the numbers the achievements read.
 *
 * Built from the merged boards, so it sees every run rather than only personal
 * bests. Rank-derived fields (WRs, podiums, perfects) are measured against the
 * *current* boards, the only standings this site has — the game exposes no
 * historical ranking, so a counter here answers "how many are true today".
 */
export interface CareerSummary {
  username: string;
  runs: number;
  levelsCompleted: number;
  totalLevels: number;
  totalPacks: number;
  fastest: number;
  sub12: number;
  sub13: number;
  sub15: number;
  sub16: number;
  sub20: number;
  wrCount: number;
  podiumCount: number;
  top10Count: number;
  top25Count: number;
  perfects: number;
  average: number;
  total: number;
  packsComplete: number;
  arrowsUsed: number;
  levelsPerArrow: Record<ArrowKind, number>;
  bestPerArrow: Record<ArrowKind, number>;
  daysPlayed: number;
  weekendRuns: number;
  nightRuns: number;
  bestStreak: number;
  /** Levels finished within one second of the board's best time. */
  nearMiss: number;
  /** Distinct levels finished, per pack. */
  packProgress: Record<string, number>;
  /** How many levels each pack contains, so a per-pack badge can normalise. */
  levelsPerPack: Record<string, number>;
  /** Whether the player holds a record with each arrow. */
  wrByArrow: Record<ArrowKind, boolean>;
}

export function emptyCareer(username = "", totalLevels = 0, totalPacks = 0): CareerSummary {
  return {
    username,
    runs: 0,
    levelsCompleted: 0,
    totalLevels,
    totalPacks,
    fastest: Infinity,
    sub12: 0,
    sub13: 0,
    sub15: 0,
    sub16: 0,
    sub20: 0,
    wrCount: 0,
    podiumCount: 0,
    top10Count: 0,
    top25Count: 0,
    perfects: 0,
    average: 0,
    total: 0,
    packsComplete: 0,
    arrowsUsed: 0,
    levelsPerArrow: { narrow: 0, speedy: 0, energy: 0 },
    bestPerArrow: { narrow: Infinity, speedy: Infinity, energy: Infinity },
    daysPlayed: 0,
    weekendRuns: 0,
    nightRuns: 0,
    bestStreak: 0,
    nearMiss: 0,
    packProgress: {},
    levelsPerPack: {},
    wrByArrow: { narrow: false, speedy: false, energy: false },
  };
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  tone: Tone;
  category: string;
  target: number;
  value: (c: CareerSummary) => number;
  unit?: string;
  /** Times are better when lower, so progress runs the other way. */
  lowerIsBetter?: boolean;
}

/**
 * The full achievement table.
 *
 * A function of the level/pack list rather than a constant, because several
 * badges are per-pack and the totals depend on how many levels exist — a pack
 * added later should gain its badge without editing this table.
 */
export function achievementDefs(
  totalLevels: number,
  totalPacks: number,
  packs: LevelPack[],
): AchievementDef[] {
  const defs: AchievementDef[] = [
    // ---- Progress ------------------------------------------------------
    {
      id: "first-steps",
      name: "First Steps",
      description: "Finish your first level",
      tone: "slate",
      category: "Progress",
      target: 1,
      value: (c) => c.levelsCompleted,
    },
    {
      id: "getting-started",
      name: "Getting Started",
      description: "Finish 5 levels",
      tone: "slate",
      category: "Progress",
      target: 5,
      value: (c) => c.levelsCompleted,
    },
    {
      id: "explorer",
      name: "Explorer",
      description: "Finish 10 levels",
      tone: "emerald",
      category: "Progress",
      target: 10,
      value: (c) => c.levelsCompleted,
    },
    {
      id: "pathfinder",
      name: "Pathfinder",
      description: "Finish 20 levels",
      tone: "emerald",
      category: "Progress",
      target: 20,
      value: (c) => c.levelsCompleted,
    },
    {
      id: "cartographer",
      name: "Cartographer",
      description: "Finish 35 levels",
      tone: "emerald",
      category: "Progress",
      target: 35,
      value: (c) => c.levelsCompleted,
    },
    {
      id: "halfway",
      name: "Halfway There",
      description: "Finish half of all levels",
      tone: "accent",
      category: "Progress",
      target: Math.ceil(totalLevels / 2),
      value: (c) => c.levelsCompleted,
    },
    {
      id: "completionist",
      name: "Completionist",
      description: "Finish every level",
      tone: "gold",
      category: "Progress",
      target: totalLevels,
      value: (c) => c.levelsCompleted,
    },

    // ---- Volume --------------------------------------------------------
    {
      id: "marathon",
      name: "Marathon Runner",
      description: "Record 10 runs",
      tone: "slate",
      category: "Volume",
      target: 10,
      value: (c) => c.runs,
    },
    {
      id: "century",
      name: "Century Club",
      description: "Record 25 runs",
      tone: "slate",
      category: "Volume",
      target: 25,
      value: (c) => c.runs,
    },
    {
      id: "grinder",
      name: "Grinder",
      description: "Record 50 runs",
      tone: "accent",
      category: "Volume",
      target: 50,
      value: (c) => c.runs,
    },
    {
      id: "dedicated",
      name: "Dedicated",
      description: "Record 70 runs",
      tone: "fuchsia",
      category: "Volume",
      target: 70,
      value: (c) => c.runs,
    },
    {
      id: "obsessed",
      name: "Obsessed",
      description: `Record ${totalLevels} runs`,
      tone: "gold",
      category: "Volume",
      target: totalLevels,
      value: (c) => c.runs,
    },

    // ---- Speed: personal bests -----------------------------------------
    {
      id: "sub-25",
      name: "Sub-25",
      description: "Set a personal best under 25 seconds",
      tone: "slate",
      category: "Speed",
      target: 25,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-20",
      name: "Sub-20",
      description: "Set a personal best under 20 seconds",
      tone: "slate",
      category: "Speed",
      target: 20,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-18",
      name: "Sub-18",
      description: "Set a personal best under 18 seconds",
      tone: "emerald",
      category: "Speed",
      target: 18,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-16",
      name: "Sub-16",
      description: "Set a personal best under 16 seconds",
      tone: "emerald",
      category: "Speed",
      target: 16,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-15",
      name: "Sub-15",
      description: "Set a personal best under 15 seconds",
      tone: "accent",
      category: "Speed",
      target: 15,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-14",
      name: "Sub-14",
      description: "Set a personal best under 14 seconds",
      tone: "accent",
      category: "Speed",
      target: 14,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-13",
      name: "Sub-13",
      description: "Set a personal best under 13 seconds",
      tone: "fuchsia",
      category: "Speed",
      target: 13,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-12",
      name: "Sub-12",
      description: "Set a personal best under 12 seconds",
      tone: "fuchsia",
      category: "Speed",
      target: 12,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-11",
      name: "Sub-11",
      description: "Set a personal best under 11 seconds",
      tone: "gold",
      category: "Speed",
      target: 11,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "sub-10-5",
      name: "Ten and a Half",
      description: "Set a personal best under 10.5 seconds",
      tone: "gold",
      category: "Speed",
      target: 10.5,
      value: (c) => c.fastest,
      unit: "s",
      lowerIsBetter: true,
    },

    // ---- Speed: fast-run volume ----------------------------------------
    // The old "10 runs under 10 seconds" could never be earned: the fastest run
    // on any board is 10.45s, so nothing comes in under ten. These count runs
    // under thresholds the boards actually contain.
    {
      id: "quick-ten",
      name: "Quick Ten",
      description: "Record 10 runs under 16 seconds",
      tone: "slate",
      category: "Speed",
      target: 10,
      value: (c) => c.sub16,
    },
    {
      id: "speedster",
      name: "Speedster",
      description: "Record 25 runs under 16 seconds",
      tone: "emerald",
      category: "Speed",
      target: 25,
      value: (c) => c.sub16,
    },
    {
      id: "fast-fifty",
      name: "Fast Fifty",
      description: "Record 50 runs under 16 seconds",
      tone: "accent",
      category: "Speed",
      target: 50,
      value: (c) => c.sub16,
    },
    {
      id: "quick-six",
      name: "Quick Six",
      description: "Record 10 runs under 15 seconds",
      tone: "emerald",
      category: "Speed",
      target: 10,
      value: (c) => c.sub15,
    },
    {
      id: "fifteen-twentyfive",
      name: "Twenty-Five Fast",
      description: "Record 25 runs under 15 seconds",
      tone: "accent",
      category: "Speed",
      target: 25,
      value: (c) => c.sub15,
    },
    {
      id: "hypersonic",
      name: "Hypersonic",
      description: "Record 35 runs under 15 seconds",
      tone: "fuchsia",
      category: "Speed",
      target: 35,
      value: (c) => c.sub15,
    },
    {
      id: "sub13-club",
      name: "Sub-13 Club",
      description: "Record 5 runs under 13 seconds",
      tone: "fuchsia",
      category: "Speed",
      target: 5,
      value: (c) => c.sub13,
    },
    {
      id: "sub13-elite",
      name: "Sub-13 Elite",
      description: "Record 15 runs under 13 seconds",
      tone: "gold",
      category: "Speed",
      target: 15,
      value: (c) => c.sub13,
    },
    {
      id: "sub12-club",
      name: "Sub-12 Club",
      description: "Record 5 runs under 12 seconds",
      tone: "gold",
      category: "Speed",
      target: 5,
      value: (c) => c.sub12,
    },
    {
      id: "sub12-legend",
      name: "Sub-12 Legend",
      description: "Record 10 runs under 12 seconds",
      tone: "gold",
      category: "Speed",
      target: 10,
      value: (c) => c.sub12,
    },
    {
      id: "sub20-fifty",
      name: "Comfortably Fast",
      description: "Record 50 runs under 20 seconds",
      tone: "slate",
      category: "Speed",
      target: 50,
      value: (c) => c.sub20,
    },
    {
      id: "sub20-hundred",
      name: "Sub-20 Regular",
      description: "Record 65 runs under 20 seconds",
      tone: "emerald",
      category: "Speed",
      target: 65,
      value: (c) => c.sub20,
    },

    // ---- Records --------------------------------------------------------
    {
      id: "first-blood",
      name: "First Blood",
      description: "Hold a world record",
      tone: "gold",
      category: "Records",
      target: 1,
      value: (c) => c.wrCount,
    },
    {
      id: "wr-hunter",
      name: "WR Hunter",
      description: "Hold 5 world records",
      tone: "gold",
      category: "Records",
      target: 5,
      value: (c) => c.wrCount,
    },
    {
      id: "wr-collector",
      name: "WR Collector",
      description: "Hold 10 world records",
      tone: "gold",
      category: "Records",
      target: 10,
      value: (c) => c.wrCount,
    },
    {
      id: "wr-machine",
      name: "WR Machine",
      description: "Hold 20 world records",
      tone: "gold",
      category: "Records",
      target: 20,
      value: (c) => c.wrCount,
    },
    {
      id: "wr-legend",
      name: "WR Legend",
      description: "Hold 40 world records",
      tone: "gold",
      category: "Records",
      target: 40,
      value: (c) => c.wrCount,
    },
    {
      id: "wr-immortal",
      name: "WR Immortal",
      description: "Hold every world record",
      tone: "gold",
      category: "Records",
      target: totalLevels,
      value: (c) => c.wrCount,
    },
    {
      id: "first-podium",
      name: "On the Board",
      description: "Land a podium finish",
      tone: "slate",
      category: "Records",
      target: 1,
      value: (c) => c.podiumCount,
    },
    {
      id: "podium-regular",
      name: "Podium Regular",
      description: "Land 10 podium finishes",
      tone: "accent",
      category: "Records",
      target: 10,
      value: (c) => c.podiumCount,
    },
    {
      id: "podium-addict",
      name: "Podium Addict",
      description: "Land 25 podium finishes",
      tone: "accent",
      category: "Records",
      target: 25,
      value: (c) => c.podiumCount,
    },
    {
      id: "podium-legend",
      name: "Podium Legend",
      description: "Land 50 podium finishes",
      tone: "fuchsia",
      category: "Records",
      target: 50,
      value: (c) => c.podiumCount,
    },
    {
      id: "top10-machine",
      name: "Top 10 Machine",
      description: "Finish top 10 on 25 levels",
      tone: "accent",
      category: "Records",
      target: 25,
      value: (c) => c.top10Count,
    },
    {
      id: "top10-elite",
      name: "Top 10 Elite",
      description: "Finish top 10 on 50 levels",
      tone: "fuchsia",
      category: "Records",
      target: 50,
      value: (c) => c.top10Count,
    },
    {
      id: "top10-everything",
      name: "Top 10 Everything",
      description: "Finish top 10 on every level",
      tone: "gold",
      category: "Records",
      target: totalLevels,
      value: (c) => c.top10Count,
    },
    {
      id: "deep-pockets",
      name: "Deep Pockets",
      description: "Finish top 25 on 50 levels",
      tone: "slate",
      category: "Records",
      target: 50,
      value: (c) => c.top25Count,
    },

    // ---- Score ----------------------------------------------------------
    {
      id: "first-perfect",
      name: "Perfect",
      description: "Score a perfect 1000",
      tone: "gold",
      category: "Score",
      target: 1,
      value: (c) => c.perfects,
    },
    {
      id: "perfect-ten",
      name: "Perfect Ten",
      description: "Score a perfect 1000 on 10 levels",
      tone: "gold",
      category: "Score",
      target: 10,
      value: (c) => c.perfects,
    },
    {
      id: "perfectionist",
      name: "Perfectionist",
      description: "Score a perfect 1000 on 20 levels",
      tone: "gold",
      category: "Score",
      target: 20,
      value: (c) => c.perfects,
    },
    {
      id: "flawless",
      name: "Flawless",
      description: "Score a perfect 1000 on 35 levels",
      tone: "gold",
      category: "Score",
      target: 35,
      value: (c) => c.perfects,
    },
    {
      id: "immaculate",
      name: "Immaculate",
      description: "Score a perfect 1000 on every level",
      tone: "gold",
      category: "Score",
      target: totalLevels,
      value: (c) => c.perfects,
    },
    {
      id: "tier-bronze",
      name: "Bronze Rank",
      description: "Reach a 500 NarrowScore average",
      tone: "slate",
      category: "Score",
      target: 500,
      value: (c) => c.average,
    },
    {
      id: "tier-silver",
      name: "Silver Rank",
      description: "Reach a 640 NarrowScore average",
      tone: "slate",
      category: "Score",
      target: 640,
      value: (c) => c.average,
    },
    {
      id: "tier-gold",
      name: "Gold Rank",
      description: "Reach a 740 NarrowScore average",
      tone: "accent",
      category: "Score",
      target: 740,
      value: (c) => c.average,
    },
    {
      id: "tier-platinum",
      name: "Platinum Rank",
      description: "Reach an 820 NarrowScore average",
      tone: "accent",
      category: "Score",
      target: 820,
      value: (c) => c.average,
    },
    {
      id: "tier-diamond",
      name: "Diamond Rank",
      description: "Reach an 880 NarrowScore average",
      tone: "emerald",
      category: "Score",
      target: 880,
      value: (c) => c.average,
    },
    {
      id: "tier-master",
      name: "Master Rank",
      description: "Reach a 925 NarrowScore average",
      tone: "fuchsia",
      category: "Score",
      target: 925,
      value: (c) => c.average,
    },
    {
      id: "tier-grandmaster",
      name: "Grandmaster Rank",
      description: "Reach a 960 NarrowScore average",
      tone: "fuchsia",
      category: "Score",
      target: 960,
      value: (c) => c.average,
    },
    {
      id: "tier-mythic",
      name: "Mythic Rank",
      description: "Reach a 985 NarrowScore average",
      tone: "gold",
      category: "Score",
      target: 985,
      value: (c) => c.average,
    },
    {
      id: "elite-average",
      name: "Elite Average",
      description: "Reach a 900+ NarrowScore average",
      tone: "fuchsia",
      category: "Score",
      target: 900,
      value: (c) => c.average,
    },
    {
      id: "score-hoarder",
      name: "Score Hoarder",
      description: "Bank 20,000 total points",
      tone: "emerald",
      category: "Score",
      target: 20000,
      value: (c) => c.total,
    },
    {
      id: "point-tycoon",
      name: "Point Tycoon",
      description: "Bank 40,000 total points",
      tone: "gold",
      category: "Score",
      target: 40000,
      value: (c) => c.total,
    },

    // ---- Arrows ---------------------------------------------------------
    {
      id: "arrow-collector",
      name: "Arrow Collector",
      description: "Record a run with all three arrows",
      tone: "accent",
      category: "Arrows",
      target: 3,
      value: (c) => c.arrowsUsed,
    },
    {
      id: "narrow-fan",
      name: "Narrow Devotee",
      description: "Finish 20 levels with the Narrow Arrow",
      tone: "accent",
      category: "Arrows",
      target: 20,
      value: (c) => c.levelsPerArrow.narrow,
    },
    {
      id: "speedy-fan",
      name: "Speedy Devotee",
      description: "Finish 20 levels with the Speedy Arrow",
      tone: "accent",
      category: "Arrows",
      target: 20,
      value: (c) => c.levelsPerArrow.speedy,
    },
    {
      id: "energy-fan",
      name: "Energy Devotee",
      description: "Finish 20 levels with the Energy Arrow",
      tone: "accent",
      category: "Arrows",
      target: 20,
      value: (c) => c.levelsPerArrow.energy,
    },
    {
      id: "triple-threat",
      name: "Triple Threat",
      description: "Finish 10 levels with each arrow",
      tone: "fuchsia",
      category: "Arrows",
      target: 10,
      value: (c) =>
        Math.min(c.levelsPerArrow.narrow, c.levelsPerArrow.speedy, c.levelsPerArrow.energy),
    },
    {
      id: "narrow-master",
      name: "Narrow Master",
      description: "Set a sub-15 with the Narrow Arrow",
      tone: "emerald",
      category: "Arrows",
      target: 15,
      value: (c) => c.bestPerArrow.narrow,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "speedy-master",
      name: "Speedy Master",
      description: "Set a sub-15 with the Speedy Arrow",
      tone: "emerald",
      category: "Arrows",
      target: 15,
      value: (c) => c.bestPerArrow.speedy,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "energy-master",
      name: "Energy Master",
      description: "Set a sub-15 with the Energy Arrow",
      tone: "emerald",
      category: "Arrows",
      target: 15,
      value: (c) => c.bestPerArrow.energy,
      unit: "s",
      lowerIsBetter: true,
    },
    {
      id: "jack-of-all-arrows",
      name: "Jack of All Arrows",
      description: "Hold a world record with each arrow",
      tone: "gold",
      category: "Arrows",
      target: 3,
      value: (c) =>
        Number(c.wrByArrow.narrow) + Number(c.wrByArrow.speedy) + Number(c.wrByArrow.energy),
    },

    // ---- Packs ----------------------------------------------------------
    {
      id: "pack-rat",
      name: "Pack Rat",
      description: "Fully complete 3 packs",
      tone: "slate",
      category: "Packs",
      target: 3,
      value: (c) => c.packsComplete,
    },
    {
      id: "pack-veteran",
      name: "Pack Veteran",
      description: "Fully complete 6 packs",
      tone: "accent",
      category: "Packs",
      target: 6,
      value: (c) => c.packsComplete,
    },
    {
      id: "pack-master",
      name: "Pack Master",
      description: "Fully complete every pack",
      tone: "fuchsia",
      category: "Packs",
      target: totalPacks,
      value: (c) => c.packsComplete,
    },
    ...packs.map((p) => ({
      id: `pack-${p.id}`,
      name: `${p.name} Cleared`,
      description: `Finish every level in the ${p.name}`,
      tone: "fuchsia" as Tone,
      category: "Packs",
      target: 1,
      // Each pack badge is "all levels in this pack", so the value is the
      // fraction of that pack finished — 1 means done.
      value: (c: CareerSummary) => {
        const total = c.levelsPerPack[p.id] ?? 0;
        if (total === 0) return 0;
        return (c.packProgress[p.id] ?? 0) / total;
      },
    })),

    // ---- Habits ----------------------------------------------------------
    {
      id: "regular",
      name: "Regular",
      description: "Play on 7 different days",
      tone: "slate",
      category: "Habits",
      target: 7,
      value: (c) => c.daysPlayed,
    },
    {
      id: "committed",
      name: "Committed",
      description: "Play on 30 different days",
      tone: "emerald",
      category: "Habits",
      target: 30,
      value: (c) => c.daysPlayed,
    },
    {
      id: "devoted",
      name: "Devoted",
      description: "Play on 50 different days",
      tone: "fuchsia",
      category: "Habits",
      target: 50,
      value: (c) => c.daysPlayed,
    },
    {
      id: "streak-3",
      name: "Three in a Row",
      description: "Play 3 days in a row",
      tone: "emerald",
      category: "Habits",
      target: 3,
      value: (c) => c.bestStreak,
    },
    {
      id: "streak-7",
      name: "Week Streak",
      description: "Play 7 days in a row",
      tone: "accent",
      category: "Habits",
      target: 7,
      value: (c) => c.bestStreak,
    },
    {
      id: "streak-14",
      name: "Fortnight Streak",
      description: "Play 14 days in a row",
      tone: "fuchsia",
      category: "Habits",
      target: 14,
      value: (c) => c.bestStreak,
    },
    {
      id: "streak-30",
      name: "Iron Streak",
      description: "Play 18 days in a row",
      tone: "gold",
      category: "Habits",
      target: 18,
      value: (c) => c.bestStreak,
    },
    {
      id: "weekend-warrior",
      name: "Weekend Warrior",
      description: "Record 25 weekend runs",
      tone: "accent",
      category: "Habits",
      target: 25,
      value: (c) => c.weekendRuns,
    },
    {
      id: "night-owl",
      name: "Night Owl",
      description: "Record 25 runs between midnight and 6am",
      tone: "fuchsia",
      category: "Habits",
      target: 25,
      value: (c) => c.nightRuns,
    },
    // The old "beat your own PB by N seconds" badges were unobservable: a board
    // is a top-100 cut, so a player's own slower runs are not on it and there is
    // never a previous PB to measure against. These count near-misses instead,
    // which the board does show.
    {
      id: "near-miss",
      name: "Near Miss",
      description: "Finish within a second of the record on 5 levels",
      tone: "emerald",
      category: "Habits",
      target: 5,
      value: (c) => c.nearMiss,
    },
    {
      id: "breathing-down",
      name: "Breathing Down Their Necks",
      description: "Finish within a second of the record on 15 levels",
      tone: "gold",
      category: "Habits",
      target: 15,
      value: (c) => c.nearMiss,
    },
  ];
  return defs;
}

/** Build level→pack and pack→size lookups once. */
function indexLevels(levels: LevelInfo[]) {
  const packOf = new Map<string, string>();
  const levelsPerPack = new Map<string, number>();
  for (const l of levels) {
    packOf.set(l.id, l.packId);
    levelsPerPack.set(l.packId, (levelsPerPack.get(l.packId) ?? 0) + 1);
  }
  return { packOf, levelsPerPack };
}

function fmt(v: number, unit = ""): string {
  if (!Number.isFinite(v)) return "—";
  const n = Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  return `${n}${unit}`;
}

/** Whether a summary satisfies a definition. */
function satisfied(def: AchievementDef, c: CareerSummary): boolean {
  const v = def.value(c);
  if (!Number.isFinite(v) || def.target <= 0) return false;
  return def.lowerIsBetter ? v <= def.target : v >= def.target;
}

/** One player's achievement case, with progress toward each locked badge. */
export function computeAchievements(
  career: CareerSummary,
  totalLevels: number,
  totalPacks: number,
  packs: LevelPack[],
  levels: LevelInfo[],
): Achievement[] {
  return achievementDefs(totalLevels, totalPacks, packs).map((def) => {
    const value = def.value(career);
    const target = def.target;
    const measurable = target > 0 && Number.isFinite(value);
    const earned = measurable && (def.lowerIsBetter ? value <= target : value >= target);
    // A lower-is-better badge climbs as the time drops; a value above the target
    // would give a negative fraction, so progress is clamped at zero rather than
    // shown as a shrinking bar.
    const progress = !measurable
      ? 0
      : def.lowerIsBetter
        ? Math.max(0, Math.min(1, target / Math.max(value, 1e-9)))
        : Math.min(1, value / target);
    const detail = def.lowerIsBetter
      ? Number.isFinite(value)
        ? `${fmt(value, def.unit)} / ${fmt(target, def.unit)}`
        : `— / ${fmt(target, def.unit)}`
      : `${fmt(Math.min(value, target), def.unit)} / ${fmt(target, def.unit)}`;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      earned,
      progress,
      detail,
      tone: def.tone,
      category: def.category,
    };
  });
}

const ARROWS: ArrowKind[] = ["narrow", "speedy", "energy"];

/**
 * Build every player's career summary from the merged boards.
 *
 * Personal bests come from `toStandings`, so a player's own slower runs never
 * count as their PB, but *every* raw entry still feeds the volume counters and
 * the fast-run thresholds.
 */
export function buildCareers(
  levels: LevelInfo[],
  packs: LevelPack[],
  data: Record<string, LeaderboardEntry[]>,
): Map<string, CareerSummary> {
  const careers = new Map<string, CareerSummary>();
  const { packOf, levelsPerPack } = indexLevels(levels);
  const levelsPerPackObj = Object.fromEntries(levelsPerPack);
  const totalLevels = levels.length;

  const get = (username: string): CareerSummary => {
    const key = username.toLowerCase();
    let c = careers.get(key);
    if (!c) {
      c = emptyCareer(username, totalLevels, packs.length);
      c.levelsPerPack = levelsPerPackObj;
      careers.set(key, c);
    }
    return c;
  };

  // Per-player day sets, for streaks.
  const daysByPlayer = new Map<string, Set<string>>();
  const DAY_MS = 86_400_000;

  for (const level of levels) {
    const entries = data[level.id] ?? [];
    if (entries.length === 0) continue;
    const standings = toStandings(entries);
    const wrTime = standings[0]?.completion_time ?? Infinity;
    const positionOf = new Map<string, number>();
    standings.forEach((e, i) => positionOf.set(e.username.toLowerCase(), i + 1));

    // Per-level best per player: one score per level, as the profile grid does.
    const bestByPlayer = new Map<string, LeaderboardEntry>();
    for (const e of entries) {
      if (!e?.username || !(e.completion_time > 0)) continue;
      const key = e.username.toLowerCase();
      const cur = bestByPlayer.get(key);
      if (!cur || e.completion_time < cur.completion_time) bestByPlayer.set(key, e);
    }

    for (const [key, best] of bestByPlayer) {
      const c = get(best.username);
      c.levelsCompleted += 1;
      const position = positionOf.get(key) ?? standings.length;
      const points = scoreRun(best.completion_time, wrTime, position);
      c.total += points;
      if (points >= MAX_SCORE) c.perfects += 1;
      if (position === 1) {
        c.wrCount += 1;
        const k = arrowKind(best.arrow_name);
        c.wrByArrow[k] = true;
      }
      if (position <= 3) c.podiumCount += 1;
      if (position <= 10) c.top10Count += 1;
      if (position <= 25) c.top25Count += 1;
      if (Number.isFinite(wrTime) && best.completion_time - wrTime <= 1) c.nearMiss += 1;

      const k = arrowKind(best.arrow_name);
      c.levelsPerArrow[k] += 1;
      if (best.completion_time < c.bestPerArrow[k]) c.bestPerArrow[k] = best.completion_time;

      const packId = packOf.get(level.id);
      if (packId) c.packProgress[packId] = (c.packProgress[packId] ?? 0) + 1;
    }

    for (const e of entries) {
      if (!e?.username || !(e.completion_time > 0)) continue;
      const c = get(e.username);
      c.runs += 1;
      if (e.completion_time < c.fastest) c.fastest = e.completion_time;
      if (e.completion_time < 12) c.sub12 += 1;
      if (e.completion_time < 13) c.sub13 += 1;
      if (e.completion_time < 15) c.sub15 += 1;
      if (e.completion_time < 16) c.sub16 += 1;
      if (e.completion_time < 20) c.sub20 += 1;

      const at = e.created_at ? new Date(e.created_at) : null;
      if (at && !Number.isNaN(at.getTime())) {
        const day = at.toISOString().slice(0, 10);
        let set = daysByPlayer.get(e.username.toLowerCase());
        if (!set) {
          set = new Set();
          daysByPlayer.set(e.username.toLowerCase(), set);
        }
        set.add(day);
        const dow = at.getUTCDay();
        if (dow === 0 || dow === 6) c.weekendRuns += 1;
        if (at.getUTCHours() < 6) c.nightRuns += 1;
      }
    }
  }

  for (const [key, c] of careers) {
    c.average = c.levelsCompleted ? c.total / c.levelsCompleted : 0;
    c.arrowsUsed = ARROWS.filter((k) => c.levelsPerArrow[k] > 0).length;
    c.packsComplete = [...levelsPerPack.entries()].filter(
      ([packId, count]) => count > 0 && (c.packProgress[packId] ?? 0) >= count,
    ).length;
    const days = daysByPlayer.get(key);
    if (days) {
      c.daysPlayed = days.size;
      c.bestStreak = longestStreak([...days].sort(), DAY_MS);
    }
  }

  return careers;
}

/** Longest run of consecutive calendar days in a sorted list of `YYYY-MM-DD`. */
function longestStreak(sortedDays: string[], dayMs: number): number {
  if (sortedDays.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = Date.parse(`${sortedDays[i - 1]}T00:00:00Z`);
    const cur = Date.parse(`${sortedDays[i]}T00:00:00Z`);
    run = cur - prev === dayMs ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export interface Earner {
  username: string;
  /** ISO timestamp of the run that first completed the achievement. */
  at: string;
}

/**
 * Who earned each achievement, and when — earliest first.
 *
 * One chronological pass over every dated run on every board. After each run the
 * running career of the player who just ran is re-checked against every badge;
 * the first run at which a badge flips to earned fixes that player's timestamp.
 *
 * Rank-derived badges (WRs, podiums, perfects) are measured against the *final*
 * board, because the game exposes no historical standings: the ordering says
 * when a player's own runs first satisfied the badge under today's ranking, not
 * when the badge was true at the time. Runs without a timestamp (legacy
 * imports) cannot be dated, so they are skipped here — they still count in the
 * profile summaries.
 */
export function computeEarners(
  levels: LevelInfo[],
  packs: LevelPack[],
  data: Record<string, LeaderboardEntry[]>,
): Map<string, Earner[]> {
  const { packOf, levelsPerPack } = indexLevels(levels);
  const levelsPerPackObj = Object.fromEntries(levelsPerPack);
  const defs = achievementDefs(levels.length, packs.length, packs);
  const out = new Map<string, Earner[]>();
  for (const d of defs) out.set(d.id, []);

  const DAY_MS = 86_400_000;

  // Each level's final standings, keyed by player, so a rank-derived badge can
  // be read straight off the board the profile grid uses. Building this once
  // keeps the per-run re-evaluation below to a map lookup per finished level.
  interface Standing {
    position: number;
    points: number;
    nearMiss: boolean;
  }
  const finalStanding = new Map<string, Map<string, Standing>>();
  for (const level of levels) {
    const standings = toStandings(data[level.id] ?? []);
    if (standings.length === 0) continue;
    const wrTime = standings[0].completion_time;
    const byPlayer = new Map<string, Standing>();
    standings.forEach((e, i) => {
      byPlayer.set(e.username.toLowerCase(), {
        position: i + 1,
        points: scoreRun(e.completion_time, wrTime, i + 1),
        nearMiss: e.completion_time - wrTime <= 1,
      });
    });
    finalStanding.set(level.id, byPlayer);
  }

  interface Row {
    username: string;
    time: number;
    at: number;
    iso: string;
    levelId: string;
    arrow: ArrowKind;
  }
  const rows: Row[] = [];
  for (const level of levels) {
    for (const e of data[level.id] ?? []) {
      if (!e?.username || !(e.completion_time > 0) || !e.created_at) continue;
      const at = Date.parse(e.created_at);
      if (Number.isNaN(at)) continue;
      rows.push({
        username: e.username,
        time: e.completion_time,
        at,
        iso: new Date(at).toISOString(),
        levelId: level.id,
        arrow: arrowKind(e.arrow_name),
      });
    }
  }
  // Ties on the same millisecond keep board order, which is already the
  // chronological input, so the resulting list reads as earned-first.
  rows.sort((a, b) => a.at - b.at);

  interface Live {
    username: string;
    runs: number;
    pbs: Map<string, { time: number; arrow: ArrowKind }>;
    bestPerArrow: Record<ArrowKind, number>;
    levelsPerArrow: Record<ArrowKind, number>;
    arrows: Set<ArrowKind>;
    sub12: number;
    sub13: number;
    sub15: number;
    sub16: number;
    sub20: number;
    fastest: number;
    packProgress: Map<string, number>;
    days: Set<string>;
    weekend: number;
    night: number;
    streak: number;
    bestStreak: number;
    lastDay: string | null;
    earned: Set<string>;
  }
  const live = new Map<string, Live>();
  const getLive = (username: string): Live => {
    const key = username.toLowerCase();
    let l = live.get(key);
    if (!l) {
      l = {
        username,
        runs: 0,
        pbs: new Map(),
        bestPerArrow: { narrow: Infinity, speedy: Infinity, energy: Infinity },
        levelsPerArrow: { narrow: 0, speedy: 0, energy: 0 },
        arrows: new Set(),
        sub12: 0,
        sub13: 0,
        sub15: 0,
        sub16: 0,
        sub20: 0,
        fastest: Infinity,
        packProgress: new Map(),
        days: new Set(),
        weekend: 0,
        night: 0,
        streak: 0,
        bestStreak: 0,
        lastDay: null,
        earned: new Set(),
      };
      live.set(key, l);
    }
    return l;
  };

  for (const r of rows) {
    const l = getLive(r.username);
    l.runs += 1;
    if (r.time < l.fastest) l.fastest = r.time;
    if (r.time < 12) l.sub12 += 1;
    if (r.time < 13) l.sub13 += 1;
    if (r.time < 15) l.sub15 += 1;
    if (r.time < 16) l.sub16 += 1;
    if (r.time < 20) l.sub20 += 1;
    l.arrows.add(r.arrow);
    if (r.time < l.bestPerArrow[r.arrow]) l.bestPerArrow[r.arrow] = r.time;

    const prior = l.pbs.get(r.levelId);
    if (prior == null) {
      const packId = packOf.get(r.levelId);
      if (packId) l.packProgress.set(packId, (l.packProgress.get(packId) ?? 0) + 1);
      l.levelsPerArrow[r.arrow] += 1;
      l.pbs.set(r.levelId, { time: r.time, arrow: r.arrow });
    } else if (r.time < prior.time) {
      l.pbs.set(r.levelId, { time: r.time, arrow: r.arrow });
    }

    const day = r.iso.slice(0, 10);
    if (!l.days.has(day)) {
      l.days.add(day);
      const cur = Date.parse(`${day}T00:00:00Z`);
      l.streak =
        l.lastDay && cur - Date.parse(`${l.lastDay}T00:00:00Z`) === DAY_MS ? l.streak + 1 : 1;
      l.lastDay = day;
      if (l.streak > l.bestStreak) l.bestStreak = l.streak;
    }
    const at = new Date(r.at);
    const dow = at.getUTCDay();
    if (dow === 0 || dow === 6) l.weekend += 1;
    if (at.getUTCHours() < 6) l.night += 1;

    // Rank-derived counters, read from the final standings so podium / top-10 /
    // top-25 agree with the profile grid. A level's standing is looked up for
    // every level the player had finished by this run, so the counters describe
    // "how many levels you had podiumed, judged by today's boards".
    let wr = 0;
    let podium = 0;
    let top10 = 0;
    let top25 = 0;
    let perfects = 0;
    let total = 0;
    let nearMiss = 0;
    const wrByArrow: Record<ArrowKind, boolean> = { narrow: false, speedy: false, energy: false };
    for (const [levelId, pb] of l.pbs) {
      const standing = finalStanding.get(levelId)?.get(l.username.toLowerCase());
      if (!standing) continue;
      if (standing.position === 1) {
        wr += 1;
        wrByArrow[pb.arrow] = true;
      }
      if (standing.position <= 3) podium += 1;
      if (standing.position <= 10) top10 += 1;
      if (standing.position <= 25) top25 += 1;
      if (standing.nearMiss) nearMiss += 1;
      total += standing.points;
      if (standing.points >= MAX_SCORE) perfects += 1;
    }

    const summary: CareerSummary = {
      username: l.username,
      runs: l.runs,
      levelsCompleted: l.pbs.size,
      totalLevels: levels.length,
      totalPacks: packs.length,
      fastest: l.fastest,
      sub12: l.sub12,
      sub13: l.sub13,
      sub15: l.sub15,
      sub16: l.sub16,
      sub20: l.sub20,
      wrCount: wr,
      podiumCount: podium,
      top10Count: top10,
      top25Count: top25,
      perfects,
      average: l.pbs.size ? total / l.pbs.size : 0,
      total,
      packsComplete: [...levelsPerPack.entries()].filter(
        ([packId, count]) => count > 0 && (l.packProgress.get(packId) ?? 0) >= count,
      ).length,
      arrowsUsed: l.arrows.size,
      levelsPerArrow: { ...l.levelsPerArrow },
      bestPerArrow: { ...l.bestPerArrow },
      daysPlayed: l.days.size,
      weekendRuns: l.weekend,
      nightRuns: l.night,
      bestStreak: l.bestStreak,
      nearMiss,
      packProgress: Object.fromEntries(l.packProgress),
      levelsPerPack: levelsPerPackObj,
      wrByArrow,
    };

    for (const def of defs) {
      if (l.earned.has(def.id)) continue;
      if (!satisfied(def, summary)) continue;
      l.earned.add(def.id);
      out.get(def.id)?.push({ username: l.username, at: r.iso });
    }
  }

  return out;
}

export const TONE_CLASSES: Record<Tone, string> = {
  gold: "text-amber-400 border-amber-500/25 bg-amber-500/10",
  accent: "text-[var(--app-accent)] border-[var(--app-accent)]/25 bg-[var(--app-accent)]/10",
  emerald: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10",
  fuchsia: "text-fuchsia-400 border-fuchsia-500/25 bg-fuchsia-500/10",
  slate: "text-slate-300 border-white/15 bg-white/5",
};

/** NarrowScore tier name for an average, for the profile header. */
export function tierNameFor(average: number): string {
  return tierFor(average).name;
}
