/**
 * Lobby storage for 1v1 races, keyed per lobby code in `app_docs`.
 *
 * A lobby is one document: who is in it, which level and mode it is playing, the
 * window it runs in, and the runs submitted so far. The document is the whole
 * match — the winner is never stored, it is re-derived from the runs by
 * `scoreRace`, so the standings can never drift from the runs that produced them.
 *
 * Writes go through the service role (clients cannot write `app_docs`), and the
 * server re-checks every rule a client could lie about: the level and mode are
 * fixed when the lobby is created, a run must arrive inside the window, and the
 * same player cannot overwrite an earlier run in a round.
 */
import { supabase } from "@/integrations/supabase/client";
import { isValidLobbyCode, normalizeLobbyCode, raceMode, type RaceRun } from "@/lib/race-modes";

export interface RaceLobby {
  code: string;
  levelId: string;
  levelName: string;
  /** Arrow the lobby is raced with; a run on another arrow is rejected. */
  arrowName: string;
  mode: string;
  /** The player who created it; only they can change the level or mode. */
  host: string;
  players: string[];
  runs: RaceRun[];
  /** ISO timestamps. `closesAt` is null for untimed modes. */
  createdAt: string;
  closesAt: string | null;
  /** Set once the match has been settled, so a finished lobby stops accepting runs. */
  settledAt: string | null;
}

const COLLECTION = "race_lobbies";

/** A lobby is abandoned after this long, so stale codes cannot pile up. */
const LOBBY_TTL_MS = 6 * 60 * 60 * 1000;

const memoryLobbies = new Map<string, RaceLobby>();
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Test hook: clear the in-memory store between checks. */
export function clearMemoryLobbies() {
  memoryLobbies.clear();
}

export function isLobbyExpired(lobby: RaceLobby, now = Date.now()): boolean {
  return now - Date.parse(lobby.createdAt) > LOBBY_TTL_MS;
}

/** True when the lobby no longer accepts runs (settled, or its window has passed). */
export function lobbyClosed(lobby: RaceLobby, now = Date.now()): boolean {
  if (lobby.settledAt) return true;
  return lobby.closesAt !== null && now > Date.parse(lobby.closesAt);
}

/** The window's remaining time in ms, or null when the mode is untimed. */
export function lobbyRemainingMs(lobby: RaceLobby, now = Date.now()): number | null {
  if (lobby.closesAt === null) return null;
  return Math.max(0, Date.parse(lobby.closesAt) - now);
}

export function makeLobby(input: {
  code: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  mode: string;
  host: string;
}): RaceLobby {
  const mode = raceMode(input.mode);
  const createdAt = new Date();
  return {
    code: input.code,
    levelId: input.levelId,
    levelName: input.levelName,
    arrowName: input.arrowName,
    mode: mode.id,
    host: input.host,
    players: [input.host],
    runs: [],
    createdAt: createdAt.toISOString(),
    closesAt:
      mode.windowMinutes > 0
        ? new Date(createdAt.getTime() + mode.windowMinutes * 60_000).toISOString()
        : null,
    settledAt: null,
  };
}

/** A lobby is at most two players — this is a 1v1. */
export const RACE_MAX_PLAYERS = 2;

/** Add a player, idempotently, unless the lobby is full or closed. */
export function joinLobby(
  lobby: RaceLobby,
  username: string,
  now = Date.now(),
): { ok: true; lobby: RaceLobby } | { ok: false; error: string } {
  if (isLobbyExpired(lobby, now)) return { ok: false, error: "That lobby has expired." };
  if (lobby.players.includes(username)) return { ok: true, lobby };
  if (lobbyClosed(lobby, now)) return { ok: false, error: "That race has already started." };
  if (lobby.players.length >= RACE_MAX_PLAYERS) {
    return { ok: false, error: "That lobby is already full." };
  }
  return { ok: true, lobby: { ...lobby, players: [...lobby.players, username] } };
}

/**
 * Record a submitted run. Rejects anything the client could have got wrong or
 * lied about: a closed window, an unknown player, a bad time, a foreign arrow,
 * a round the mode does not have, or a round the player has already posted.
 *
 * The one-run-per-round rule is what makes the modes mean something: a round is
 * a commitment, so "best of three" cannot be won by retrying round one forever.
 */
export function submitRun(
  lobby: RaceLobby,
  run: RaceRun,
  now = Date.now(),
): { ok: true; lobby: RaceLobby } | { ok: false; error: string } {
  if (isLobbyExpired(lobby, now)) return { ok: false, error: "That lobby has expired." };
  if (lobbyClosed(lobby, now)) return { ok: false, error: "The race window has closed." };
  if (!lobby.players.includes(run.username)) {
    return { ok: false, error: "You are not in this race." };
  }
  const mode = raceMode(lobby.mode);
  if (!Number.isInteger(run.round) || run.round < 0 || run.round >= mode.rounds) {
    return { ok: false, error: "That round is not part of this mode." };
  }
  if (!Number.isFinite(run.timeMs) || run.timeMs <= 0 || run.timeMs > 60 * 60 * 1000) {
    return { ok: false, error: "That run has no valid time." };
  }
  if (run.arrowName !== lobby.arrowName) {
    return { ok: false, error: `This race is on ${lobby.arrowName}.` };
  }
  const already = lobby.runs.some((r) => r.username === run.username && r.round === run.round);
  if (already) {
    return { ok: false, error: `You have already posted round ${run.round + 1}.` };
  }
  return { ok: true, lobby: { ...lobby, runs: [...lobby.runs, run] } };
}

export async function readLobby(code: string): Promise<RaceLobby | null> {
  const normalized = normalizeLobbyCode(code);
  if (!isValidLobbyCode(normalized)) return null;
  if (memoryStoreEnabled()) {
    const lobby = memoryLobbies.get(normalized) ?? null;
    if (lobby && isLobbyExpired(lobby)) {
      memoryLobbies.delete(normalized);
      return null;
    }
    return lobby;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", normalized)
      .maybeSingle();
    const lobby = data?.data as unknown as RaceLobby | undefined;
    if (!lobby || isLobbyExpired(lobby)) return null;
    return lobby;
  } catch {
    return null;
  }
}

/**
 * A public (RLS) read for the polling client. The browser cannot use the service
 * key, and `app_docs` is readable by anyone, so this is the read the UI uses.
 */
export async function readLobbyPublic(code: string): Promise<RaceLobby | null> {
  const normalized = normalizeLobbyCode(code);
  if (!isValidLobbyCode(normalized)) return null;
  if (memoryStoreEnabled()) return readLobby(normalized);
  try {
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", normalized)
      .maybeSingle();
    if (error) return null;
    const lobby = data?.data as unknown as RaceLobby | undefined;
    if (!lobby || isLobbyExpired(lobby)) return null;
    return lobby;
  } catch {
    return null;
  }
}

/** Write a lobby back, and return it. */
export async function saveLobby(lobby: RaceLobby): Promise<RaceLobby> {
  if (memoryStoreEnabled()) {
    memoryLobbies.set(lobby.code, lobby);
    return lobby;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: lobby.code,
      data: lobby as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  return lobby;
}

/** Find a free lobby code, avoiding the ones already taken. */
export async function allocateLobbyCode(
  makeCode: () => string,
  attempts = 8,
): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const code = makeCode();
    if (!(await readLobby(code))) return code;
  }
  return null;
}
