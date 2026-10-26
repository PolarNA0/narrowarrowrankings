/**
 * Achievement checks, driven against the real merged boards.
 *
 * Run: npx tsx scripts/verify-achievements.ts
 *
 * The rules are pure, but the thresholds are only meaningful against real data,
 * so this loads the live boards and asserts the properties a hand-checked table
 * misses: no impossible threshold, no badge nobody can earn, earner lists in
 * chronological order, and a grid that agrees with its own earner boards.
 */
import { LEVELS, LEVEL_PACKS } from "@/constants";
import {
  achievementDefs,
  buildCareers,
  computeAchievements,
  computeEarners,
  emptyCareer,
} from "@/lib/achievements";
import type { LeaderboardEntry } from "@/types";

const BASE = "https://api.narrowarrow.xyz/leaderboard?levelId=";

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

async function main() {
  const data: Record<string, LeaderboardEntry[]> = {};
  for (const level of LEVELS) {
    try {
      const res = await fetch(BASE + level.id);
      if (res.ok) data[level.id] = (await res.json()) as LeaderboardEntry[];
    } catch {
      /* a level that fails to load is simply absent, as in the app */
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  const loadedLevels = LEVELS.filter((l) => (data[l.id]?.length ?? 0) > 0);
  check("boards loaded", loadedLevels.length > 0, `${loadedLevels.length}/${LEVELS.length} levels`);

  // ---- The table itself -------------------------------------------------
  const defs = achievementDefs(LEVELS.length, LEVEL_PACKS.length, LEVEL_PACKS);
  check("at least 90 achievements", defs.length >= 90, `${defs.length} defined`);
  check("ids are unique", new Set(defs.map((d) => d.id)).size === defs.length);
  check(
    "every badge has a target",
    defs.every((d) => d.target > 0),
  );
  check(
    "every badge has a name and description",
    defs.every((d) => d.name && d.description),
  );

  // The impossible badge must be gone, and nothing may reintroduce a ten-second
  // bar: the fastest run on any board is above ten seconds.
  check(
    "no '10 runs under 10 seconds' badge",
    !defs.some((d) => /10 runs under 10/i.test(d.description)),
  );
  check("no sub-10 personal-best badge", !defs.some((d) => d.target === 10 && d.unit === "s"));
  check(
    "no badge counts runs under 10 seconds",
    !defs.some((d) => /under 10 seconds/i.test(d.description)),
  );

  // ---- Careers over the real boards -------------------------------------
  const careers = buildCareers(LEVELS, LEVEL_PACKS, data);
  check("careers built", careers.size > 0, `${careers.size} players`);

  const times = [...careers.values()].map((c) => c.fastest).filter((t) => Number.isFinite(t));
  const fastest = Math.min(...times);
  check("fastest run is above 10s", fastest > 10, `${fastest.toFixed(2)}s`);

  // Every badge must be earnable by at least one real player, except the
  // deliberate full sweeps, which no current board satisfies. The exemption is
  // listed by id so it stays explicit rather than a blanket "some are hard".
  // Only the badges that genuinely no current board satisfies belong here; if a
  // listed id turns out to be earned, the assertion below says so.
  const sweepIds = new Set(["wr-immortal", "immaculate"]);
  const earnable = new Set<string>();
  for (const c of careers.values()) {
    for (const a of computeAchievements(
      c,
      LEVELS.length,
      LEVEL_PACKS.length,
      LEVEL_PACKS,
      LEVELS,
    )) {
      if (a.earned) earnable.add(a.id);
    }
  }
  const unearned = defs.filter((d) => !earnable.has(d.id) && !sweepIds.has(d.id));
  check(
    "every non-sweep achievement is earned by someone",
    unearned.length === 0,
    unearned.length ? unearned.map((d) => d.id).join(", ") : "all covered",
  );
  const sweepEarned = defs.filter((d) => sweepIds.has(d.id) && earnable.has(d.id));
  check(
    "every exempted sweep is genuinely unearned",
    sweepEarned.length === 0,
    sweepEarned.length
      ? `stale exemption: ${sweepEarned.map((d) => d.id).join(", ")}`
      : "none stale",
  );

  // ---- Progress and detail sanity ---------------------------------------
  let progressBad = "";
  let detailBad = "";
  for (const c of careers.values()) {
    const list = computeAchievements(c, LEVELS.length, LEVEL_PACKS.length, LEVEL_PACKS, LEVELS);
    for (const a of list) {
      if (!(a.progress >= 0 && a.progress <= 1) && !progressBad) {
        progressBad = `${c.username}:${a.id}=${a.progress}`;
      }
      if (/NaN|Infinity|undefined/.test(a.detail) && !detailBad) {
        detailBad = `${c.username}:${a.id}="${a.detail}"`;
      }
    }
  }
  check("progress stays within 0..1 for every player", !progressBad, progressBad);
  check("no NaN/Infinity leaks into a detail string", !detailBad, detailBad);

  // A full-progress badge must be earned, and a zero-progress one must not be:
  // otherwise the bar and the award disagree.
  let mismatch = "";
  for (const c of careers.values()) {
    for (const a of computeAchievements(
      c,
      LEVELS.length,
      LEVEL_PACKS.length,
      LEVEL_PACKS,
      LEVELS,
    )) {
      if (a.earned && a.progress < 1 && !mismatch)
        mismatch = `${c.username}:${a.id} earned at ${a.progress}`;
    }
  }
  check("every earned badge shows full progress", !mismatch, mismatch);

  // ---- Earner boards -----------------------------------------------------
  const earners = computeEarners(LEVELS, LEVEL_PACKS, data);
  let orderBad = "";
  let totalEarners = 0;
  let dupBad = "";
  for (const [id, list] of earners) {
    totalEarners += list.length;
    for (let i = 1; i < list.length; i++) {
      if (Date.parse(list[i].at) < Date.parse(list[i - 1].at) && !orderBad) {
        orderBad = `${id}: ${list[i - 1].at} then ${list[i].at}`;
      }
    }
    const seen = new Set<string>();
    for (const e of list) {
      const k = e.username.toLowerCase();
      if (seen.has(k) && !dupBad) dupBad = `${id}: ${e.username}`;
      seen.add(k);
    }
  }
  check(
    "earner lists are in ascending date order",
    !orderBad,
    orderBad || `${totalEarners} entries`,
  );
  check("no player appears twice on one achievement", !dupBad, dupBad);

  const empties = defs
    .filter((d) => earnable.has(d.id) && (earners.get(d.id)?.length ?? 0) === 0)
    .map((d) => d.id);
  check(
    "no badge is earned in the grid but missing from its earner list",
    empties.length === 0,
    empties.length ? empties.join(", ") : "consistent",
  );

  const sample = [...careers.values()].sort((a, b) => b.runs - a.runs)[0];
  const gridEarned = new Set(
    computeAchievements(sample, LEVELS.length, LEVEL_PACKS.length, LEVEL_PACKS, LEVELS)
      .filter((a) => a.earned)
      .map((a) => a.id),
  );
  const listed = new Set(
    [...earners.entries()]
      .filter(([, list]) =>
        list.some((e) => e.username.toLowerCase() === sample.username.toLowerCase()),
      )
      .map(([id]) => id),
  );
  // A rank-derived badge is dated by the run at which the player's own PBs first
  // satisfied it under today's ranking, so a tie can date it earlier than the
  // grid's current standing; the check is that the grid's badges all appear.
  const missing = [...gridEarned].filter((id) => !listed.has(id));
  check(
    `earner boards include every badge the grid shows (${sample.username})`,
    missing.length === 0,
    missing.length ? missing.join(", ") : `${gridEarned.size} badges`,
  );

  // ---- Determinism -------------------------------------------------------
  const again = computeEarners(LEVELS, LEVEL_PACKS, data);
  const first = earners.get("first-steps") ?? [];
  const second = again.get("first-steps") ?? [];
  check(
    "earner computation is deterministic",
    first.length === second.length && first.every((e, i) => e.username === second[i].username),
  );

  // ---- The first-ever badge ---------------------------------------------
  check("First Steps has an earner", first.length > 0, `${first.length} players`);
  if (first.length > 1) {
    const ok = first.slice(1).every((e) => Date.parse(e.at) >= Date.parse(first[0].at));
    check("the earliest First Steps earner is first", ok, `${first[0].username} @ ${first[0].at}`);
  }

  // ---- Empty input -------------------------------------------------------
  const empty = computeAchievements(
    emptyCareer("nobody", LEVELS.length, LEVEL_PACKS.length),
    LEVELS.length,
    LEVEL_PACKS.length,
    LEVEL_PACKS,
    LEVELS,
  );
  check(
    "an empty career earns nothing",
    empty.every((a) => !a.earned),
  );
  check("an empty career still renders every badge", empty.length === defs.length);

  // ---- Coverage summary --------------------------------------------------
  const byCategory = new Map<string, number>();
  for (const d of defs) byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
  console.log(`\ncategories: ${[...byCategory.entries()].map(([c, n]) => `${c} ${n}`).join(", ")}`);
  console.log(
    `players: ${careers.size}, achievements: ${defs.length}, earner rows: ${totalEarners}`,
  );
  const mostEarned = [...careers.entries()].sort(
    (a, b) =>
      computeAchievements(b[1], LEVELS.length, LEVEL_PACKS.length, LEVEL_PACKS, LEVELS).filter(
        (x) => x.earned,
      ).length -
      computeAchievements(a[1], LEVELS.length, LEVEL_PACKS.length, LEVEL_PACKS, LEVELS).filter(
        (x) => x.earned,
      ).length,
  )[0];
  const topCount = computeAchievements(
    mostEarned[1],
    LEVELS.length,
    LEVEL_PACKS.length,
    LEVEL_PACKS,
    LEVELS,
  ).filter((x) => x.earned).length;
  console.log(`most unlocked: ${mostEarned[0]} with ${topCount}/${defs.length}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
