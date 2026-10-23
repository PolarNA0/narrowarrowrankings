/**
 * Verifies the 1v1 race rules: `scoreRace`, the round accounting and the mode
 * catalog. These are pure functions, so the checks drive the real code with no
 * lobby, storage or clock involved.
 *
 * Run: npx tsx scripts/verify-race-modes.ts
 */
import {
  DEFAULT_RACE_MODE,
  RACE_MODES,
  isValidLobbyCode,
  makeLobbyCode,
  normalizeLobbyCode,
  raceComplete,
  raceMode,
  roundsRemaining,
  scoreRace,
  type RaceRun,
} from "../src/lib/race-modes";

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

function run(
  username: string,
  round: number,
  timeMs: number,
  finished = true,
): RaceRun {
  return {
    round,
    username,
    timeMs,
    inputs: `${username}-${round}`,
    inputCount: 4,
    arrowName: "Narrow Arrow",
    finished,
    createdAt: new Date(1_700_000_000_000 + round * 1000).toISOString(),
  };
}

console.log("race modes\n");

// --- the catalog -------------------------------------------------------------

check("there are at least six modes", RACE_MODES.length >= 6, RACE_MODES.length);
check(
  "mode ids are unique",
  new Set(RACE_MODES.map((m) => m.id)).size === RACE_MODES.length,
);
check(
  "every mode demands at least one round",
  RACE_MODES.every((m) => m.rounds >= 1),
);
check(
  "every mode has a blurb and rules text",
  RACE_MODES.every((m) => m.blurb.length > 0 && m.rules.length > 0),
);
check(
  "only timed modes carry a window",
  RACE_MODES.filter((m) => m.windowMinutes > 0).every((m) => m.rounds === 1),
  RACE_MODES.filter((m) => m.windowMinutes > 0).map((m) => m.id),
);
check("the default mode exists", raceMode(DEFAULT_RACE_MODE).id === DEFAULT_RACE_MODE);
check("an unknown mode falls back rather than throwing", raceMode("nope").id === RACE_MODES[0].id);

// --- quickfire: fastest single run ------------------------------------------

{
  const runs = [run("Ana", 0, 12_000), run("Bob", 0, 11_000)];
  const result = scoreRace("quickfire", ["Ana", "Bob"], runs);
  check("quickfire: fastest run wins", result.winner === "Bob", result.winner);
  check("quickfire: not a tie", result.tie === false);
  check("quickfire: one round only", result.rounds.length === 1);
  check("quickfire: round winner is the fastest", result.rounds[0].winner === "Bob");
}

{
  const result = scoreRace("quickfire", ["Ana", "Bob"], [run("Ana", 0, 12_000)]);
  check(
    "quickfire: a player with no run cannot win",
    result.winner === "Ana",
    result.winner,
  );
  check(
    "quickfire: the silent player shows a null time",
    result.standings.find((s) => s.username === "Bob")?.timeMs === null,
  );
}

{
  const result = scoreRace("quickfire", ["Ana", "Bob"], []);
  check("no runs at all: no winner", result.winner === null);
  check("no runs at all: not a tie, just undecided", result.tie === false);
  check("no runs at all: the match is not complete", result.complete === false);
}

{
  // Best run counts, not the latest.
  const runs = [run("Ana", 0, 15_000), run("Ana", 0, 10_000), run("Bob", 0, 11_000)];
  const result = scoreRace("quickfire", ["Ana", "Bob"], runs);
  check("quickfire: a player's best run counts", result.winner === "Ana", result.winner);
}

{
  // A crash carries no time and must never be treated as a 0s run.
  const runs = [run("Ana", 0, 12_000), run("Bob", 0, 1, false)];
  const result = scoreRace("quickfire", ["Ana", "Bob"], runs);
  check("a crashed run cannot win", result.winner === "Ana", result.winner);
  check(
    "a crashed run is not counted as a time",
    result.standings.find((s) => s.username === "Bob")?.timeMs === null,
  );
}

{
  const result = scoreRace("quickfire", ["Ana", "Bob"], [run("Ana", 0, 10_000), run("Bob", 0, 10_000)]);
  check("an exact time tie leaves no winner", result.winner === null);
  check("an exact time tie is reported as a tie", result.tie === true);
  check("a tied round names no winner", result.rounds[0].winner === null);
  check("a tied round is flagged", result.rounds[0].tie === true);
}

// --- best of three -----------------------------------------------------------

{
  // Ana takes rounds 0 and 2, Bob takes round 1 -> Ana 2-1.
  const runs = [
    run("Ana", 0, 10_000),
    run("Bob", 0, 11_000),
    run("Ana", 1, 30_000),
    run("Bob", 1, 12_000),
    run("Ana", 2, 9_000),
    run("Bob", 2, 14_000),
  ];
  const result = scoreRace("best-of-three", ["Ana", "Bob"], runs);
  check("best-of-three: most rounds wins", result.winner === "Ana", result.winner);
  check(
    "best-of-three: rounds are tallied",
    result.standings.find((s) => s.username === "Ana")?.roundsWon === 2 &&
      result.standings.find((s) => s.username === "Bob")?.roundsWon === 1,
  );
  check("best-of-three: three rounds reported", result.rounds.length === 3);
}

{
  // Each wins one round, the third is unfinished -> no decision yet.
  const runs = [run("Ana", 0, 10_000), run("Bob", 1, 10_000)];
  const result = scoreRace("best-of-three", ["Ana", "Bob"], runs);
  check(
    "best-of-three: 1-1 with a round to play falls back to best run",
    result.winner === null && result.tie === true,
    `${result.winner}/${result.tie}`,
  );
  check("best-of-three: the match is not complete", result.complete === false);
}

{
  const runs = [0, 1, 2].flatMap((r) => [run("Ana", r, 10_000), run("Bob", r, 11_000)]);
  const result = scoreRace("best-of-three", ["Ana", "Bob"], runs);
  check("best-of-three: complete once every round is run", result.complete === true);
}

// --- survival: slowest round dropped ----------------------------------------

{
  // Ana: 10, 40, 11 -> drops 40 -> total 21. Bob: 15, 16, 17 -> total 48.
  const runs = [
    run("Ana", 0, 10_000),
    run("Ana", 1, 40_000),
    run("Ana", 2, 11_000),
    run("Bob", 0, 15_000),
    run("Bob", 1, 16_000),
    run("Bob", 2, 17_000),
  ];
  const result = scoreRace("survival", ["Ana", "Bob"], runs);
  check(
    "survival: the slowest round is dropped",
    result.standings.find((s) => s.username === "Ana")?.droppedSlowest === true,
  );
  check(
    "survival: Ana still wins on best time after the drop",
    result.winner === "Ana",
    result.winner,
  );
}

{
  // Bob crashes one round. He should NOT get a free drop for it — the crash is
  // simply absent, and his slowest real round must stay.
  const runs = [
    run("Bob", 0, 10_000),
    run("Bob", 1, 50_000, false),
    run("Bob", 2, 11_000),
    run("Ana", 0, 12_000),
    run("Ana", 1, 12_000),
    run("Ana", 2, 12_000),
  ];
  const result = scoreRace("survival", ["Ana", "Bob"], runs);
  check(
    "survival: a crash does not buy a dropped round",
    result.standings.find((s) => s.username === "Bob")?.droppedSlowest === false,
  );
}

{
  // A player who has run only one round must not be able to drop it.
  const runs = [run("Ana", 0, 5_000), run("Bob", 0, 6_000), run("Bob", 1, 7_000), run("Bob", 2, 8_000)];
  const result = scoreRace("survival", ["Ana", "Bob"], runs);
  check(
    "survival: an incomplete player gets no drop",
    result.standings.find((s) => s.username === "Ana")?.droppedSlowest === false,
  );
}

// --- endurance: combined time ------------------------------------------------

{
  const runs = [
    ...[10_000, 11_000, 12_000, 13_000, 14_000].map((t, r) => run("Ana", r, t)),
    ...[9_000, 15_000, 12_000, 13_000, 14_000].map((t, r) => run("Bob", r, t)),
  ];
  const result = scoreRace("endurance", ["Ana", "Bob"], runs);
  check(
    "endurance: decided on the combined time",
    result.standings.find((s) => s.username === "Ana")?.totalMs === 60_000 &&
      result.standings.find((s) => s.username === "Bob")?.totalMs === 63_000,
  );
  check("endurance: lowest combined time wins", result.winner === "Ana", result.winner);
  check("endurance: five rounds is a complete match", result.complete === true);
}

{
  // Endurance must be decided on totals, not rounds won: Bob wins round 0, but
  // Ana's consistent rounds should take the match.
  const runs = [
    ...[12_000, 12_000, 12_000, 12_000, 12_000].map((t, r) => run("Ana", r, t)),
    ...[5_000, 30_000, 12_000, 12_000, 12_000].map((t, r) => run("Bob", r, t)),
  ];
  const result = scoreRace("endurance", ["Ana", "Bob"], runs);
  check(
    "endurance: totals beat a single hero round",
    result.winner === "Ana",
    result.winner,
  );
}

{
  // The exploit this guards: running only the easy rounds must not win endurance.
  // Bob skips rounds 1-4, so he has no combined time to be judged on.
  const runs = [
    ...[9_000, 9_000, 9_000, 9_000, 9_000].map((t, r) => run("Ana", r, t)),
    run("Bob", 0, 5_000),
  ];
  const result = scoreRace("endurance", ["Ana", "Bob"], runs);
  check(
    "endurance: an incomplete player gets no combined time",
    result.standings.find((s) => s.username === "Bob")?.totalMs === null,
  );
  check(
    "endurance: skipping rounds cannot win the match",
    result.winner === "Ana" && result.standings.find((s) => s.username === "Bob")?.totalMs === null,
    result.winner,
  );
  check("endurance: the match is not complete", result.complete === false);
}

// --- progress helpers --------------------------------------------------------

check(
  "raceComplete: false while a round is missing",
  raceComplete("best-of-three", ["Ana", "Bob"], [run("Ana", 0, 1), run("Ana", 1, 1), run("Ana", 2, 1)]) === false,
);
check(
  "raceComplete: true once both have all rounds",
  raceComplete(
    "best-of-three",
    ["Ana", "Bob"],
    [0, 1, 2].flatMap((r) => [run("Ana", r, 1000 + r), run("Bob", r, 1000 + r)]),
  ) === true,
);
check(
  "roundsRemaining: lists the rounds a player still owes",
  JSON.stringify(roundsRemaining("best-of-three", "Ana", [run("Ana", 1, 5)])) === "[0,2]",
);
check(
  "roundsRemaining: empty once the player is done",
  roundsRemaining("best-of-three", "Ana", [0, 1, 2].map((r) => run("Ana", r, 5))).length === 0,
);

// --- lobby codes -------------------------------------------------------------

{
  const code = makeLobbyCode();
  check("a generated code is six characters", code.length === 6, code);
  check("a generated code is valid", isValidLobbyCode(code), code);
  check("a generated code has no vowels", !/[AEIOU]/.test(code), code);
  check("codes are deterministic for a fixed rng", makeLobbyCode(() => 0) === "BBBBBB");
  check("a lowercase code normalises", normalizeLobbyCode(" bcd234 ") === "BCD234");
  check("punctuation is stripped", normalizeLobbyCode("b-c d!2") === "BCD2");
  check("a 5-char code is rejected", isValidLobbyCode("BCD23") === false);
  check("a vowel-bearing code is rejected", isValidLobbyCode("ABCDEF") === false);
  check("a full valid code is accepted", isValidLobbyCode("BCDF23") === true);
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.error("failed:", failures);
  process.exit(1);
}
