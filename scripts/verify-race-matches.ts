/**
 * Verifies the 1v1 match archive: the entry built from a settled lobby, the
 * winner it records, and the store's ordering, idempotency, and pruning.
 *
 * The store falls back to an in-memory map when there is no service-role key, so
 * this drives the real functions with no Supabase and no network.
 *
 * Run: npx tsx scripts/verify-race-matches.ts
 */
import {
  RACE_MATCH_KEEP,
  archiveMatch,
  buildRaceMatch,
  clearMemoryMatches,
  readMatch,
  readRecentMatches,
} from "../src/lib/race-matches.server";
import type { RaceRun } from "../src/lib/race-modes";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.error(`  FAIL ${name}`, detail ?? "");
  }
}

function run(username: string, round: number, timeMs: number, arrowName = "Narrow Arrow"): RaceRun {
  return {
    round,
    username,
    timeMs,
    inputs: `${username}-${round}`,
    inputCount: 4,
    arrowName,
    finished: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function match(input: {
  code: string;
  mode: string;
  players: string[];
  runs: RaceRun[];
  playedAt?: string;
}) {
  return buildRaceMatch({
    code: input.code,
    levelId: "1777118905185",
    levelName: "Highway Jet",
    arrowName: "Narrow Arrow",
    mode: input.mode,
    players: input.players,
    runs: input.runs,
    playedAt: input.playedAt ?? "2026-01-01T00:00:00.000Z",
  });
}

console.log("race match archive\n");

// --- the entry built from a settled lobby -------------------------------------

{
  const built = match({
    code: "BCDF23",
    mode: "best-of-three",
    players: ["Ana", "Bob"],
    runs: [
      run("Ana", 0, 10_000),
      run("Bob", 0, 11_000),
      run("Ana", 1, 30_000),
      run("Bob", 1, 12_000),
      run("Ana", 2, 9_000),
      run("Bob", 2, 14_000),
    ],
  });
  check("the code is kept", built.code === "BCDF23");
  check(
    "the mode id and name are recorded",
    built.mode === "best-of-three" && built.modeName === "Best of three",
  );
  check("both players are recorded", built.players.join(",") === "Ana,Bob");
  check("the winner is recorded", built.winner === "Ana", built.winner);
  check("a decided match is not a tie", built.tie === false);
  const ana = built.perPlayer.find((p) => p.username === "Ana")!;
  const bob = built.perPlayer.find((p) => p.username === "Bob")!;
  check(
    "Ana's round times are in order",
    ana.timesMs.join(",") === "10000,30000,9000",
    ana.timesMs,
  );
  check("Ana won two rounds", ana.roundsWon === 2, ana.roundsWon);
  check("Bob won one round", bob.roundsWon === 1, bob.roundsWon);
  check(
    "the level and arrow are carried over",
    built.levelName === "Highway Jet" && built.arrowName === "Narrow Arrow",
  );
}

// --- an unfinished match records the gap as null ------------------------------

{
  const built = match({
    code: "QQQQQQ",
    mode: "best-of-three",
    players: ["Ana", "Bob"],
    runs: [run("Ana", 0, 10_000), run("Bob", 0, 9_000)],
  });
  check(
    "an unfinished match keeps only the rounds that were run",
    built.perPlayer.every((p) => p.timesMs[1] === null && p.timesMs[2] === null),
    built.perPlayer.map((p) => p.timesMs),
  );
  const ana = built.perPlayer.find((p) => p.username === "Ana")!;
  check(
    "a round never run is null, not zero",
    ana.timesMs[1] === null && ana.timesMs[2] === null,
    ana.timesMs,
  );
  check(
    "a player who has run nothing has no total",
    built.perPlayer.find((p) => p.username === "Bob")!.totalMs === null,
  );
}

// --- a tie is distinguished from a no-result ---------------------------------

{
  const built = match({
    code: "TIETIE",
    mode: "sudden-death",
    players: ["Ana", "Bob"],
    runs: [run("Ana", 0, 10_000), run("Bob", 0, 10_000)],
  });
  check("equal times leave no winner", built.winner === null, built.winner);
  check("equal times are recorded as a tie", built.tie === true, built.tie);
}

// --- survival records the drop ------------------------------------------------

{
  const built = match({
    code: "SURVIV",
    mode: "survival",
    players: ["Ana", "Bob"],
    runs: [
      run("Ana", 0, 10_000),
      run("Ana", 1, 30_000),
      run("Ana", 2, 11_000),
      run("Bob", 0, 12_000),
      run("Bob", 1, 13_000),
      run("Bob", 2, 14_000),
    ],
  });
  const ana = built.perPlayer.find((p) => p.username === "Ana")!;
  check("survival flags the dropped slowest run", ana.droppedSlowest === true);
  check("Ana still wins with the drop", built.winner === "Ana", built.winner);
}

// --- endurance records the total ---------------------------------------------

{
  const built = match({
    code: "ENDURN",
    mode: "endurance",
    players: ["Ana", "Bob"],
    runs: [
      run("Ana", 0, 10_000),
      run("Ana", 1, 10_000),
      run("Ana", 2, 10_000),
      run("Ana", 3, 10_000),
      run("Ana", 4, 10_000),
      run("Bob", 0, 9_000),
      run("Bob", 1, 9_000),
      run("Bob", 2, 9_000),
      run("Bob", 3, 9_000),
      run("Bob", 4, 20_000),
    ],
  });
  const ana = built.perPlayer.find((p) => p.username === "Ana")!;
  const bob = built.perPlayer.find((p) => p.username === "Bob")!;
  check("Ana's total is summed", ana.totalMs === 50_000, ana.totalMs);
  check("Bob's total is summed", bob.totalMs === 56_000, bob.totalMs);
  check("the lower total wins", built.winner === "Ana", built.winner);
}

// --- the store: idempotency, ordering, pruning --------------------------------

async function storeChecks() {
  clearMemoryMatches();

  const first = match({
    code: "AAAAAA",
    mode: "quickfire",
    players: ["Ana", "Bob"],
    runs: [run("Ana", 0, 10_000), run("Bob", 0, 11_000)],
    playedAt: "2026-01-01T00:00:00.000Z",
  });
  await archiveMatch(first);
  const again = await archiveMatch(first);
  check("archiving the same code is idempotent", again.code === "AAAAAA");
  check("a duplicate does not create a second entry", (await readRecentMatches()).length === 1);

  await archiveMatch(
    match({
      code: "BBBBBB",
      mode: "quickfire",
      players: ["Ana", "Bob"],
      runs: [run("Ana", 0, 5_000), run("Bob", 0, 6_000)],
      playedAt: "2026-01-02T00:00:00.000Z",
    }),
  );
  const recent = await readRecentMatches();
  check(
    "the newest match comes first",
    recent[0].code === "BBBBBB" && recent[1].code === "AAAAAA",
    recent.map((m) => m.code),
  );

  check("a match can be read back by code", (await readMatch("AAAAAA"))?.winner === "Ana");
  check("an unknown code reads as null", (await readMatch("ZZZZZZ")) === null);

  check("the limit is honoured", (await readRecentMatches(1)).length === 1);
  check("the limit is bounded below", (await readRecentMatches(0)).length === 1);

  // Fill past the cap and confirm the oldest fall off.
  for (let i = 0; i < RACE_MATCH_KEEP + 5; i++) {
    const code = `K${String(i).padStart(5, "0")}`;
    await archiveMatch(
      match({
        code,
        mode: "quickfire",
        players: ["Ana", "Bob"],
        runs: [run("Ana", 0, 1_000 + i), run("Bob", 0, 2_000 + i)],
      }),
    );
  }
  const all = await readRecentMatches(RACE_MATCH_KEEP);
  check("the archive is capped", all.length === RACE_MATCH_KEEP, all.length);
  check(
    "the oldest entries were pruned",
    all.every((m) => m.code !== "AAAAAA"),
  );
  check(
    "the newest entry survives",
    all[0].code === `K${String(RACE_MATCH_KEEP + 4).padStart(5, "0")}`,
    all[0].code,
  );
}

await storeChecks();

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.error("failed:", failures);
  process.exit(1);
}
