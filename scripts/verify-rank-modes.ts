/**
 * Verify the two Rank Points modes over the REAL aggregation
 * (computeRankPoints), not a reimplementation:
 *   - best-arrow: each map scores once, for the player's fastest run on any arrow
 *   - all-arrows: each map scores once per arrow, cutoffs derived per arrow
 * and that arrow bucketing folds name variants of the same arrow together.
 */
import {
  computeRankPoints,
  arrowBucket,
  WR_POINTS,
  RANK_POINTS,
  RANK_TEXT_COLOR,
  POINT_RANK_ORDER,
  deriveLevelRankTimes,
} from "@/lib/rankPoints";
import { DEFAULT_RANKS, DEFAULT_OVERALL_RANKS, RANK_ORDER, migrateRankColors } from "@/constants";
import { getLevelDefaultRanks, resolveLevelRanks } from "@/lib/rankDefaults";
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
  best.slotsScored * WR_POINTS === 24,
  `got ${best.slotsScored * WR_POINTS}`,
);
check(
  "all-arrows max is 4 slots x WR",
  all.slotsScored * WR_POINTS === 48,
  `got ${all.slotsScored * WR_POINTS}`,
);
check("WR points are Champion plus the bonus", WR_POINTS === 12, `got ${WR_POINTS}`);

// ---------------------------------------------------------------------------
console.log("\nempty boards contribute nothing");
const empty = computeRankPoints(["alpha", "missing"], boards, {}, "all-arrows");
check("a level with no runs is skipped", empty.slotsScored === 3, `got ${empty.slotsScored}`);

// ---------------------------------------------------------------------------
// A rank added to RANK_ORDER must be wired into every per-rank table. A missing
// key does not throw: it silently yields NaN points / NaN cutoffs, so the ladder
// still renders while scoring is quietly broken. These checks are the guard.
console.log("\nevery rank in the ladder is wired into every per-rank table");
for (const rank of RANK_ORDER) {
  check(
    `RANK_POINTS has ${rank}`,
    typeof RANK_POINTS[rank] === "number",
    `got ${RANK_POINTS[rank]}`,
  );
  check(
    `RANK_TEXT_COLOR has ${rank}`,
    typeof RANK_TEXT_COLOR[rank] === "string",
    `got ${RANK_TEXT_COLOR[rank]}`,
  );
  check(`DEFAULT_RANKS has ${rank}`, !!DEFAULT_RANKS[rank]);
  check(`DEFAULT_OVERALL_RANKS has ${rank}`, !!DEFAULT_OVERALL_RANKS[rank]);
  check(`POINT_RANK_ORDER has ${rank}`, POINT_RANK_ORDER.includes(rank as never));
  // The derived cutoffs are the one table that cannot be read directly, so drive
  // the real deriver and assert the rank lands on a finite cutoff.
  const derived = deriveLevelRankTimes(
    [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((t) => entry("p", "narrow", t)),
    null,
  );
  if (rank !== "Beginner+") {
    const c = derived?.cutoffs[rank];
    check(
      `${rank} derives a finite cutoff`,
      typeof c === "number" && Number.isFinite(c),
      `got ${c}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The ladder must stay monotonic and fully ascending.
console.log("\nthe rank ladder is monotonic");
const ladder = RANK_ORDER.map((id) => DEFAULT_OVERALL_RANKS[id]?.timeCutoff ?? 0);
check(
  "overall cutoffs ascend from Champion to Beginner+",
  ladder.every((c, i) => i === 0 || c >= ladder[i - 1]),
  ladder.join(" < "),
);
const levelCutoffs = RANK_ORDER.map((id) => DEFAULT_RANKS[id]?.timeCutoff ?? 0);
check(
  "per-level default cutoffs ascend",
  levelCutoffs.every((c, i) => i === 0 || c >= levelCutoffs[i - 1]),
  levelCutoffs.join(" < "),
);
check(
  "points descend from Champion to Beginner",
  RANK_POINTS.Champion > RANK_POINTS.Grandmaster &&
    RANK_POINTS.Grandmaster > RANK_POINTS.Elite &&
    RANK_POINTS.Elite > RANK_POINTS.Beginner,
  `${RANK_POINTS.Champion}/${RANK_POINTS.Grandmaster}/${RANK_POINTS.Elite}/${RANK_POINTS.Beginner}`,
);

// ---------------------------------------------------------------------------
// Every ranked level's generated defaults must be monotonic too — a level with a
// hand-authored table but no row for a new rank would otherwise be non-monotonic
// (the new rank inheriting a slow base cutoff while sitting above a faster one).
console.log("\nper-level generated defaults stay monotonic");
const authoredLevels = [
  "1777118905185",
  "801170f9",
  "b05c7ede",
  "9892299a",
  "bbb1af96",
  "c68a5228",
  "1b901dfe",
  "b91ca820",
  "d4111ef0",
  "1778427891183",
];
for (const id of authoredLevels) {
  const ranks = getLevelDefaultRanks(id, DEFAULT_RANKS);
  const cuts = RANK_ORDER.map((r) => ranks[r]?.timeCutoff ?? 0);
  check(
    `level ${id} cutoffs ascend`,
    cuts.every((c, i) => i === 0 || c >= cuts[i - 1]),
    cuts.join(" < "),
  );
}

// ---------------------------------------------------------------------------
console.log("\nlegacy saved configs upgrade cleanly");
const legacyChampion = {
  ...DEFAULT_RANKS.Champion,
  color: "text-[#FF1F8E]",
  bgColor: "bg-[#FF1F8E]/10",
  borderColor: "border-[#FF1F8E]/50",
};
const migrated = migrateRankColors({ ...DEFAULT_RANKS, Champion: legacyChampion });
check(
  "a stored legacy Champion colour is upgraded to the new default",
  migrated.Champion.color === DEFAULT_RANKS.Champion.color,
  migrated.Champion.color,
);
check(
  "the upgraded Champion no longer collides with Grandmaster",
  migrated.Champion.color !== migrated.Grandmaster.color,
  `${migrated.Champion.color} vs ${migrated.Grandmaster.color}`,
);
const customChampion = { ...DEFAULT_RANKS.Champion, color: "text-[#123456]" };
check(
  "a hand-picked colour is never overwritten",
  migrateRankColors({ Champion: customChampion }).Champion.color === "text-[#123456]",
  migrateRankColors({ Champion: customChampion }).Champion.color,
);
// A doc saved before Grandmaster existed simply has no key for it. Spreading it
// over the defaults is what supplies the missing rank (an explicit `undefined`
// would overwrite, which is not how a stored doc behaves).
const legacyDoc = Object.fromEntries(
  Object.entries(DEFAULT_RANKS).filter(([id]) => id !== "Grandmaster"),
) as Record<string, RankInfo>;
const mergedLegacy = migrateRankColors({ ...DEFAULT_RANKS, ...legacyDoc });
check(
  "a saved config missing a new rank still gains it when merged over defaults",
  !!mergedLegacy.Grandmaster && mergedLegacy.Grandmaster.timeCutoff > 0,
  `got ${mergedLegacy.Grandmaster?.timeCutoff}`,
);

// ---------------------------------------------------------------------------
// Regression: a level config saved before a rank existed has no cutoff for it.
// Counting that as 0 used to hide the rank AND trip the 90%-usable check that
// decides whether the overall-rank legend shows summed or global cutoffs.
console.log("\na rank missing from a saved level config falls back to the generated default");
{
  const legacyLevelRanks: Record<string, RankInfo> = {};
  for (const r of RANK_ORDER.filter((id) => id !== "Grandmaster")) {
    legacyLevelRanks[r] = { ...DEFAULT_RANKS[r], timeCutoff: 10 };
  }
  const fallback = getLevelDefaultRanks("801170f9", DEFAULT_RANKS);
  const resolved: Record<string, number> = {};
  for (const rankId of RANK_ORDER) {
    const stored = legacyLevelRanks[rankId]?.timeCutoff;
    resolved[rankId] = Number(
      stored && stored > 0 ? stored : (fallback?.[rankId]?.timeCutoff ?? 0),
    );
  }
  check(
    "the missing rank resolves to a positive cutoff",
    resolved.Grandmaster > 0,
    `got ${resolved.Grandmaster}`,
  );
  check(
    "every rank resolves positive, so the legend stays on summed cutoffs",
    RANK_ORDER.every((r) => resolved[r] > 0),
    RANK_ORDER.filter((r) => !(resolved[r] > 0)).join(", "),
  );
}

// ---------------------------------------------------------------------------
// Regression: a saved levelConfig predates a rank, so the rank has no cutoff
// there. Resolving it against the *global* cutoff is wrong — the global ladder is
// absolute while a level's authored ladder is relative to its own WR, so on a
// fast level the global cutoff lands above the level's own Elite and inverts the
// ladder. It must come from the level's generated default instead.
console.log("\na rank missing from a saved levelConfig resolves from the level default");
{
  const saved: Record<string, RankInfo> = {};
  for (const r of RANK_ORDER.filter((id) => id !== "Grandmaster")) {
    saved[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
  }
  // Authored cutoffs for Diamond Rally (801170f9), mirroring rankDefaults.
  const authored: Record<string, number> = {
    Champion: 13.05,
    Elite: 13.1,
    Legend: 13.15,
    Expert: 13.2,
    Master: 13.275,
    Pro: 13.4,
    Skilled: 13.6,
    Average: 13.8,
    Beginner: 14.5,
  };
  for (const [r, t] of Object.entries(authored)) saved[r].timeCutoff = t;

  const merged = resolveLevelRanks("801170f9", saved, DEFAULT_RANKS, RANK_ORDER);
  const cuts = RANK_ORDER.filter((r) => r !== "Beginner+").map((r) => merged[r].timeCutoff);
  check(
    "the missing rank lands between Champion and Elite",
    merged.Grandmaster.timeCutoff > merged.Champion.timeCutoff &&
      merged.Grandmaster.timeCutoff < merged.Elite.timeCutoff,
    `Champion ${merged.Champion.timeCutoff}, Grandmaster ${merged.Grandmaster.timeCutoff}, Elite ${merged.Elite.timeCutoff}`,
  );
  check(
    "the resolved ladder stays monotonic (never the global 12.0s)",
    cuts.every((c, i) => i === 0 || c >= cuts[i - 1]),
    cuts.join(" < "),
  );
  check(
    "a stored cutoff still wins over the generated default",
    resolveLevelRanks(
      "801170f9",
      { ...saved, Grandmaster: { ...DEFAULT_RANKS.Grandmaster, timeCutoff: 9.9 } },
      DEFAULT_RANKS,
      RANK_ORDER,
    ).Grandmaster.timeCutoff === 9.9,
  );
  // 63 of the 72 pack levels have no authored table, so their new rank can only
  // come from the stored cutoffs either side of it.
  check(
    "a configured level with no authored table interpolates the new rank",
    (() => {
      const cfg: Record<string, RankInfo> = {};
      for (const r of RANK_ORDER.filter((id) => id !== "Grandmaster")) {
        cfg[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
      }
      for (const [r, t] of Object.entries({
        Champion: 20,
        Elite: 20.5,
        Legend: 21,
        Expert: 22,
        Master: 23,
        Pro: 25,
        Skilled: 28,
        Average: 32,
        Beginner: 40,
      })) {
        cfg[r].timeCutoff = t;
      }
      const out = resolveLevelRanks("NOT_IN_AUTHORED_TABLE", cfg, DEFAULT_RANKS, RANK_ORDER);
      const gm = out.Grandmaster.timeCutoff;
      return gm > out.Champion.timeCutoff && gm < out.Elite.timeCutoff;
    })(),
    "Grandmaster must land between the level's own Champion and Elite",
  );
  // The live Diamond Rally ladder (stored Champion 16.210, Elite 16.694) is
  // absolute and disagrees with the hand-authored table (13.05/13.10), so the
  // new rank must be blended from the *stored* neighbours. Using the authored
  // default here produced 16.211 (clamped onto Champion), not the midpoint.
  check(
    "the new rank blends the level's real ladder, not the authored table",
    (() => {
      const cfg: Record<string, RankInfo> = {};
      for (const r of RANK_ORDER.filter((id) => id !== "Grandmaster")) {
        cfg[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
      }
      cfg.Champion.timeCutoff = 16.21;
      cfg.Elite.timeCutoff = 16.694;
      cfg.Legend.timeCutoff = 17.258;
      const gm = resolveLevelRanks("801170f9", cfg, DEFAULT_RANKS, RANK_ORDER).Grandmaster
        .timeCutoff;
      return gm > 16.3 && gm < 16.6;
    })(),
    "expected ~16.45 between Champion 16.21 and Elite 16.694",
  );
  // Drifting Stars: authored at ~14.2s WR (Champion 14.454) but now run in
  // 13.254, so the stored Champion had drifted to 1.09x the WR and let 27 of
  // 100 runs through. The board-derived cap pulls it back in.
  check(
    "a stale stored Champion is capped by the level's current board",
    (() => {
      const wr = 13.254;
      const board: LeaderboardEntry[] = Array.from({ length: 100 }, (_, i) => ({
        username: `p${i}`,
        completion_time: wr + i * 0.03,
        arrow_name: "narrow arrow",
      }));
      const cfg: Record<string, RankInfo> = {};
      for (const r of RANK_ORDER) cfg[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
      cfg.Champion.timeCutoff = 14.454;
      cfg.Elite.timeCutoff = 14.9;
      cfg.Legend.timeCutoff = 15.404;
      const out = resolveLevelRanks("E66F7D98", cfg, DEFAULT_RANKS, RANK_ORDER, board);
      // Champion must come down to the derived strict cutoff, not stay at 14.454.
      return out.Champion.timeCutoff < 14.0 && out.Champion.timeCutoff > wr;
    })(),
    "Champion should tighten toward WR x 1.015 once the board is known",
  );
  check(
    "a stored cutoff is left alone when the board has too few runs to judge",
    (() => {
      const cfg: Record<string, RankInfo> = {};
      for (const r of RANK_ORDER) cfg[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
      cfg.Champion.timeCutoff = 14.454;
      const thin: LeaderboardEntry[] = [
        { username: "a", completion_time: 13.254, arrow_name: "narrow arrow" },
        { username: "b", completion_time: 13.9, arrow_name: "narrow arrow" },
      ];
      const out = resolveLevelRanks("E66F7D98", cfg, DEFAULT_RANKS, RANK_ORDER, thin);
      return Math.abs(out.Champion.timeCutoff - 14.454) < 1e-9;
    })(),
    "a two-run board must not rewrite the authored Champion",
  );
  check(
    "the cap never loosens a level that is already stricter than derived",
    (() => {
      const wr = 13.254;
      const board: LeaderboardEntry[] = Array.from({ length: 100 }, (_, i) => ({
        username: `p${i}`,
        completion_time: wr + i * 0.03,
        arrow_name: "narrow arrow",
      }));
      const cfg: Record<string, RankInfo> = {};
      for (const r of RANK_ORDER) cfg[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
      cfg.Champion.timeCutoff = 13.30; // tighter than derived
      cfg.Elite.timeCutoff = 14.9;
      const out = resolveLevelRanks("E66F7D98", cfg, DEFAULT_RANKS, RANK_ORDER, board);
      return Math.abs(out.Champion.timeCutoff - 13.3) < 1e-9;
    })(),
    "the cap is a min(), so a tighter stored cutoff survives",
  );
  check(
    "the casual ranks are never capped by the board",
    (() => {
      const wr = 13.254;
      const board: LeaderboardEntry[] = Array.from({ length: 100 }, (_, i) => ({
        username: `p${i}`,
        completion_time: wr + i * 0.03,
        arrow_name: "narrow arrow",
      }));
      const cfg: Record<string, RankInfo> = {};
      for (const r of RANK_ORDER) cfg[r] = { ...DEFAULT_RANKS[r], timeCutoff: 0 };
      cfg.Champion.timeCutoff = 14.454;
      cfg.Elite.timeCutoff = 14.9;
      cfg.Pro.timeCutoff = 18.427; // deliberately generous
      cfg.Skilled.timeCutoff = 20.442;
      const out = resolveLevelRanks("E66F7D98", cfg, DEFAULT_RANKS, RANK_ORDER, board);
      return out.Pro.timeCutoff === 18.427 && out.Skilled.timeCutoff === 20.442 && out.Elite.timeCutoff === 14.9;
    })(),
    "Pro/Skilled are meant to be attainable and keep their authored times; Elite is not capped either",
  );
  check(
    "an unconfigured level still resolves every rank to 0",
    RANK_ORDER.every(
      (r) => resolveLevelRanks("NOPE", undefined, DEFAULT_RANKS, RANK_ORDER)[r].timeCutoff === 0,
    ),
  );
}

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed > 0) process.exit(1);
