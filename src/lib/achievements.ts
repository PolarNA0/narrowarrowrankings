import type { PlayerScore } from "./narrowscore";
import type { ComputedMedals } from "./medals";

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
): Achievement {
  const progress = target <= 0 ? 0 : Math.min(1, value / target);
  return {
    id,
    name,
    description,
    earned: value >= target,
    progress,
    detail: `${Math.min(value, target)}${unit} / ${target}${unit}`,
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
    ach("completionist", "Completionist", "Finish every official level", input.levelsCompleted, input.totalLevels, "emerald"),
    ach("wr-hunter", "WR Hunter", "Hold 10 world records", wrs, 10, "gold"),
    ach("wr-legend", "WR Legend", "Hold 40 world records", wrs, 40, "gold"),
    ach("podium-regular", "Podium Regular", "Land 25 podium finishes", podiums, 25, "accent"),
    ach("pack-master", "Pack Master", "Fully complete every pack", input.packsFullyCompleted, input.totalPacks, "fuchsia"),
    ach("sub-ten", "Sub-10 Club", "Record 10 runs under 10 seconds", input.subTenRuns, 10, "accent"),
    ach("perfectionist", "Perfectionist", "Score a perfect 1000 on 20 levels", perfects, 20, "gold"),
    ach("elite-average", "Elite Average", "Reach a 900+ NarrowScore average", Math.round(average), 900, "fuchsia"),
    ach("top-ten-machine", "Top 10 Machine", "Finish top 10 on 40 levels", input.medals?.top10 ?? 0, 40, "accent"),
    ach("veteran", "Veteran", "Complete at least 30 levels", input.levelsCompleted, 30, "slate"),
  ];
}

export const TONE_CLASSES: Record<Achievement["tone"], string> = {
  gold: "text-amber-400 border-amber-500/25 bg-amber-500/10",
  accent: "text-[var(--app-accent)] border-[var(--app-accent)]/25 bg-[var(--app-accent)]/10",
  emerald: "text-emerald-400 border-emerald-500/25 bg-emerald-500/10",
  fuchsia: "text-fuchsia-400 border-fuchsia-500/25 bg-fuchsia-500/10",
  slate: "text-slate-300 border-white/15 bg-white/5",
};
