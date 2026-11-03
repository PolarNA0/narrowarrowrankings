/**
 * Checks the pure logic behind the "Unbeaten authors" view.
 *
 * Run: npx tsx scripts/verify-unbeaten-authors.ts
 *
 * The interesting behaviour is all in `src/lib/unbeaten-authors.ts`: a community
 * level's `medals.topTime` is the author's own time, and the level is unbeaten
 * while no recorded run has gone under it. Official pack levels carry no
 * author-time signal and must be excluded. The checks drive it with hand-made
 * feed entries, so no upstream request is made.
 */
import {
  authorTimeOf,
  buildBeatenAuthorRows,
  buildUnbeatenAuthorRows,
  isAuthorUnbeaten,
  MIN_RECORD_SECONDS,
  sortUnbeatenAuthorRows,
  summariseUnbeatenAuthors,
  tallyBeaters,
  tallyUnbeatenAuthors,
  UNBEATEN_TOLERANCE,
  type CustomLevelEntry,
} from "@/lib/unbeaten-authors";
import { SWEEP_INTERVAL_MS, sweepDue } from "@/lib/custom-levels.server";

let failures = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra === undefined ? "" : `  ${extra}`}`);
  if (!ok) failures++;
};

/** A community level whose author time is 10s and whose best run ties it. */
function level(over: Partial<CustomLevelEntry> = {}): CustomLevelEntry {
  return {
    level_id: "AAAA1111",
    name: "A Level",
    creator_name: "Polar",
    like_count: 3,
    play_count: 100,
    created_at: "2026-01-01T00:00:00.000Z",
    pack: null,
    world_record: { completion_time: 10, username: "Polar", arrow_name: "Narrow Arrow" },
    medals: { topTime: 10, finisherCount: 50 },
    ...over,
  };
}

// --- authorTimeOf ----------------------------------------------------------
check("a community level's topTime is the author time", authorTimeOf(level()) === 10);
check(
  "an official pack level has no author time",
  authorTimeOf(level({ pack: { slug: "official-pack", name: "Official Pack" } })) === null,
);
check("a level with no medals has no author time", authorTimeOf(level({ medals: null })) === null);
check(
  "a missing topTime is not an author time",
  authorTimeOf(level({ medals: { finisherCount: 5 } })) === null,
);
check(
  "a joke-level topTime is dropped",
  authorTimeOf(level({ medals: { topTime: MIN_RECORD_SECONDS / 2, finisherCount: 5 } })) === null,
);
check(
  "a topTime exactly on the floor is kept",
  authorTimeOf(level({ medals: { topTime: MIN_RECORD_SECONDS, finisherCount: 5 } })) ===
    MIN_RECORD_SECONDS,
);

// --- isAuthorUnbeaten ------------------------------------------------------
check("a tied best run leaves the author unbeaten", isAuthorUnbeaten(level()));
check(
  "a slower best run leaves the author unbeaten",
  isAuthorUnbeaten(level({ world_record: { completion_time: 12, username: "Rival" } })),
);
check(
  "a faster best run beats the author",
  !isAuthorUnbeaten(level({ world_record: { completion_time: 9, username: "Rival" } })),
);
check(
  "a run inside the tolerance still counts as a tie",
  isAuthorUnbeaten(
    level({ world_record: { completion_time: 10 - UNBEATEN_TOLERANCE, username: "Rival" } }),
  ),
);
check(
  "a run just past the tolerance beats the author",
  !isAuthorUnbeaten(
    level({ world_record: { completion_time: 10 - UNBEATEN_TOLERANCE * 2, username: "Rival" } }),
  ),
);
check("no recorded run is not unbeaten", !isAuthorUnbeaten(level({ world_record: null })));
check(
  "no recorded run time is not unbeaten",
  !isAuthorUnbeaten(level({ world_record: { username: "Polar" } })),
);
check(
  "an official level is never unbeaten",
  !isAuthorUnbeaten(level({ pack: { slug: "official-pack", name: "Official Pack" } })),
);

// --- buildUnbeatenAuthorRows ----------------------------------------------
const feed: CustomLevelEntry[] = [
  level({ level_id: "UNBEATEN", name: "Unbeaten", play_count: 20 }),
  level({
    level_id: "TAKEN",
    name: "Taken",
    medals: { topTime: 10, finisherCount: 50 },
    world_record: { completion_time: 8, username: "Rival", arrow_name: "Energy Arrow" },
  }),
  level({
    level_id: "OFF",
    name: "Official",
    pack: { slug: "official-pack", name: "Official Pack" },
    play_count: 500,
  }),
  level({
    level_id: "SPEEDY",
    name: "Speedy Unbeaten",
    play_count: 30,
    medals: { topTime: 6, finisherCount: 40 },
    world_record: { completion_time: 6, username: "Polar", arrow_name: "Speedy Arrow" },
  }),
  level({ level_id: "QUIET", name: "Quiet", play_count: 2 }),
  level({ level_id: "NOMEDALS", name: "No Medals", medals: null }),
];

const rows = buildUnbeatenAuthorRows(feed);
check(
  "community unbeaten records are kept",
  rows.length === 3,
  rows.map((r) => r.levelId).join(","),
);
check("the official level is excluded", !rows.some((r) => r.levelId === "OFF"));
check("the taken record is excluded", !rows.some((r) => r.levelId === "TAKEN"));
check("a level with no medal data is excluded", !rows.some((r) => r.levelId === "NOMEDALS"));
check(
  "the row carries the author time and the best time",
  rows.some((r) => r.levelId === "UNBEATEN" && r.authorTime === 10 && r.bestTime === 10),
);
check(
  "a tied record reads as the author holding it",
  rows.some((r) => r.levelId === "UNBEATEN" && r.authorHoldsRecord && r.gap === 0),
);
check(
  "a slower best run records the gap the author still holds",
  buildUnbeatenAuthorRows([level({ world_record: { completion_time: 12, username: "Rival" } })])[0]
    .gap === 2,
);
check(
  "a slower best run is not flagged as the author holding the record",
  !buildUnbeatenAuthorRows([level({ world_record: { completion_time: 12, username: "Rival" } })])[0]
    .authorHoldsRecord,
);
check(
  "the arrow filter narrows the rows",
  buildUnbeatenAuthorRows(feed, { arrow: "speedy" }).every((r) => r.levelId === "SPEEDY"),
);
check(
  "the arrow filter keeps the matching row",
  buildUnbeatenAuthorRows(feed, { arrow: "speedy" }).length === 1,
);
check(
  "the arrow filter matches loosely-spelled arrow names",
  buildUnbeatenAuthorRows(
    [level({ world_record: { completion_time: 10, username: "Polar", arrow_name: "narrow" } })],
    { arrow: "narrow" },
  ).length === 1,
);
check(
  "minPlays drops the quiet level",
  !buildUnbeatenAuthorRows(feed, { minPlays: 10 }).some((r) => r.levelId === "QUIET"),
);
check(
  "minPlays keeps the busy levels",
  buildUnbeatenAuthorRows(feed, { minPlays: 10 }).length === 2,
);
check(
  "minPlays is inclusive of the threshold",
  buildUnbeatenAuthorRows(feed, { minPlays: 20 }).some((r) => r.levelId === "UNBEATEN"),
);
check("an empty feed builds no rows", buildUnbeatenAuthorRows([]).length === 0);
check(
  "a repeated level yields a row per entry (the snapshot dedupes)",
  buildUnbeatenAuthorRows([level(), level()]).length === 2,
);

// --- sortUnbeatenAuthorRows ------------------------------------------------
const sortable = [
  level({ level_id: "A", name: "Alpha", play_count: 5 }),
  level({
    level_id: "B",
    name: "Bravo",
    play_count: 90,
    medals: { topTime: 20, finisherCount: 10 },
    world_record: { completion_time: 20, username: "Polar", arrow_name: "Narrow Arrow" },
  }),
  level({
    level_id: "C",
    name: "Charlie",
    play_count: 40,
    created_at: "2026-06-01T00:00:00.000Z",
    creator_name: "Ann",
    medals: { topTime: 30, finisherCount: 10 },
    world_record: { completion_time: 45, username: "Rival", arrow_name: "Narrow Arrow" },
  }),
];
const order = (by: Parameters<typeof sortUnbeatenAuthorRows>[1]) =>
  sortUnbeatenAuthorRows(buildUnbeatenAuthorRows(sortable), by)
    .map((r) => r.levelId)
    .join(",");
check("plays sort puts the most-played first", order("plays") === "B,C,A", order("plays"));
check("gap sort puts the widest surviving margin first", order("gap") === "C,A,B", order("gap"));
check("time sort puts the fastest author time first", order("time") === "A,B,C", order("time"));
check("recent sort puts the newest first", order("recent") === "C,A,B", order("recent"));
check("author sort groups by author name", order("author") === "C,A,B", order("author"));
check(
  "sorting does not mutate the input",
  (() => {
    const input = buildUnbeatenAuthorRows(sortable);
    const before = input.map((r) => r.levelId).join(",");
    sortUnbeatenAuthorRows(input, "gap");
    return input.map((r) => r.levelId).join(",") === before;
  })(),
);
check(
  "an equal-time tie breaks on level name",
  (() => {
    const tied = buildUnbeatenAuthorRows([
      level({ level_id: "Z", name: "Zeta" }),
      level({ level_id: "A", name: "Alpha" }),
    ]);
    return sortUnbeatenAuthorRows(tied, "time")[0].levelId === "A";
  })(),
);

// --- summariseUnbeatenAuthors ---------------------------------------------
const summary = summariseUnbeatenAuthors(rows);
check("the summary counts the levels", summary.levels === 3, summary.levels);
check("the summary counts the authors", summary.authors === 1, summary.authors);
check("the summary sums plays", summary.plays === 52, summary.plays);
check("the summary finds the fastest author time", summary.fastest === 6, summary.fastest);
check("the summary finds the closest surviving margin", summary.closest === 0, summary.closest);
check(
  "the summary counts distinct authors",
  summariseUnbeatenAuthors(
    buildUnbeatenAuthorRows([
      level({ level_id: "A", creator_name: "Polar" }),
      level({ level_id: "B", creator_name: "polar " }),
      level({ level_id: "C", creator_name: "Ann" }),
    ]),
  ).authors === 2,
);
check("an empty summary has no fastest time", summariseUnbeatenAuthors([]).fastest === null);
check("an empty summary has no closest margin", summariseUnbeatenAuthors([]).closest === null);
check("an empty summary counts zero levels", summariseUnbeatenAuthors([]).levels === 0);

// --- tallyUnbeatenAuthors --------------------------------------------------
const tally = tallyUnbeatenAuthors(
  buildUnbeatenAuthorRows([
    level({ level_id: "P1", creator_name: "Polar", play_count: 40 }),
    level({ level_id: "P2", creator_name: "polar ", play_count: 5 }),
    level({ level_id: "S1", creator_name: "SK", play_count: 100 }),
  ]),
);
check(
  "the tally ranks by unbeaten count",
  tally.map((t) => t.author).join(",") === "Polar,SK",
  JSON.stringify(tally),
);
check("the tally counts Polar's two levels", tally[0].defended === 2, tally[0].defended);
check("the tally records the most-played level", tally[0].topPlays === 40, tally[0].topPlays);
check(
  "the tally includes the second author",
  tally.some((t) => t.author === "SK"),
);
check("the tally folds case variants into one author", tally.length === 2, tally.length);
check("an empty tally has no authors", tallyUnbeatenAuthors([]).length === 0);

// --- sweep cost control ----------------------------------------------------
// The whole point of the 4h window is that visitor traffic cannot drive upstream
// cost, so pin the gate itself: a fresh completed sweep must not be due.
const now = Date.now();
const completed = (ageMs: number) => ({
  levels: {},
  cursor: { popular: 101, new: 101, discover: 101 },
  done: true,
  at: now - ageMs,
  startedAt: now - ageMs,
});
check("a fresh completed sweep is not due", !sweepDue(completed(60 * 1000)));
check(
  "a completed sweep just inside the window is not due",
  !sweepDue(completed(SWEEP_INTERVAL_MS - 60 * 1000)),
);
check(
  "a completed sweep past the window is due",
  sweepDue(completed(SWEEP_INTERVAL_MS + 60 * 1000)),
);
check("a never-swept snapshot is due", sweepDue(null));
check(
  "an unfinished sweep is always due",
  sweepDue({ levels: {}, cursor: {}, done: false, at: now, startedAt: now }),
);
check("the window is a day", SWEEP_INTERVAL_MS === 24 * 60 * 60 * 1000, SWEEP_INTERVAL_MS);

// --- beaten authors --------------------------------------------------------
// A level is beaten while the best run has gone under the author's time. This is
// the complement of `isAuthorUnbeaten`, and the two must partition the levels
// that carry an author time — a level cannot be both, nor neither.
const beatenLevel = (best: number) =>
  level({
    level_id: "BEAT1",
    world_record: { completion_time: best, username: "Rival", arrow_name: "Speedy Arrow" },
  });
const beaten = buildBeatenAuthorRows([beatenLevel(9.5)]);
check("a run under the author time is a beating", beaten.length === 1, beaten.length);
check("the beating records who did it", beaten[0]?.beater === "Rival", beaten[0]?.beater);
check("the beating records the margin", Math.abs((beaten[0]?.beatBy ?? 0) - 0.5) < 1e-9);
check("a tie is not a beating", buildBeatenAuthorRows([beatenLevel(10)]).length === 0);
check(
  "a tie within tolerance is not a beating",
  buildBeatenAuthorRows([beatenLevel(10 - UNBEATEN_TOLERANCE / 2)]).length === 0,
);
check(
  "a run over the author time is not a beating",
  buildBeatenAuthorRows([beatenLevel(11)]).length === 0,
);
check(
  "an official pack level is never a beating",
  buildBeatenAuthorRows([
    level({
      pack: { slug: "core" },
      world_record: { completion_time: 5, username: "X", arrow_name: "Narrow Arrow" },
    }),
  ]).length === 0,
);
check(
  "a joke-level time is never a beating",
  buildBeatenAuthorRows([beatenLevel(0.5)]).length === 0,
);
check(
  "the unbeaten and beaten sets partition the levels with an author time",
  (() => {
    const entries = [level({ level_id: "A" }), beatenLevel(9), beatenLevel(11)];
    const unbeaten = buildUnbeatenAuthorRows(entries).length;
    const beat = buildBeatenAuthorRows(entries).length;
    const withAuthorTime = entries.filter((e) => authorTimeOf(e) !== null && e.world_record).length;
    return unbeaten + beat === withAuthorTime;
  })(),
);

// The arrow filter must narrow the beaten list the same way it narrows the
// unbeaten one, or the two tabs would disagree about the same level.
check(
  "the arrow filter applies to beaten rows",
  buildBeatenAuthorRows([beatenLevel(9)], { arrow: "narrow" }).length === 0,
);
check(
  "the matching arrow keeps the beaten row",
  buildBeatenAuthorRows([beatenLevel(9)], { arrow: "speedy" }).length === 1,
);
check(
  "the min-plays filter applies to beaten rows",
  buildBeatenAuthorRows([beatenLevel(9)], { minPlays: 500 }).length === 0,
);

// --- beater tally ----------------------------------------------------------
const beaters = tallyBeaters(
  buildBeatenAuthorRows([
    beatenLevel(9),
    level({
      level_id: "BEAT2",
      world_record: { completion_time: 8, username: "Rival", arrow_name: "Narrow Arrow" },
    }),
    level({
      level_id: "BEAT3",
      world_record: { completion_time: 9.9, username: "Other", arrow_name: "Energy Arrow" },
    }),
  ]),
);
check("the beater tally ranks by beatings", beaters[0]?.beater === "Rival", beaters[0]?.beater);
check("the top beater's count is right", beaters[0]?.beaten === 2, beaters[0]?.beaten);
check("the tally records the widest margin", Math.abs((beaters[0]?.bestMargin ?? 0) - 2) < 1e-9);
check(
  "the tally records the fastest author time taken",
  Math.abs((beaters[0]?.fastestTaken ?? 0) - 10) < 1e-9,
  beaters[0]?.fastestTaken,
);
check("every beater appears once", beaters.length === 2, beaters.length);
check("an empty beating set has no beaters", tallyBeaters([]).length === 0);

console.log(failures === 0 ? "\nall unbeaten-author checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
