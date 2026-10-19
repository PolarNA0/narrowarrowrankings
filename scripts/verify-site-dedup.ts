/**
 * A player must appear at most once on a site level's board: only their best
 * run is kept, and a copied input string cannot clone a row. Existing boards
 * may already hold duplicates, so the fold runs on read too.
 */
import {
  collapseSiteEntries,
  isPersonalBest,
  sortSiteScores,
  type SiteScoreEntry,
} from "@/lib/site-scores.server";

let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures++;
};

const entry = (over: Partial<SiteScoreEntry>): SiteScoreEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  username: over.username ?? "player",
  timeMs: over.timeMs ?? 10_000,
  arrowName: over.arrowName ?? "Narrow Arrow",
  inputCount: over.inputCount ?? 10,
  inputs: over.inputs ?? `inputs-${Math.random().toString(36).slice(2)}`,
  createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
});

// --- Two runs by the same name: only the faster survives. --------------------
const sameName = [
  entry({ username: "Ash", timeMs: 12_000, inputs: "aaa" }),
  entry({ username: "Ash", timeMs: 9_000, inputs: "bbb" }),
  entry({ username: "Ash", timeMs: 11_000, inputs: "ccc" }),
];
const folded = collapseSiteEntries(sameName);
check("same name folds to one row", folded.length === 1);
check("the kept row is the fastest", folded[0].timeMs === 9_000 && folded[0].inputs === "bbb");

// --- Case/whitespace must not create a second identity. ----------------------
const messy = [
  entry({ username: "Ash", timeMs: 9_000, inputs: "a1" }),
  entry({ username: " ash ", timeMs: 8_000, inputs: "a2" }),
  entry({ username: "ASH", timeMs: 7_000, inputs: "a3" }),
];
check("case/space variants fold together", collapseSiteEntries(messy).length === 1);

// --- Different names are separate rows, ordered by time. ---------------------
const mixed = [
  entry({ username: "Ash", timeMs: 9_000, inputs: "x1" }),
  entry({ username: "Bo", timeMs: 4_000, inputs: "x2" }),
  entry({ username: "Cy", timeMs: 6_000, inputs: "x3" }),
];
const mixedFolded = collapseSiteEntries(mixed);
check("distinct names stay distinct", mixedFolded.length === 3);
check(
  "board is sorted fastest-first",
  mixedFolded.map((e) => e.username).join(",") === "Bo,Cy,Ash",
);

// --- A copied input string cannot clone a row. ------------------------------
const copied = [
  entry({ username: "Ash", timeMs: 5_000, inputs: "WR" }),
  entry({ username: "Bo", timeMs: 5_000, inputs: "WR" }),
];
check("duplicate inputs keep one row", collapseSiteEntries(copied).length === 1);

// --- Legacy board with duplicates folds on read. ----------------------------
const legacy = [
  entry({ username: "Ash", timeMs: 12_000, inputs: "l1" }),
  entry({ username: "Ash", timeMs: 10_000, inputs: "l2" }),
  entry({ username: "Bo", timeMs: 11_000, inputs: "l3" }),
];
const legacyFolded = collapseSiteEntries(legacy);
check("legacy duplicates collapse", legacyFolded.length === 2);
check("legacy keeps Ash's best", legacyFolded.find((e) => e.username === "Ash")?.timeMs === 10_000);

// --- isPersonalBest drives the "not on the board" message. ------------------
check("a first run is a PB", isPersonalBest([], "Ash", 10_000));
check(
  "a faster run is a PB",
  isPersonalBest([entry({ username: "Ash", timeMs: 10_000 })], "Ash", 9_000),
);
check(
  "a slower run is not a PB",
  !isPersonalBest([entry({ username: "Ash", timeMs: 10_000 })], "Ash", 11_000),
);
check(
  "PB check is case-insensitive",
  !isPersonalBest([entry({ username: "Ash", timeMs: 10_000 })], "ASH", 11_000),
);
check(
  "another player's time is not my PB bar",
  isPersonalBest([entry({ username: "Bo", timeMs: 1_000 })], "Ash", 11_000),
);

// --- Sorting stays stable for equal times. ----------------------------------
const tied = [
  entry({ username: "Later", timeMs: 5_000, createdAt: "2026-02-01T00:00:00.000Z" }),
  entry({ username: "Earlier", timeMs: 5_000, createdAt: "2026-01-01T00:00:00.000Z" }),
];
check("ties break by earliest submission", sortSiteScores(tied)[0].username === "Earlier");

console.log(
  failures === 0 ? "\nall site-board dedup checks passed" : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
