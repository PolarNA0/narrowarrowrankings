/**
 * The rulebook for a 1v1 race: the modes, and the pure logic that turns a set of
 * submitted runs into a winner.
 *
 * The whole match is decided by one pure function, `scoreRace`, over plain data —
 * no storage, no clock, no network. That is deliberate: the same rules run on the
 * server (which settles the match) and in the browser (which shows the standings),
 * so the two can never disagree about who won, and the rules can be tested without
 * a lobby.
 *
 * Every mode is asynchronous: both players race alone, whenever they like, inside
 * the match window. Their submitted runs are compared afterwards. Nothing here
 * needs the two clients to be online at the same moment.
 */

export interface RaceMode {
  id: RaceModeId;
  name: string;
  /** One line for the mode picker. */
  blurb: string;
  /** How the mode is played, in the lobby's words. */
  rules: string;
  /** Rounds each player must run (a run can be submitted per round). */
  rounds: number;
  /** Match length in minutes. 0 means untimed — play until every round is run. */
  windowMinutes: number;
  /** The run that counts for a round: the fastest, or the fastest that is not the slowest. */
  counting: "best" | "trimmed";
}

export type RaceModeId =
  "quickfire" | "best-of-three" | "survival" | "precision" | "endurance" | "sudden-death";

/**
 * The modes on offer. `quickfire` and `best-of-three` are the two asked for;
 * the rest are variations on the same engine rather than new machinery.
 */
export const RACE_MODES: RaceMode[] = [
  {
    id: "quickfire",
    name: "Quickfire",
    blurb: "One level, five minutes, fastest run wins.",
    rules: "Both players get 5 minutes to set their best time. Fastest wins.",
    rounds: 1,
    windowMinutes: 5,
    counting: "best",
  },
  {
    id: "best-of-three",
    name: "Best of three",
    blurb: "Three rounds; win the most rounds to take the match.",
    rules:
      "Three rounds, one run each per round. Fastest run wins the round; most rounds wins the match.",
    rounds: 3,
    windowMinutes: 0,
    counting: "best",
  },
  {
    id: "survival",
    name: "Survival",
    blurb: "Three rounds; your slowest run is dropped.",
    rules:
      "Three rounds each. Your slowest run is discarded, so a crash costs you less — best remaining time wins.",
    rounds: 3,
    windowMinutes: 0,
    counting: "trimmed",
  },
  {
    id: "precision",
    name: "Precision",
    blurb: "One level, fifteen minutes, unlimited attempts.",
    rules:
      "15 minutes to refine a single run. Nothing is locked in until the window closes — fastest wins.",
    rounds: 1,
    windowMinutes: 15,
    counting: "best",
  },
  {
    id: "endurance",
    name: "Endurance",
    blurb: "Five rounds; consistency beats a single hero run.",
    rules:
      "Five rounds each. Every round counts towards your total time — lowest combined time wins.",
    rounds: 5,
    windowMinutes: 0,
    counting: "best",
  },
  {
    id: "sudden-death",
    name: "Sudden death",
    blurb: "One level, one run each. No second chances.",
    rules:
      "One run each, no practice window. Your first submitted run is your entry — fastest wins.",
    rounds: 1,
    windowMinutes: 0,
    counting: "best",
  },
];

export const DEFAULT_RACE_MODE: RaceModeId = "quickfire";

export function raceMode(id: string): RaceMode {
  return RACE_MODES.find((m) => m.id === id) ?? RACE_MODES[0];
}

/** A run one player has submitted for one round. */
export interface RaceRun {
  /** 0-based round index. */
  round: number;
  username: string;
  timeMs: number;
  inputs: string;
  inputCount: number;
  arrowName: string;
  /** A run that did not finish (crashed) has no time to compare. */
  finished?: boolean;
  createdAt: string;
}

export interface RaceStanding {
  username: string;
  /** The time this round's result is judged on, or null when the player has nothing in. */
  timeMs: number | null;
  /** Rounds this player has won (round-based modes). */
  roundsWon: number;
  /** Sum of the counting runs (endurance). */
  totalMs: number | null;
  /** True when a crash was among the runs and got dropped (survival). */
  droppedSlowest: boolean;
}

export interface RaceRoundResult {
  round: number;
  /** The best (counting) run each player has in for this round. */
  entries: Array<{ username: string; timeMs: number | null }>;
  winner: string | null;
  /** Ties leave the round shared, so nobody is handed a win they did not earn. */
  tie: boolean;
}

export interface RaceResult {
  mode: RaceModeId;
  /** Every player in the match, in a stable order. */
  players: string[];
  rounds: RaceRoundResult[];
  standings: RaceStanding[];
  /** True once every player has a run in for every round the mode requires. */
  complete: boolean;
  winner: string | null;
  /** True only when a decision was reached and shared by more than one player. */
  tie: boolean;
}

/** The player's best submitted run for a round, or null if they have none. */
function bestForRound(runs: RaceRun[], username: string, round: number): RaceRun | null {
  const forRound = runs.filter(
    (r) => r.username === username && r.round === round && r.finished !== false,
  );
  if (forRound.length === 0) return null;
  return forRound.reduce((best, r) => (r.timeMs < best.timeMs ? r : best));
}

/**
 * The run a player is judged on in a round. For `trimmed` (survival) the player's
 * slowest round across the match is discarded — but only when they have run every
 * round, so discarding cannot reward someone for running fewer rounds (a crash is
 * simply absent, and must not buy a free drop).
 */
function countingRuns(
  runs: RaceRun[],
  username: string,
  mode: RaceMode,
): { perRound: Array<{ round: number; timeMs: number | null }>; dropped: boolean } {
  const perRound = Array.from({ length: mode.rounds }, (_, round) => {
    const best = bestForRound(runs, username, round);
    return { round, timeMs: best ? best.timeMs : null };
  });
  if (mode.counting !== "trimmed" || mode.rounds < 2) return { perRound, dropped: false };
  if (perRound.some((r) => r.timeMs === null)) return { perRound, dropped: false };

  // Drop the single slowest round.
  let slowest = 0;
  for (let i = 1; i < perRound.length; i++) {
    if ((perRound[i].timeMs ?? 0) > (perRound[slowest].timeMs ?? 0)) slowest = i;
  }
  return {
    perRound: perRound.map((r, i) => (i === slowest ? { round: r.round, timeMs: null } : r)),
    dropped: true,
  };
}

/** Settle a match from its submitted runs. Pure: same input, same result. */
export function scoreRace(modeId: string, players: string[], runs: RaceRun[]): RaceResult {
  const mode = raceMode(modeId);
  const roster = [...new Set(players)];
  const counting = new Map<string, Array<{ round: number; timeMs: number | null }>>();
  const dropped = new Map<string, boolean>();
  const full = new Map<string, boolean>();
  for (const player of roster) {
    const { perRound, dropped: didDrop } = countingRuns(runs, player, mode);
    counting.set(player, perRound);
    dropped.set(player, didDrop);
    full.set(
      player,
      perRound.every((r) => r.timeMs !== null),
    );
  }

  const rounds: RaceRoundResult[] = [];
  for (let round = 0; round < mode.rounds; round++) {
    const entries = roster.map((username) => ({
      username,
      timeMs: counting.get(username)?.[round]?.timeMs ?? null,
    }));
    const times = entries.filter((e) => e.timeMs !== null).map((e) => e.timeMs as number);
    const best = times.length ? Math.min(...times) : null;
    const winners = best === null ? [] : entries.filter((e) => e.timeMs === best);
    rounds.push({
      round,
      entries,
      winner: winners.length === 1 ? winners[0].username : null,
      tie: winners.length > 1,
    });
  }

  const standings: RaceStanding[] = roster.map((username) => {
    const playerRuns = counting.get(username) ?? [];
    const times = playerRuns.map((r) => r.timeMs).filter((t): t is number => t !== null);
    // A combined time is only meaningful once every round is in — otherwise a
    // player could "win" endurance by running fewer rounds.
    const complete = full.get(username) === true;
    return {
      username,
      timeMs: times.length ? Math.min(...times) : null,
      roundsWon: rounds.filter((r) => r.winner === username).length,
      totalMs: complete && times.length ? times.reduce((a, b) => a + b, 0) : null,
      droppedSlowest: dropped.get(username) === true,
    };
  });

  // Endurance is decided on the combined time; every other mode on rounds won,
  // falling back to the best single run when no round produced a winner.
  const decided =
    mode.id === "endurance"
      ? decideBy(standings, (s) => s.totalMs, "low")
      : (decideBy(standings, (s) => s.roundsWon, "high") ??
        decideBy(standings, (s) => s.timeMs, "low"));

  return {
    mode: mode.id,
    players: roster,
    rounds,
    standings,
    complete: raceComplete(mode.id, roster, runs),
    winner: decided?.winner ?? null,
    // A tie means a decision was reached and shared. Nobody having raced is not a
    // tie, it is an undecided match — the UI reads `complete` for that.
    tie: decided?.tie ?? false,
  };
}

/**
 * Pick the best player on a metric. A metric that is null for everyone is not a
 * decision at all (nobody has submitted), so it yields no winner rather than a
 * tie between players who have not raced.
 */
function decideBy(
  standings: RaceStanding[],
  metric: (s: RaceStanding) => number | null,
  direction: "low" | "high",
): { winner: string | null; tie: boolean } | null {
  const scored = standings
    .map((s) => ({ username: s.username, value: metric(s) }))
    .filter((s): s is { username: string; value: number } => s.value !== null);
  if (scored.length === 0) return null;
  const best = scored.reduce((acc, s) =>
    direction === "low" ? (s.value < acc.value ? s : acc) : s.value > acc.value ? s : acc,
  );
  const tied = scored.filter((s) => s.value === best.value);
  // A zero on a "high" metric (no rounds won by anyone) is not a result.
  if (direction === "high" && best.value === 0) return null;
  return { winner: tied.length === 1 ? best.username : null, tie: tied.length > 1 };
}

/** True when every player has a run in for every round the mode requires. */
export function raceComplete(modeId: string, players: string[], runs: RaceRun[]): boolean {
  const mode = raceMode(modeId);
  return players.every((p) =>
    Array.from({ length: mode.rounds }, (_, round) => round).every((round) =>
      runs.some((r) => r.username === p && r.round === round && r.finished !== false),
    ),
  );
}

/** Rounds a player still has to run, for the lobby's "your turn" prompt. */
export function roundsRemaining(modeId: string, username: string, runs: RaceRun[]): number[] {
  const mode = raceMode(modeId);
  return Array.from({ length: mode.rounds }, (_, round) => round).filter(
    (round) =>
      !runs.some((r) => r.username === username && r.round === round && r.finished !== false),
  );
}

/** A short, unambiguous lobby code: no vowels, so it cannot spell a word by accident. */
const CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

export function makeLobbyCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeLobbyCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

export function isValidLobbyCode(code: string): boolean {
  return /^[BCDFGHJKLMNPQRSTVWXZ23456789]{6}$/.test(code);
}
