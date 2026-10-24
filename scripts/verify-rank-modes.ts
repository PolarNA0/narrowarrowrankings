/**
 * Verify the two Rank Points modes over the REAL aggregation
 * (computeRankPoints), not a reimplementation:
 *   - best-arrow: each map scores once, for the player's fastest run on any arrow
 *   - all-arrows: each map scores once per arrow, cutoffs derived per arrow
 * and that arrow bucketing folds name variants of the same arrow together.
 */
import { computeRankPoints, arrowBucket, WR_POINTS } from "@/lib/rankPoints";
import type { LeaderboardEntry, RankInfo } from "@/types";

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
function entry(username: string, arrow: string, time: number): LeaderboardEntry {
  return {
    run_id: runId++,
    completion_time: time,
    username,
    arrow_name: arrow,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function rankInfos(): Record<string, RankInfo> {
  const ranks: Record<string, RankInfo> = {};
  for (const rank of [
    "Champion",
    "Elite",
    "Legend",
    "Expert",
    "Master",
    "Pro",
    "Skilled",
    "Average",
    "Beginner",
  ]) {
    ranks[rank] = {
      name: rank,
      color: "#fff",
      bgColor: "#000",
      borderColor: "#111",
      timeCutoff: 0,
    };
  }
  return ranks;
}

// A board with all three arrows represented, narrow fastest.
const NARROW = "Narrow Arrow";
const SPEEDY = "Speedy Arrow";
const ENERGY = "Energy Arrow";

const boards: Record<string, LeaderboardEntry[]> = {
  alpha: [
    entry("Polar", NARROW, 10),
    entry("Rival", NARROW, 12),
    entry("Polar", SPEEDY, 20),
    entry("Rival", SPEEDY, 22),
    entry("Polar", ENERGY, 30),
    entry("Rival", ENERGY, 33),
  ],
  beta: [
    entry("Polar", NARROW, 15),
    entry("Rival", NARROW, 16),
    // Beta has no speedy/energy runs, so it must contribute one slot only.
  ],
};

// ---------------------------------------------------------------------------
console.log("arrow bucketing folds name variants");
check("exact narrow", arrowBucket(entry("x", "Narrow Arrow", 1)) === "narrow");
check("lowercase narrow", arrowBucket(entry("x", "narrow", 1)) === "narrow");
check("speedy variant", arrowBucket(entry("x", "speedy arrow", 1)) === "speedy");
check("energy variant", arrowBucket(entry("x", "Energy", 1)) === "energy");
check("missing name defaults to narrow", arrowBucket(entry("x", "", 1)) === "narrow");

// ---------------------------------------------------------------------------
console.log("\nbest-arrow scores each map once");
const best = computeRankPoints(["alpha", "beta"], boards, {}, "best-arrow");
check("one slot per map", best.slotsScored === 2, `got ${best.slotsScored}`);
const bestPolar = best.players.find((p) => p.username === "Polar");
check("Polar played both maps once", bestPolar?.mapsPlayed === 2, `got ${bestPolar?.mapsPlayed}`);
check(
  "best-arrow keeps the fastest run on the map (narrow 10, not speedy 20)",
  bestPolar?.perLevel.alpha?.time === 10,
  `got ${bestPolar?.perLevel.alpha?.time}`,
);
check("no arrow label in best-arrow mode", bestPolar?.perLevel.alpha?.arrow === "");

// ---------------------------------------------------------------------------
console.log("\nall-arrows scores each map once per arrow");
const all = computeRankPoints(["alpha", "beta"], boards, {}, "all-arrows");
// alpha has 3 arrows, beta has only narrow.
check("alpha contributes 3 slots, beta 1", all.slotsScored === 4, `got ${all.slotsScored}`);
const allPolar = all.players.find((p) => p.username === "Polar");
check("Polar scored 4 map-arrows", allPolar?.mapsPlayed === 4, `got ${allPolar?.mapsPlayed}`);
check(
  "all-arrows is never lower than best-arrow for the same player",
  (allPolar?.total ?? 0) >= (bestPolar?.total ?? 0),
  `all=${allPolar?.total} best=${bestPolar?.total}`,
);
check("alpha narrow scored separately", allPolar?.perLevel["alpha|narrow"]?.time === 10);
check("alpha speedy scored separately", allPolar?.perLevel["alpha|speedy"]?.time === 20);
check("alpha energy scored separately", allPolar?.perLevel["alpha|energy"]?.time === 30);
check("per-level key carries the arrow", allPolar?.perLevel["alpha|speedy"]?.arrow === "speedy");

// A WR is per map-arrow in all-arrows mode: Polar holds all three on alpha.
check("Polar holds 4 WRs in all-arrows", allPolar?.wrs === 4, `got ${allPolar?.wrs}`);

// ---------------------------------------------------------------------------
console.log("\nper-arrow cutoffs are derived from that arrow's own board");
// On alpha the narrow WR is 10 and the speedy WR is 20. If cutoffs were shared
// across arrows, Rival's 22s speedy run would be scored against the narrow
// curve (2.2x the 10s WR) and fall far down the ladder; against the speedy
// board it is only 1.1x, so it earns a real rank.
const rivalAll = all.players.find((p) => p.username === "Rival");
const speedyResult = rivalAll?.perLevel["alpha|speedy"];
check(
  "Rival's speedy run is ranked against the speedy board, not the narrow one",
  speedyResult?.rank === "Expert",
  `got ${speedyResult?.rank}`,
);
check(
  "Rival is not Champion on a 22s run when the speedy WR is 20s",
  speedyResult?.rank !== "Champion",
  `got ${speedyResult?.rank}`,
);

// ---------------------------------------------------------------------------
console.log("\nmax possible follows the mode");
check(
  "best-arrow max is 2 slots x WR",
  best.slotsScored * WR_POINTS === 22,
  `got ${best.slotsScored * WR_POINTS}`,
);
check(
  "all-arrows max is 4 slots x WR",
  all.slotsScored * WR_POINTS === 44,
  `got ${all.slotsScored * WR_POINTS}`,
);
check("WR points are Champion plus the bonus", WR_POINTS === 11, `got ${WR_POINTS}`);

// ---------------------------------------------------------------------------
console.log("\nempty boards contribute nothing");
const empty = computeRankPoints(["alpha", "missing"], boards, {}, "all-arrows");
check("a level with no runs is skipped", empty.slotsScored === 3, `got ${empty.slotsScored}`);

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed > 0) process.exit(1);
