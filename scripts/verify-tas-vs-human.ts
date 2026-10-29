/**
 * Checks the per-level TAS-vs-human comparison behind the "TAS vs Human"
 * records tab.
 *
 * Run: npx tsx scripts/verify-tas-vs-human.ts
 *
 * The interesting behaviour is all in the pure builder, so the checks drive it
 * with hand-made boards: which run is picked as each side, how the arrow filter
 * narrows both sides, that a missing side yields no gap rather than a bogus one,
 * and the sort/summary the table relies on.
 */
import {
  buildTasVsHumanRows,
  formatGap,
  sortTasVsHumanRows,
  summariseTasVsHuman,
} from "@/lib/tas-vs-human";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import type { TasSummary } from "@/lib/tas-leaderboard";

let failures = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra === undefined ? "" : `  ${extra}`}`);
  if (!ok) failures++;
};

const LEVELS: LevelInfo[] = [
  { id: "A", name: "Alpha", gameOrder: 0, packId: "official-pack" },
  { id: "B", name: "Bravo", gameOrder: 1, packId: "official-pack" },
  { id: "C", name: "Charlie", gameOrder: 2, packId: "official-pack" },
  { id: "D", name: "Delta", gameOrder: 3, packId: "official-pack" },
];

const run = (username: string, time: number, arrow: string, id = 0): LeaderboardEntry => ({
  run_id: id,
  completion_time: time,
  username,
  arrow_name: arrow,
  created_at: "2026-01-01T00:00:00Z",
});

const tas = (username: string, timeSec: number, arrow: string): TasSummary => ({
  id: `${username}-${timeSec}`,
  username,
  timeMs: Math.round(timeSec * 1000),
  arrowName: arrow,
  inputCount: 100,
  createdAt: "2026-01-01T00:00:00Z",
});

// Alpha: TAS ahead by 0.2s. Bravo: human ahead by 0.5s. Charlie: TAS only (its
// human board is empty). Delta: human only (so no gap).
const data: Record<string, LeaderboardEntry[]> = {
  A: [run("Polar", 11.0, "Narrow Arrow", 1), run("Sam", 11.4, "Speedy Arrow", 2)],
  B: [run("Polar", 10.0, "Narrow Arrow", 3), run("Kai", 10.3, "Energy Arrow", 4)],
  C: [],
  D: [run("Polar", 9.0, "Narrow Arrow", 6)],
};
const tasBoards: Record<string, TasSummary[]> = {
  A: [tas("Bot", 10.8, "Narrow Arrow"), tas("Bot", 11.2, "Energy Arrow")],
  B: [tas("Bot", 10.5, "Narrow Arrow")],
  C: [tas("Bot", 11.0, "Narrow Arrow")],
};

const rows = buildTasVsHumanRows(LEVELS, data, tasBoards);
check("one row per level", rows.length === LEVELS.length, rows.length);

const a = rows[0];
check(
  "the fastest human run is the human side",
  a.human?.time === 11.0 && a.human.username === "Polar",
);
check("the fastest TAS run is the TAS side", a.tas?.time === 10.8 && a.tas.username === "Bot");
check("the gap is TAS minus human", a.delta !== null && Math.abs(a.delta - -0.2) < 1e-9, a.delta);

const b = rows[1];
check("a human-ahead level has a positive gap", b.delta !== null && b.delta > 0, b.delta);

const c = rows[2];
check("a TAS-only level has no human side", c.human === null);
check("a TAS-only level has no gap", c.delta === null, c.delta);

const d = rows[3];
check("a human-only level has no TAS side", d.tas === null);
check("a human-only level has no gap", d.delta === null, d.delta);

// --- Arrow filter narrows both sides -----------------------------------------
const narrow = buildTasVsHumanRows(LEVELS, data, tasBoards, { arrow: "narrow" });
check(
  "the arrow filter narrows the human side",
  narrow[0].human?.arrow === "Narrow Arrow",
  narrow[0].human?.arrow,
);
check(
  "the arrow filter narrows the TAS side",
  narrow[0].tas?.arrow === "Narrow Arrow",
  narrow[0].tas?.arrow,
);
// Bravo's only TAS run is Narrow 10.5 while its Narrow human run is 10.0, so
// the filter flips the gap sign against the unfiltered (Energy-driven) row.
check(
  "the filter can change which side is ahead",
  narrow[1].delta !== null && narrow[1].delta > 0 && b.delta !== null && b.delta > 0,
);
check(
  "an arrow with no runs on a level drops that side",
  buildTasVsHumanRows(LEVELS, data, tasBoards, { arrow: "speedy" })[0].tas === null,
);

// --- Sorting ------------------------------------------------------------------
const byGap = sortTasVsHumanRows(rows, "gap");
check("gap sort puts the biggest TAS advantage first", byGap[0].levelId === "A", byGap[0].levelId);
check(
  "gap sort sinks the levels with no measurable gap",
  byGap.slice(2).every((r) => r.delta === null),
  byGap.map((r) => r.levelId).join(","),
);
check(
  "gap sort is stable by level name among the unmeasurable",
  byGap[2].levelName.localeCompare(byGap[3].levelName) < 0,
  `${byGap[2].levelName},${byGap[3].levelName}`,
);
const byLevel = sortTasVsHumanRows(rows, "level");
check(
  "level sort is alphabetical",
  byLevel.map((r) => r.levelName).join(",") === "Alpha,Bravo,Charlie,Delta",
  byLevel.map((r) => r.levelName).join(","),
);
check(
  "sorting does not mutate the input",
  rows.map((r) => r.levelId).join(",") === "A,B,C,D",
  rows.map((r) => r.levelId).join(","),
);

// --- Summary ------------------------------------------------------------------
const summary = summariseTasVsHuman(rows);
check("the summary counts levels", summary.levels === 4, summary.levels);
check("the summary counts levels with a TAS run", summary.withTas === 3, summary.withTas);
check("the summary counts compared levels", summary.compared === 2, summary.compared);
check("the summary counts TAS-ahead levels", summary.tasAhead === 1, summary.tasAhead);
check("the summary counts human-ahead levels", summary.humanAhead === 1, summary.humanAhead);
check(
  "the summary totals only the compared gaps",
  Math.abs(summary.totalGap - (0.5 - 0.2)) < 1e-9,
  summary.totalGap,
);

// --- Gap formatting -----------------------------------------------------------
check("a TAS lead keeps the minus sign", formatGap(-0.2) === "-0.200s", formatGap(-0.2));
check("a human lead keeps the plus sign", formatGap(0.3) === "+0.300s", formatGap(0.3));
check(
  "a tiny gap rounds to zero without a sign",
  formatGap(-0.0002) === "0.000s",
  formatGap(-0.0002),
);

// --- Empty boards degrade rather than throw -----------------------------------
const empty = buildTasVsHumanRows(LEVELS, {}, {});
check(
  "an empty board gives no sides and no gap",
  empty.every((r) => r.human === null && r.tas === null && r.delta === null),
);
check(
  "an empty summary reports zeroes",
  summariseTasVsHuman(empty).compared === 0 && summariseTasVsHuman(empty).totalGap === 0,
);

console.log(`\n${failures === 0 ? "all" : `${failures} failing`} TAS-vs-human checks`);
process.exit(failures === 0 ? 0 : 1);
