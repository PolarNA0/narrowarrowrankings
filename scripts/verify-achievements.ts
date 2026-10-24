/**
 * Checks the achievement rules over the real computeAchievements engine, and the
 * sub-10 counter that feeds it.
 *
 * The rules are pure, so they run without a Supabase project or a live board.
 * Two properties matter most and are asserted directly:
 *   - an unloaded board must never unlock anything (a zero target is not a win),
 *   - a target is only met by reaching it, so progress and `earned` agree.
 *
 * Run: npx tsx scripts/verify-achievements.ts
 */
import {
  SUB_TEN_SECONDS,
  computeAchievements,
  countSubTenRuns,
  type AchievementInput,
} from "@/lib/achievements";
import type { LeaderboardEntry } from "@/types";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

let runId = 1;
function entry(username: string, time: number, arrow = "Narrow Arrow"): LeaderboardEntry {
  return {
    run_id: runId++,
    completion_time: time,
    username,
    arrow_name: arrow,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

const base: AchievementInput = {
  medals: { first: 0, second: 0, third: 0, top10: 0, wrLevelIds: [] },
  levelsCompleted: 0,
  totalLevels: 64,
  score: { username: "polar", total: 0, average: 0, levelsPlayed: 0, perfects: 0, levels: [] },
  packsFullyCompleted: 0,
  totalPacks: 8,
  subTenRuns: 0,
};

function byId(id: string, input: AchievementInput) {
  const found = computeAchievements(input).find((a) => a.id === id);
  if (!found) throw new Error(`no achievement ${id}`);
  return found;
}

console.log("engine shape");
check("every achievement is returned", computeAchievements(base).length === 10);
check("ids are unique", new Set(computeAchievements(base).map((a) => a.id)).size === 10);
check(
  "progress is always within 0..1",
  computeAchievements({
    ...base,
    levelsCompleted: 100,
    medals: { first: 100, second: 0, third: 0, top10: 0, wrLevelIds: [] },
    subTenRuns: 100,
  }).every((a) => a.progress >= 0 && a.progress <= 1),
);

console.log("\nno false unlocks before data arrives");
// The regression this guards: a zero target made `0 >= 0` true, so every
// achievement read as earned while the boards were still empty.
const noData = computeAchievements({
  medals: { first: 0, second: 0, third: 0, top10: 0, wrLevelIds: [] },
  levelsCompleted: 0,
  totalLevels: 0,
  score: null,
  packsFullyCompleted: 0,
  totalPacks: 0,
  subTenRuns: 0,
});
check(
  "nothing is earned with no levels",
  noData.every((a) => !a.earned),
);
check(
  "Completionist stays locked at 0 levels",
  !byId("completionist", { ...base, totalLevels: 0 }).earned,
);
check(
  "Pack Master stays locked with 0 packs",
  !byId("pack-master", { ...base, totalPacks: 0 }).earned,
);
check(
  "an unmeasurable goal reports no progress",
  byId("completionist", { ...base, totalLevels: 0 }).progress === 0,
);

console.log("\nthresholds");
check(
  "9 WRs does not earn WR Hunter",
  !byId("wr-hunter", { ...base, medals: { ...base.medals!, first: 9 } }).earned,
);
check(
  "10 WRs earns WR Hunter",
  byId("wr-hunter", { ...base, medals: { ...base.medals!, first: 10 } }).earned,
);
check(
  "39 WRs does not earn WR Legend",
  !byId("wr-legend", { ...base, medals: { ...base.medals!, first: 39 } }).earned,
);
check(
  "40 WRs earns WR Legend",
  byId("wr-legend", { ...base, medals: { ...base.medals!, first: 40 } }).earned,
);

// Podium Regular counts all three podium places, not just wins.
check(
  "podiums add across first, second and third",
  byId("podium-regular", {
    ...base,
    medals: { first: 10, second: 10, third: 5, top10: 0, wrLevelIds: [] },
  }).earned,
);
check(
  "24 podiums is short of Podium Regular",
  !byId("podium-regular", {
    ...base,
    medals: { first: 8, second: 8, third: 8, top10: 0, wrLevelIds: [] },
  }).earned,
);

check(
  "Elite Average needs a 900 average",
  !byId("elite-average", {
    ...base,
    score: { ...base.score!, average: 899.9 },
  }).earned,
);
// Guards against rounding the average up across the threshold.
check(
  "an average of 899.6 does not round up to 900",
  !byId("elite-average", { ...base, score: { ...base.score!, average: 899.6 } }).earned,
);
check(
  "Elite Average unlocks at 900",
  byId("elite-average", { ...base, score: { ...base.score!, average: 900 } }).earned,
);

console.log("\nsub-10 counting");
const boards: Record<string, LeaderboardEntry[]> = {
  a: [entry("polar", 9.5), entry("polar", 12.0), entry("other", 8.0)],
  b: [entry("polar", 10.0), entry("polar", 7.25), entry("POLAR", 6.5)],
};
// Exactly 10.000s is not "under ten".
check("only runs under 10s count", countSubTenRuns("polar", boards) === 3);
check(
  "a run of exactly 10.000s is not counted",
  countSubTenRuns("boundary", { a: [entry("boundary", SUB_TEN_SECONDS)] }) === 0,
);
check("counting is case-insensitive", countSubTenRuns("POLAR", boards) === 3);
check("another player's runs are not counted", countSubTenRuns("other", boards) === 1);
check("an unknown player counts zero", countSubTenRuns("nobody", boards) === 0);
check("no boards is safe", countSubTenRuns("polar", {}) === 0);
check(
  "a zero or negative time never counts",
  countSubTenRuns("zero", { a: [entry("zero", 0), entry("zero", -5)] }) === 0,
);

check(
  "Sub-10 Club unlocks on the tenth fast run",
  byId("sub-ten", { ...base, subTenRuns: 10 }).earned,
);
check("Sub-10 Club needs ten", !byId("sub-ten", { ...base, subTenRuns: 9 }).earned);

console.log("\nprogress detail");
const hunter = byId("wr-hunter", { ...base, medals: { ...base.medals!, first: 5 } });
check("a partial goal reports its fraction", hunter.progress === 0.5, String(hunter.progress));
check("a partial goal shows the counts", hunter.detail === "5 / 10", hunter.detail);
const capped = byId("wr-hunter", { ...base, medals: { ...base.medals!, first: 25 } });
check("progress is capped at 1", capped.progress === 1);
check("detail does not overshoot the target", capped.detail === "10 / 10", capped.detail);

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed > 0) process.exit(1);
