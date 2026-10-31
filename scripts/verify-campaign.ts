/**
 * Verify campaign scoring.
 *
 * Run: npx tsx scripts/verify-campaign.ts
 *
 * The rule under test is the brief's own example: a good placement on a weak
 * time must NOT score well ("2nd but 0.5s away shouldn't get lots of points"),
 * while a fast time with a poor placement must. Position is a tie-breaker, not
 * a reward.
 */
import {
  buildCampaignStandings,
  buildClassStandings,
  campaignLevelPoints,
  campaignStatus,
  rankClassRows,
  CAMPAIGN_MAX_POINTS,
  MAX_POSITION_PENALTY,
  type Campaign,
} from "@/lib/campaign";
import type { LeaderboardEntry } from "@/types";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`OK   ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function entry(username: string, time: number, arrow = "Narrow Arrow"): LeaderboardEntry {
  return {
    run_id: Math.floor(Math.random() * 1e9),
    completion_time: time,
    username,
    arrow_name: arrow,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

// ---- The brief's example -------------------------------------------------
{
  const wr = 10;
  const winner = campaignLevelPoints(10, wr, 1);
  const second = campaignLevelPoints(10.5, wr, 2); // 5% off, 2nd
  const secondTight = campaignLevelPoints(10.01, wr, 2); // 0.1% off, 2nd

  check("the WR scores the full 1000", winner === CAMPAIGN_MAX_POINTS, `${winner}`);
  check(
    "2nd but 0.5s away does NOT get lots of points",
    second < CAMPAIGN_MAX_POINTS * 0.6,
    `${second} (${((second / CAMPAIGN_MAX_POINTS) * 100).toFixed(0)}%)`,
  );
  check(
    "2nd a hundredth off DOES score well",
    secondTight > CAMPAIGN_MAX_POINTS * 0.9,
    `${secondTight}`,
  );
  check("a tight time beats a loose one at the same position", secondTight > second);
}

// ---- Position is a modifier, never a rescue ------------------------------
{
  const wr = 10;
  // A slow run cannot be rescued by finishing high...
  const slowFirst = campaignLevelPoints(10.6, wr, 1);
  const fastTenth = campaignLevelPoints(10.05, wr, 10);
  check(
    "a fast run further down beats a slow run in 1st",
    fastTenth > slowFirst,
    `P10@10.05=${fastTenth} vs P1@10.60=${slowFirst}`,
  );

  // ...and the whole position penalty is bounded. Both scores are rounded to
  // whole points, so allow the rounding slack (half a point on each side)
  // before calling the bound violated.
  const atOne = campaignLevelPoints(11, wr, 1);
  const atHundred = campaignLevelPoints(11, wr, 100);
  const loss = (atOne - atHundred) / atOne;
  const roundingSlack = 0.5 / atOne + 0.5 / atHundred;
  check(
    "position alone can cost at most MAX_POSITION_PENALTY",
    loss <= MAX_POSITION_PENALTY + roundingSlack,
    `${(loss * 100).toFixed(1)}% <= ${(MAX_POSITION_PENALTY * 100).toFixed(0)}% (+rounding)`,
  );

  check("points never exceed the cap", campaignLevelPoints(10.0001, wr, 1) <= CAMPAIGN_MAX_POINTS);
  check("points never go negative", campaignLevelPoints(999, wr, 5000) >= 0);
  check("a non-positive time scores nothing", campaignLevelPoints(0, wr, 1) === 0);
  check("a non-finite time scores nothing", campaignLevelPoints(NaN, wr, 1) === 0);
}

// ---- Monotonicity: faster is never worse ---------------------------------
{
  const wr = 10;
  let ok = true;
  for (let t = 10; t < 14; t += 0.05) {
    if (campaignLevelPoints(t, wr, 3) < campaignLevelPoints(t + 0.05, wr, 3)) ok = false;
  }
  check("score is monotonic in time at a fixed position", ok);

  let posOk = true;
  for (let p = 1; p < 50; p += 1) {
    if (campaignLevelPoints(10.5, wr, p) < campaignLevelPoints(10.5, wr, p + 1)) posOk = false;
  }
  check("score is monotonic in position at a fixed time", posOk);
}

// ---- Status --------------------------------------------------------------
{
  const campaign = {
    id: "c1",
    name: "Test",
    startsAt: 1000,
    endsAt: 2000,
    levels: [],
    classes: [],
  } as Campaign;
  check("before the window is upcoming", campaignStatus(campaign, 500) === "upcoming");
  check("inside the window is live", campaignStatus(campaign, 1500) === "live");
  check("after the window is ended", campaignStatus(campaign, 2500) === "ended");
  check("the start instant is live", campaignStatus(campaign, 1000) === "live");
  check("the end instant is live", campaignStatus(campaign, 2000) === "live");
}

// ---- Standings: best arrow, all levels counted ---------------------------
{
  const campaign: Campaign = {
    id: "c1",
    name: "Test",
    startsAt: 0,
    endsAt: 1e12,
    classes: [
      { id: "a", name: "Alpha", color: "#fff" },
      { id: "b", name: "Beta", color: "#000" },
    ],
    levels: [
      { id: "L1", name: "One", classId: "a" },
      { id: "L2", name: "Two", classId: "b" },
    ],
  };

  const data: Record<string, LeaderboardEntry[]> = {
    // Polar WR 10.00; Slow 12.00.
    L1: [entry("Polar", 10.0), entry("Slow", 12.0)],
    // Only Polar ran L2 — Slow skipped it entirely.
    L2: [entry("Polar", 20.0)],
  };

  const rows = buildCampaignStandings(campaign, data);
  const polar = rows.find((r) => r.username === "Polar")!;
  const slow = rows.find((r) => r.username === "Slow")!;

  check("every campaign level is counted", polar.maxPoints === 2 * CAMPAIGN_MAX_POINTS);
  check(
    "a perfect run on both levels is the max",
    polar.points === polar.maxPoints,
    `${polar.points}`,
  );
  check("skipping a level is not re-scaled", slow.levelCount === 2 && slow.levelsPlayed === 1);
  check("the skipper scores only what they ran", slow.points > 0 && slow.points < slow.maxPoints);
  check("standings are ordered by points", rows[0].username === "Polar", rows[0].username);
  check("levelsPlayed tracks distinct levels", polar.levelsPlayed === 2);
  check("bestFinish is the best placement", polar.bestFinish === 1);
  check(
    "totalTime sums the scoring runs",
    Math.abs(polar.totalTime - 30) < 1e-9,
    `${polar.totalTime}`,
  );

  // Best arrow: a player's fastest run counts, whichever arrow it used.
  const multi: Record<string, LeaderboardEntry[]> = {
    L1: [
      entry("Ann", 10.0, "Narrow Arrow"),
      entry("Ann", 10.4, "Speedy Arrow"),
      entry("Ann", 11.0, "Energy Arrow"),
      entry("Bob", 10.2, "Speedy Arrow"),
    ],
  };
  const oneLevel: Campaign = { ...campaign, levels: [{ id: "L1", name: "One", classId: "a" }] };
  const multiRows = buildCampaignStandings(oneLevel, multi);
  const ann = multiRows.find((r) => r.username === "Ann")!;
  check(
    "only the fastest arrow counts per level",
    ann.levels.length === 1 && ann.levels[0].time === 10.0,
    `${ann.levels.length} row(s), time ${ann.levels[0].time}`,
  );
  check("the fastest-arrow run is the one scored", ann.points === CAMPAIGN_MAX_POINTS);
  check("a single-arrow player is compared fairly", multiRows[0].username === "Ann");
}

// ---- Ties -----------------------------------------------------------------
{
  const campaign: Campaign = {
    id: "c1",
    name: "T",
    startsAt: 0,
    endsAt: 1e12,
    classes: [{ id: "a", name: "A", color: "#fff" }],
    levels: [{ id: "L1", name: "One", classId: "a" }],
  };
  const data: Record<string, LeaderboardEntry[]> = {
    L1: [entry("A", 10.0), entry("B", 10.0), entry("C", 10.5)],
  };
  const rows = buildCampaignStandings(campaign, data);
  const a = rows.find((r) => r.username === "A")!;
  const b = rows.find((r) => r.username === "B")!;
  const c = rows.find((r) => r.username === "C")!;
  check(
    "equal times share the better position",
    a.levels[0].position === 1 && b.levels[0].position === 1,
  );
  check("equal times score equally", a.points === b.points);
  check(
    "the next distinct time is position 3, not 2",
    c.levels[0].position === 3,
    `${c.levels[0].position}`,
  );
  check("equal points break on total time, then name", rows.length === 3);
}

// ---- Class standings -----------------------------------------------------
{
  const campaign: Campaign = {
    id: "c1",
    name: "T",
    startsAt: 0,
    endsAt: 1e12,
    classes: [
      { id: "a", name: "Alpha", color: "#fff" },
      { id: "b", name: "Beta", color: "#000" },
    ],
    levels: [
      { id: "L1", name: "One", classId: "a" },
      { id: "L2", name: "Two", classId: "b" },
    ],
  };
  const data: Record<string, LeaderboardEntry[]> = {
    L1: [entry("Polar", 10.0), entry("Slow", 12.0)],
    L2: [entry("Slow", 20.0)],
  };
  const standings = buildCampaignStandings(campaign, data);
  const byClass = buildClassStandings(campaign, standings);

  const alpha = byClass.get("a")!;
  const beta = byClass.get("b")!;
  check("each class only counts its own levels", alpha.length === 2 && beta.length === 1);
  check("a class max is its own level count", alpha[0].maxPoints === CAMPAIGN_MAX_POINTS);
  check("Polar leads Alpha", alpha[0].username === "Polar");
  check("Slow alone leads Beta", beta[0].username === "Slow");
  check(
    "a player missing from a class is absent from it",
    !beta.some((r) => r.username === "Polar"),
  );

  const ranked = rankClassRows(alpha);
  check("class ranks are 1-based", ranked[0].rank === 1 && ranked[1].rank === 2);

  // Tied points share a rank.
  const tied = rankClassRows([
    { ...alpha[0], points: 500, username: "X" },
    { ...alpha[0], points: 500, username: "Y" },
    { ...alpha[0], points: 100, username: "Z" },
  ]);
  check("tied class points share a rank", tied[0].rank === 1 && tied[1].rank === 1);
  check("the rank after a tie skips", tied[2].rank === 3, `${tied[2].rank}`);
}

// ---- Empty input ---------------------------------------------------------
{
  const campaign: Campaign = {
    id: "c1",
    name: "T",
    startsAt: 0,
    endsAt: 1e12,
    classes: [],
    levels: [{ id: "L1", name: "One", classId: "a" }],
  };
  check("an empty board produces no standings", buildCampaignStandings(campaign, {}).length === 0);
  check(
    "a level nobody ran produces no standings",
    buildCampaignStandings(campaign, { L1: [] }).length === 0,
  );
}

// ---- Storage: parse rules, freeze, and the real store ---------------------
{
  const {
    parseCampaign,
    saveCampaign,
    readCampaign,
    listCampaigns,
    deleteCampaign,
    __resetCampaignMemory,
  } = await import("@/lib/campaign.server");

  const base = {
    id: "spring-2026",
    name: "Spring Campaign",
    startsAt: 1_000,
    endsAt: 2_000,
    classes: [{ id: "a", name: "Alpha", color: "#fff" }],
    levels: [{ id: "L1", name: "One", classId: "a" }],
  };

  check("a well-formed campaign parses", !("error" in parseCampaign(base)));
  check("an empty level list is rejected", "error" in parseCampaign({ ...base, levels: [] }));
  check("an empty class list is rejected", "error" in parseCampaign({ ...base, classes: [] }));
  check(
    "a level in an unknown class is rejected",
    "error" in parseCampaign({ ...base, levels: [{ id: "L1", name: "One", classId: "zzz" }] }),
  );
  check(
    "a duplicate level is rejected",
    "error" in
      parseCampaign({
        ...base,
        levels: [
          { id: "L1", name: "One", classId: "a" },
          { id: "L1", name: "One again", classId: "a" },
        ],
      }),
  );
  check("end before start is rejected", "error" in parseCampaign({ ...base, endsAt: 500 }));
  check("a bad id is rejected", "error" in parseCampaign({ ...base, id: "x" }));
  check("a missing name is rejected", "error" in parseCampaign({ ...base, name: "" }));

  // Round-trip through the real store (in-memory fallback in dev).
  __resetCampaignMemory();
  const parsed = parseCampaign(base);
  if (!("error" in parsed)) {
    await saveCampaign(parsed);
    const read = await readCampaign("spring-2026");
    check("a saved campaign reads back", read?.name === "Spring Campaign");
    check(
      "the index lists it",
      (await listCampaigns()).some((c) => c.id === "spring-2026"),
    );
    check("a fresh campaign is not frozen", read?.frozenAt === null);

    // Freezing stores the snapshot and survives a later save.
    await saveCampaign({ ...read!, frozenAt: 12345, standings: [] });
    await saveCampaign({ ...read!, name: "Renamed", frozenAt: null, standings: undefined });
    const after = await readCampaign("spring-2026");
    check("a freeze is not undone by a later save", after?.frozenAt === 12345);
    check("the frozen snapshot survives a rename", Array.isArray(after?.standings));

    await deleteCampaign("spring-2026");
    check("a deleted campaign is gone", (await readCampaign("spring-2026")) === null);
  }

  // The standings memo is a cache, not a store: it must never resurrect a
  // deleted campaign or leak between ids.
  const { readStandingsMemo, writeStandingsMemo, clearStandingsMemo } =
    await import("@/lib/campaign.server");
  const row = {
    username: "Polar",
    points: 10,
    levelsPlayed: 1,
    levelsTotal: 1,
    totalTime: 1,
    classPoints: {},
    rank: 1,
  };
  writeStandingsMemo("memo-a", [row as never]);
  check("a written memo reads back", readStandingsMemo("memo-a")?.length === 1);
  check("a memo is per id", readStandingsMemo("memo-b") === null);
  clearStandingsMemo("memo-a");
  check("a cleared memo is gone", readStandingsMemo("memo-a") === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
