/**
 * The per-level TAS-vs-human comparison: the fastest human run on a level next
 * to the fastest tool-assisted run, and the gap between them.
 *
 * The home page already sums this gap across levels ("Humans vs perfection");
 * this is the per-level table behind that number. It is pure so the view and
 * `scripts/verify-tas-vs-human.ts` share one definition of the comparison.
 */
import type { LeaderboardEntry, LevelInfo } from "@/types";
import type { TasSummary } from "@/lib/tas-leaderboard";
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";

export interface TasVsHumanSide {
  /** Seconds. */
  time: number;
  username: string;
  arrow: string;
}

export interface TasVsHumanRow {
  levelId: string;
  levelName: string;
  /** Fastest human run on the level (restricted by the arrow filter, if set). */
  human: TasVsHumanSide | null;
  /** Fastest TAS run on the level (restricted by the arrow filter, if set). */
  tas: TasVsHumanSide | null;
  /** TAS minus human, in seconds. Negative means the TAS is ahead. */
  delta: number | null;
}

export interface TasVsHumanOptions {
  /**
   * Restrict both sides to one arrow. Left unset, each side is the level's
   * fastest run whichever arrow flew it — the same "overall vs overall"
   * comparison the home page's total makes.
   */
  arrow?: ArrowKind;
}

function fastestHuman(
  runs: LeaderboardEntry[] | undefined,
  want: ArrowKind | undefined,
): TasVsHumanSide | null {
  let best: TasVsHumanSide | null = null;
  for (const run of runs ?? []) {
    if (want && arrowKind(run.arrow_name) !== want) continue;
    if (best === null || run.completion_time < best.time) {
      best = {
        time: run.completion_time,
        username: run.username,
        arrow: run.arrow_name ?? "",
      };
    }
  }
  return best;
}

function fastestTas(
  entries: TasSummary[] | undefined,
  want: ArrowKind | undefined,
): TasVsHumanSide | null {
  let best: TasVsHumanSide | null = null;
  for (const entry of entries ?? []) {
    if (want && arrowKind(entry.arrowName) !== want) continue;
    const time = entry.timeMs / 1000;
    if (best === null || time < best.time) {
      best = { time, username: entry.username, arrow: entry.arrowName };
    }
  }
  return best;
}

/** One row per level, in the order the level list is given. */
export function buildTasVsHumanRows(
  levels: LevelInfo[],
  data: Record<string, LeaderboardEntry[]>,
  tasBoards: Record<string, TasSummary[]>,
  options: TasVsHumanOptions = {},
): TasVsHumanRow[] {
  const want = options.arrow;
  return levels.map((level) => {
    const human = fastestHuman(data[level.id], want);
    const tas = fastestTas(tasBoards[level.id], want);
    return {
      levelId: level.id,
      levelName: level.name,
      human,
      tas,
      delta: human && tas ? tas.time - human.time : null,
    };
  });
}

/**
 * `gap` puts the biggest TAS advantage first, which is what the table is for;
 * a level with no measurable gap (either side missing) sinks to the bottom.
 */
export function sortTasVsHumanRows(rows: TasVsHumanRow[], by: "gap" | "level"): TasVsHumanRow[] {
  const sorted = [...rows];
  if (by === "level") return sorted.sort((a, b) => a.levelName.localeCompare(b.levelName));
  return sorted.sort((a, b) => {
    if (a.delta === null && b.delta === null) return a.levelName.localeCompare(b.levelName);
    if (a.delta === null) return 1;
    if (b.delta === null) return -1;
    return a.delta - b.delta || a.levelName.localeCompare(b.levelName);
  });
}

export interface TasVsHumanSummary {
  levels: number;
  /** Levels with a TAS run (for the active arrow filter). */
  withTas: number;
  /** Levels where both sides exist, so a gap can be measured. */
  compared: number;
  tasAhead: number;
  humanAhead: number;
  /** Sum of the gaps over the compared levels. Negative means the TAS is ahead. */
  totalGap: number;
}

export function summariseTasVsHuman(rows: TasVsHumanRow[]): TasVsHumanSummary {
  const summary: TasVsHumanSummary = {
    levels: rows.length,
    withTas: 0,
    compared: 0,
    tasAhead: 0,
    humanAhead: 0,
    totalGap: 0,
  };
  for (const row of rows) {
    if (row.tas) summary.withTas += 1;
    if (row.delta === null) continue;
    summary.compared += 1;
    summary.totalGap += row.delta;
    if (row.delta < 0) summary.tasAhead += 1;
    else if (row.delta > 0) summary.humanAhead += 1;
  }
  return summary;
}

/** The signed gap, e.g. `-0.155s` — the sign is the point, so it is explicit. */
export function formatGap(delta: number): string {
  if (Math.abs(delta) < 0.0005) return "0.000s";
  return `${delta < 0 ? "-" : "+"}${Math.abs(delta).toFixed(3)}s`;
}
