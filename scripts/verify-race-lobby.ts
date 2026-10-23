/**
 * Verifies the 1v1 lobby rules: joining, the one-run-per-round commitment, the
 * window, and the arrow/round/time guards the server enforces so a client cannot
 * lie its way onto the board.
 *
 * The store falls back to an in-memory map when there is no service-role key, so
 * this drives the real store functions with no Supabase and no network.
 *
 * Run: npx tsx scripts/verify-race-lobby.ts
 */
import {
  RACE_MAX_PLAYERS,
  clearMemoryLobbies,
  isLobbyExpired,
  joinLobby,
  lobbyClosed,
  lobbyRemainingMs,
  makeLobby,
  readLobby,
  saveLobby,
  submitRun,
  type RaceLobby,
} from "../src/lib/race-lobby.server";
import { raceMode, scoreRace, type RaceRun } from "../src/lib/race-modes";

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
    createdAt: new Date().toISOString(),
  };
}

function freshLobby(mode = "quickfire"): RaceLobby {
  return makeLobby({
    code: "BCDF23",
    levelId: "1777118905185",
    levelName: "Highway Jet",
    arrowName: "Narrow Arrow",
    mode,
    host: "Ana",
  });
}

console.log("race lobby rules\n");

// --- creation ----------------------------------------------------------------

{
  const lobby = freshLobby();
  check("the host is the first player", lobby.players.length === 1 && lobby.players[0] === "Ana");
  check("a fresh lobby has no runs", lobby.runs.length === 0);
  check("a fresh lobby is not settled", lobby.settledAt === null);
  check("the mode is fixed at creation", lobby.mode === "quickfire");
  check("the arrow is fixed at creation", lobby.arrowName === "Narrow Arrow");
}

{
  // A timed mode carries a closing time; an untimed one does not.
  const timed = freshLobby("quickfire");
  const untimed = freshLobby("best-of-three");
  check("a timed mode sets a closing time", timed.closesAt !== null);
  check("an untimed mode has no closing time", untimed.closesAt === null);
  const mode = raceMode("quickfire");
  check(
    "the closing time is the mode's window away",
    lobbyRemainingMs(timed, Date.parse(timed.createdAt)) === mode.windowMinutes * 60_000,
  );
}

// --- joining -----------------------------------------------------------------

{
  const joined = joinLobby(freshLobby(), "Bob");
  check("a second player can join", joined.ok && joined.lobby.players.includes("Bob"));
}

{
  const lobby = freshLobby();
  const again = joinLobby(joinLobby(lobby, "Bob").ok ? { ...lobby, players: ["Ana", "Bob"] } : lobby, "Bob");
  check("joining twice is a no-op, not an error", again.ok && again.lobby.players.length === 2);
}

{
  const full = { ...freshLobby(), players: ["Ana", "Bob"] };
  const third = joinLobby(full, "Cara");
  check(
    "a 1v1 refuses a third player",
    third.ok === false && RACE_MAX_PLAYERS === 2,
    third.ok === false ? third.error : "",
  );
}

{
  // A settled lobby is closed to new players.
  const settled = { ...freshLobby(), settledAt: new Date().toISOString() };
  const late = joinLobby(settled, "Bob");
  check("a settled lobby refuses a join", late.ok === false);
}

// --- submitting --------------------------------------------------------------

{
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  const ok = submitRun(lobby, run("Ana", 0, 12_000));
  check("a valid run is accepted", ok.ok === true);
  if (ok.ok) check("the run is stored", ok.lobby.runs.length === 1);
}

{
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  const outsider = submitRun(lobby, run("Cara", 0, 12_000));
  check("a non-player cannot submit", outsider.ok === false);
}

{
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  const wrongArrow = submitRun(lobby, run("Ana", 0, 12_000, "Fat Arrow"));
  check("a run on another arrow is refused", wrongArrow.ok === false);
}

{
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  check("a zero time is refused", submitRun(lobby, run("Ana", 0, 0)).ok === false);
  check("a negative time is refused", submitRun(lobby, run("Ana", 0, -5)).ok === false);
  check("an absurd time is refused", submitRun(lobby, run("Ana", 0, 99_999_999)).ok === false);
}

{
  // quickfire has one round, so round 1 does not exist.
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  check("a round the mode does not have is refused", submitRun(lobby, run("Ana", 1, 12_000)).ok === false);
}

{
  // The core commitment: one run per round, so a round cannot be farmed.
  const lobby = { ...freshLobby("best-of-three"), players: ["Ana", "Bob"] };
  const first = submitRun(lobby, run("Ana", 0, 12_000));
  check("the first run in a round is accepted", first.ok === true);
  if (first.ok) {
    const second = submitRun(first.lobby, run("Ana", 0, 9_000));
    check("a second run in the same round is refused", second.ok === false);
    const otherRound = submitRun(first.lobby, run("Ana", 1, 9_000));
    check("a run in a different round is still allowed", otherRound.ok === true);
  }
}

{
  // The window closing stops submissions.
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  const past = { ...lobby, closesAt: new Date(Date.now() - 1000).toISOString() };
  check("a closed lobby reports itself closed", lobbyClosed(past) === true);
  check("a run after the window is refused", submitRun(past, run("Ana", 0, 12_000)).ok === false);
}

{
  const lobby = { ...freshLobby(), players: ["Ana", "Bob"] };
  const settled = { ...lobby, settledAt: new Date().toISOString() };
  check("a settled lobby is closed", lobbyClosed(settled) === true);
  check("a run after settlement is refused", submitRun(settled, run("Ana", 0, 12_000)).ok === false);
}

// --- expiry ------------------------------------------------------------------

{
  const lobby = freshLobby();
  const old = { ...lobby, createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() };
  check("a lobby older than its TTL has expired", isLobbyExpired(old) === true);
  check("a fresh lobby has not expired", isLobbyExpired(lobby) === false);
}

// --- storage round-trip ------------------------------------------------------

{
  clearMemoryLobbies();
  await saveLobby(freshLobby());
  const read = await readLobby("BCDF23");
  check("a saved lobby can be read back", read !== null && read.host === "Ana");
  check("a lowercase code finds the same lobby", (await readLobby("bcdf23"))?.code === "BCDF23");
  check("an unknown code reads as null", (await readLobby("ZZZZZZ")) === null);
  check("a malformed code reads as null", (await readLobby("nope")) === null);
  clearMemoryLobbies();
}

// --- the match, end to end ---------------------------------------------------

{
  // Play a whole best-of-three through the store, then settle it.
  let lobby: RaceLobby = { ...freshLobby("best-of-three"), players: ["Ana", "Bob"] };
  const plays: Array<[string, number, number]> = [
    ["Ana", 0, 10_000],
    ["Bob", 0, 11_000],
    ["Ana", 1, 30_000],
    ["Bob", 1, 12_000],
    ["Ana", 2, 9_000],
    ["Bob", 2, 14_000],
  ];
  for (const [who, round, time] of plays) {
    const result = submitRun(lobby, run(who, round, time));
    if (result.ok) lobby = result.lobby;
  }
  check("every valid run landed", lobby.runs.length === 6, lobby.runs.length);
  const result = scoreRace(lobby.mode, lobby.players, lobby.runs);
  check("the settled match has a winner", result.winner === "Ana", result.winner);
  check("the match is complete", result.complete === true);
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.error("failed:", failures);
  process.exit(1);
}
