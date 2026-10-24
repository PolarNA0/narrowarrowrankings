import type { PlayerScore } from "./narrowscore";
import type { ComputedMedals } from "./medals";
import type { LeaderboardEntry } from "../types";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  earned: boolean;
  progress: number; // 0..1
  detail: string;
  tone: "gold" | "accent" | "emerald" | "fuchsia" | "slate";
}

export interface AchievementInput {
  medals?: ComputedMedals;
  levelsCompleted: number;
  totalLevels: number;
  score?: PlayerScore | null;
  packsFullyCompleted: number;
  totalPacks: number;
  subTenRuns: number;
}

function ach(
  id: string,
  name: string,
  description: string,
  value: number,
  target: number,
  tone: Achievement["tone"],
  unit = "",
  displayValue = value,
): Achievement {
  // A non-positive target means the goal is not measurable yet (e.g. the boards
  // have not loaded), so it must read as locked rather than trivially earned —
  // `0 >= 0` would otherwise unlock everything before any data arrives.
  const measurable = target > 0;
  const progress = measurable ? Math.min(1, value / target) : 0;
  return {
    id,
    name,
    description,
    earned: measurable && value >= target,
    progress,
    detail: measurable
      ? `${Math.min(displayValue, target)}${unit} / ${target}${unit}`
      : `0${unit} / —`,
    tone,
  };
}

/** Unlockable badges derived purely from a player's real run data. */
export function computeAchievements(input: AchievementInput): Achievement[] {
  const wrs = input.medals?.first ?? 0;
  const podiums = wrs + (input.medals?.second ?? 0) + (input.medals?.third ?? 0);
  const perfects = input.score?.perfects ?? 0;
  const average = input.score?.average ?? 0;

  return [
    ach(
      "completionist",
      "Completionist",
      "Finish every official level",
      input.levelsCompleted,
      input.totalLevels,
      "emerald",
    ),
    ach("wr-hunter", "WR Hunter", "Hold 10 world records", wrs, 10, "gold"),
    ach("wr-legend", "WR Legend", "Hold 40 world records", wrs, 40, "gold"),
    ach(
      "podium-regular",
      "Podium Regular",
      "Land 25 podium finishes",
      podiums,
      25,
      "accent",
    ),
    ach(
      "pack-master",
      "Pack Master",
      "Fully complete every pack",
      input.packsFullyCompleted,
      input.totalPacks,
      "fuchsia",
    ),
    ach(
      "sub-ten",
      "Sub-10 Club",
      "Record 10 runs under 10 seconds",
      input.subTenRuns,
      10,
      "accent",
    ),
    ach(
      "perfectionist",
      "Perfectionist",
      "Score a perfect 1000 on 20 levels",
      perfects,
      20,
      "gold",
    ),
    // Compared on the raw average, not a rounded one: 899.6 must not read as 900.
    ach(
      "elite-average",
      "Elite Average",
      "Reach a 900+ NarrowScore average",
      average,
      900,
      "fuchsia",
      "",
      Math.round(average),
    ),
    ach(
      "top-ten-machine",
      "Top 10 Machine",
      "Finish top 10 on 40 levels",
      input.medals?.top10 ?? 0,
      40,
      "accent",
    ),
    ach(
      "veteran",
      "Veteran",
      "Complete at least 30 levels",
      input.levelsCompleted,
      30,
      "slate",
    ),
  ];
}

/** A run this quick counts toward Sub-10 Club. */
export const SUB_TEN_SECONDS = 10;

/**
 * How many of a player's runs beat {@link SUB_TEN_SECONDS}.
 *
 * Counts raw board entries rather than PBs, because the achievement is about how
 * many fast runs a player has recorded, not how many levels they are fast on.
 */
export function countSubTenRuns(
  username: string,
  data: Record<string, LeaderboardEntry[]>,
): number {
  const target = username.toLowerCase();
  let count = 0;
  for (const entries of Object.values(data)) {
    for (const entry of entries) {
      if (
        entry?.username?.toLowerCase() === target &&
        entry.completion_time > 0 &&
        entry.completion_time < SUB_TEN_SECONDS
      ) {
        count += 1;
      }
    }
  }
  return count;
}

export const TONE_CLASSES: Record<Achievement["tone"], string> = {
  gold: "text-amber-400 border-amber-500/25 bg-amber-500/10",
  accent: "text-[var(--app-accent)] border-[var(--app-accent)]/25 bg-[var(--app-accent)]/10",
  emerald: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10",
  fuchsia: "text-fuchsia-400 border-fuchsia-500/25 bg-fuchsia-500/10",
  slate: "text-slate-300 border-white/15 bg-white/5",
};
