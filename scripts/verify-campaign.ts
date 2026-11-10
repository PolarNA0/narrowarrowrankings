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
  applyLevelColors,
  buildCampaignStandings,
  campaignLevelPoints,
  campaignPaletteColor,
  campaignStatus,
  normalizeCampaignColor,
  CAMPAIGN_COLOR_PALETTE,
  CAMPAIGN_FALLBACK_COLOR,
  CAMPAIGN_MAX_POINTS,
  MAX_POSITION_PENALTY,
  type Campaign,
  type CampaignStanding,
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
    levels: [
      { id: "L1", name: "One", color: "#38BDF8" },
      { id: "L2", name: "Two", color: "#F472B6" },
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
  const oneLevel: Campaign = { ...campaign, levels: [{ id: "L1", name: "One", color: "#38BDF8" }] };
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
    levels: [{ id: "L1", name: "One", color: "#38BDF8" }],
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

// ---- Per-level colour ----------------------------------------------------
{
  const campaign: Campaign = {
    id: "c1",
    name: "T",
    startsAt: 0,
    endsAt: 1e12,
    levels: [
      { id: "L1", name: "One", color: "#38BDF8" },
      { id: "L2", name: "Two", color: "#F472B6" },
    ],
  };
  const data: Record<string, LeaderboardEntry[]> = {
    L1: [entry("Polar", 10.0), entry("Slow", 12.0)],
    L2: [entry("Slow", 20.0)],
  };
  const standings = buildCampaignStandings(campaign, data);
  const polar = standings.find((r) => r.username === "Polar")!;
  const slow = standings.find((r) => r.username === "Slow")!;

  check(
    "each level score carries its own colour",
    polar.levels[0].color === "#38BDF8" &&
      slow.levels.find((l) => l.levelId === "L2")?.color === "#F472B6",
  );
  check("a level score has no class id", !("classId" in polar.levels[0]));
  check("every level is still scored for the campaign total", slow.levels.length === 2);
}

// ---- Legacy snapshot re-colouring ----------------------------------------
{
  // A snapshot saved before per-level colours carries a classId and no colour.
  const legacyStanding = {
    username: "Polar",
    points: 1000,
    maxPoints: 1000,
    levelsPlayed: 1,
    levelCount: 1,
    bestFinish: 1,
    totalTime: 10,
    levels: [
      {
        levelId: "L1",
        levelName: "One",
        classId: "a",
        time: 10,
        wrTime: 10,
        position: 1,
        entrants: 1,
        points: 1000,
      },
    ],
  } as unknown as CampaignStanding;

  const recoloured = applyLevelColors(
    [legacyStanding],
    [{ id: "L1", name: "One", color: "#38bdf8" }],
  );
  const lvl = recoloured[0].levels[0];
  check("a legacy snapshot row gains its level's colour", lvl.color === "#38bdf8");
  check("the legacy classId is dropped", !("classId" in lvl));
  check(
    "the historical numbers are untouched",
    lvl.time === 10 && lvl.points === 1000 && recoloured[0].points === 1000,
  );
  // A level missing from the list still renders something rather than nothing.
  const orphan = applyLevelColors([legacyStanding], []);
  check(
    "a level no longer in the campaign still gets a colour",
    /^#[0-9a-f]{6}$/i.test(orphan[0].levels[0].color),
  );
}

// ---- Legacy read-path normalisation ---------------------------------------
{
  const { normalizeStoredCampaign } = await import("@/lib/campaign.server");
  const stored = {
    id: "0001",
    name: "Legacy",
    startsAt: 1_000,
    endsAt: 2_000,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    frozenAt: 12345,
    standings: [{ username: "P" }],
    classes: [{ id: "chaos", name: "Chaos", color: "#ff0000" }],
    levels: [{ id: "L1", name: "A01 - Race", classId: "chaos" }],
  } as unknown as Parameters<typeof normalizeStoredCampaign>[0];

  const norm = normalizeStoredCampaign(stored);
  check("a stored legacy level gets its class colour", norm.levels[0].color === "#ff0000");
  check("normalising drops the stored classes", !("classes" in norm));
  check(
    "normalising preserves the frozen snapshot",
    norm.frozenAt === 12345 && norm.standings === stored.standings,
  );
  check(
    "normalising preserves the stored timestamps",
    norm.createdAt === stored.createdAt && norm.updatedAt === stored.updatedAt,
  );
}

// ---- Colour helpers ------------------------------------------------------
{
  check("a palette colour cycles", campaignPaletteColor(0) === CAMPAIGN_COLOR_PALETTE[0]);
  check(
    "the palette wraps around",
    campaignPaletteColor(CAMPAIGN_COLOR_PALETTE.length) === CAMPAIGN_COLOR_PALETTE[0],
  );
  check("a full hex passes through", normalizeCampaignColor("#AABBCC") === "#aabbcc");
  check("a short hex expands", normalizeCampaignColor("#abc") === "#aabbcc");
  check("a bare hex gains its hash", normalizeCampaignColor("aabbcc") === "#aabbcc");
  check("an empty colour falls back", normalizeCampaignColor("") === CAMPAIGN_FALLBACK_COLOR);
  check("garbage falls back", normalizeCampaignColor("not-a-colour") === CAMPAIGN_FALLBACK_COLOR);
  check(
    "a missing colour falls back",
    normalizeCampaignColor(undefined) === CAMPAIGN_FALLBACK_COLOR,
  );
}

// ---- Empty input ---------------------------------------------------------
{
  const campaign: Campaign = {
    id: "c1",
    name: "T",
    startsAt: 0,
    endsAt: 1e12,
    levels: [{ id: "L1", name: "One", color: "#38BDF8" }],
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
    levels: [{ id: "L1", name: "One", color: "#38BDF8" }],
  };

  check("a well-formed campaign parses", !("error" in parseCampaign(base)));
  check("an empty level list is rejected", "error" in parseCampaign({ ...base, levels: [] }));
  check(
    "a duplicate level is rejected",
    "error" in
      parseCampaign({
        ...base,
        levels: [
          { id: "L1", name: "One", color: "#38BDF8" },
          { id: "L1", name: "One again", color: "#F472B6" },
        ],
      }),
  );
  check(
    "a level with no colour gets a palette colour, not a rejection",
    (() => {
      const p = parseCampaign({ ...base, levels: [{ id: "L1", name: "One" }] });
      return !("error" in p) && /^#[0-9a-f]{6}$/i.test(p.levels[0].color);
    })(),
  );
  check(
    "a level colour is normalised to lowercase hex",
    (() => {
      const p = parseCampaign({ ...base, levels: [{ id: "L1", name: "One", color: "#AABBCC" }] });
      return !("error" in p) && p.levels[0].color === "#aabbcc";
    })(),
  );
  check(
    "an unparsable colour falls back rather than rejecting",
    (() => {
      const p = parseCampaign({ ...base, levels: [{ id: "L1", name: "One", color: "nope" }] });
      return !("error" in p) && p.levels[0].color === CAMPAIGN_FALLBACK_COLOR;
    })(),
  );
  // A payload saved before colours existed names a class per level; the class
  // colour must fold into the level so an existing campaign keeps its look.
  check(
    "a legacy classId migrates to the class's colour",
    (() => {
      const p = parseCampaign({
        ...base,
        classes: [
          { id: "a", name: "Alpha", color: "#123456" },
          { id: "b", name: "Beta", color: "#abcdef" },
        ],
        levels: [
          { id: "L1", name: "One", classId: "a" },
          { id: "L2", name: "Two", classId: "b" },
        ],
      });
      return (
        !("error" in p) &&
        p.levels[0].color === "#123456" &&
        p.levels[1].color === "#abcdef" &&
        !("classes" in p)
      );
    })(),
  );
  check(
    "a legacy classId with no matching class falls back to the palette",
    (() => {
      const p = parseCampaign({ ...base, levels: [{ id: "L1", name: "One", classId: "gone" }] });
      return !("error" in p) && /^#[0-9a-f]{6}$/i.test(p.levels[0].color);
    })(),
  );
  check(
    "a level's own colour wins over its legacy class",
    (() => {
      const p = parseCampaign({
        ...base,
        classes: [{ id: "a", name: "Alpha", color: "#123456" }],
        levels: [{ id: "L1", name: "One", classId: "a", color: "#00ff00" }],
      });
      return !("error" in p) && p.levels[0].color === "#00ff00";
    })(),
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
    levelCount: 1,
    maxPoints: 10,
    bestFinish: 1,
    totalTime: 1,
    levels: [],
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
