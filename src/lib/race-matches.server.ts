/**
 * The durable archive of finished 1v1 races.
 *
 * A lobby is transient — it lives in `app_docs` under its code and is dropped
 * after `LOBBY_TTL_MS`, so once the code expires the match is gone. This module
 * keeps the result: when a lobby settles, `archiveMatch` writes one document per
 * lobby code recording who played, the mode, every round's times, the date, and
 * the winner. The "Recent matches" view reads these back.
 *
 * The winner is re-derived here with the same pure `scoreRace` the lobby used, so
 * an archived match can never disagree with the lobby it came from. Archiving is
 * idempotent per code: re-settling an already-archived lobby returns the existing
 * entry rather than writing a second copy.
 */
import { raceMode, scoreRace, type RaceModeId, type RaceRun } from "@/lib/race-modes";

/** One player's rounds in an archived match, ready to render. */
export interface RaceMatchPlayer {
  username: string;
  /** Per-round times in round order; null is a round they never ran. */
  timesMs: Array<number | null>;
  roundsWon: number;
  /** Sum of the counting runs (endurance), or null when they have none. */
  totalMs: number | null;
  droppedSlowest: boolean;
}

export interface RaceMatch {
  /** The lobby code the match was played under; the archive key. */
  code: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  mode: RaceModeId;
  modeName: string;
  /** Both players, in a stable order (host first, then the joiner). */
  players: string[];
  perPlayer: RaceMatchPlayer[];
  /** When the match was settled. */
  playedAt: string;
  winner: string | null;
  /** True only when a decision was reached and shared by more than one player. */
  tie: boolean;
}

/** How many archived matches to keep; older ones are pruned so the doc set stays small. */
export const RACE_MATCH_KEEP = 500;
/** How many to return to the browser by default. */
export const RACE_MATCH_PAGE = 50;

const COLLECTION = "race_matches";
const INDEX_DOC = "_index";

const memoryMatches = new Map<string, RaceMatch>();
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Test hook: clear the in-memory archive between checks. */
export function clearMemoryMatches() {
  memoryMatches.clear();
}

/**
 * Build an archive entry from a settled lobby. Pure, so the shape can be tested
 * without a store: it re-runs `scoreRace` over the runs and lays the per-round
 * times out by round, which is what the table wants to render.
 */
export function buildRaceMatch(input: {
  code: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  mode: string;
  players: string[];
  runs: RaceRun[];
  playedAt: string;
}): RaceMatch {
  const mode = raceMode(input.mode);
  const result = scoreRace(input.mode, input.players, input.runs);
  const perPlayer: RaceMatchPlayer[] = result.players.map((username) => {
    const standing = result.standings.find((s) => s.username === username);
    const timesMs = Array.from({ length: mode.rounds }, (_, round) => {
      const runs = input.runs.filter(
        (r) => r.username === username && r.round === round && r.finished !== false,
      );
      if (runs.length === 0) return null;
      return runs.reduce((best, r) => (r.timeMs < best.timeMs ? r : best)).timeMs;
    });
    return {
      username,
      timesMs,
      roundsWon: standing?.roundsWon ?? 0,
      totalMs: standing?.totalMs ?? null,
      droppedSlowest: standing?.droppedSlowest ?? false,
    };
  });
  return {
    code: input.code,
    levelId: input.levelId,
    levelName: input.levelName,
    arrowName: input.arrowName,
    mode: mode.id,
    modeName: mode.name,
    players: result.players,
    perPlayer,
    playedAt: input.playedAt,
    winner: result.winner,
    tie: result.tie,
  };
}

async function readIndex(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_docs")
    .select("data")
    .eq("collection", COLLECTION)
    .eq("doc_id", INDEX_DOC)
    .maybeSingle();
  const codes = (data?.data as { codes?: unknown } | undefined)?.codes;
  return Array.isArray(codes) ? (codes as string[]).filter((c) => typeof c === "string") : [];
}

async function writeIndex(codes: string[]): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: INDEX_DOC,
      data: { codes } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
}

/**
 * Write one match to the archive, newest-first, and prune past `RACE_MATCH_KEEP`.
 * Idempotent: archiving a code that is already stored returns the stored entry,
 * so a re-settled lobby cannot create a duplicate row.
 */
export async function archiveMatch(match: RaceMatch): Promise<RaceMatch> {
  if (memoryStoreEnabled()) {
    const existing = memoryMatches.get(match.code);
    if (existing) return existing;
    memoryMatches.set(match.code, match);
    while (memoryMatches.size > RACE_MATCH_KEEP) {
      const oldest = memoryMatches.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      memoryMatches.delete(oldest);
    }
    return match;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const existing = await readMatch(match.code);
  if (existing) return existing;

  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: match.code,
      data: match as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);

  const codes = [match.code, ...(await readIndex()).filter((c) => c !== match.code)];
  const keep = codes.slice(0, RACE_MATCH_KEEP);
  const dropped = codes.slice(RACE_MATCH_KEEP);
  await writeIndex(keep);
  if (dropped.length > 0) {
    await supabaseAdmin
      .from("app_docs")
      .delete()
      .eq("collection", COLLECTION)
      .in("doc_id", dropped);
  }
  return match;
}

/** Read one archived match by its lobby code. */
export async function readMatch(code: string): Promise<RaceMatch | null> {
  if (memoryStoreEnabled()) return memoryMatches.get(code) ?? null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", code)
      .maybeSingle();
    return (data?.data as unknown as RaceMatch | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * The most recent matches, newest first. The index is the source of order; a
 * code whose document has been pruned is skipped rather than returned as a hole.
 */
export async function readRecentMatches(limit = RACE_MATCH_PAGE): Promise<RaceMatch[]> {
  const bounded = Math.max(1, Math.min(limit, RACE_MATCH_KEEP));
  if (memoryStoreEnabled()) {
    // Insertion order is oldest-first, so reverse for newest-first.
    return [...memoryMatches.values()].reverse().slice(0, bounded);
  }
  try {
    const codes = (await readIndex()).slice(0, bounded);
    if (codes.length === 0) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("doc_id, data")
      .eq("collection", COLLECTION)
      .in("doc_id", codes);
    const byCode = new Map<string, RaceMatch>();
    for (const row of data ?? []) {
      byCode.set(row.doc_id as string, row.data as unknown as RaceMatch);
    }
    return codes.map((c) => byCode.get(c)).filter((m): m is RaceMatch => Boolean(m));
  } catch {
    return [];
  }
}
