/**
 * Client helpers for the community TAS board (see
 * `src/routes/api/tas-leaderboard.$level.ts`). TAS runs are site-owned records
 * — they never touch the real game leaderboard, so a tool-assisted time can be
 * shared without hurting anyone's official ranking.
 */

export interface TasEntry {
  id: string;
  username: string;
  timeMs: number;
  arrowName: string;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface TasSubmitResult {
  isRecord: boolean;
  rank: number;
  entries: TasEntry[];
}

/** A TAS entry without its input string, as returned by the bulk feed. */
export type TasSummary = Omit<TasEntry, "inputs">;

/**
 * Boards are read by several views at once (leaderboard, editor, brute seed
 * picker, main leaderboard's "best TAS time" card) and every read is a full
 * round trip carrying each run's input blob. A short TTL plus in-flight de-dupe
 * collapses those into one request per level per window, and a successful
 * submit/delete/rename invalidates the level so the board never shows stale
 * rows after a write.
 */
const BOARD_TTL_MS = 30_000;
const boardCache = new Map<string, { at: number; entries: TasEntry[] }>();
const boardInflight = new Map<string, Promise<TasEntry[]>>();
const summaryCache = new Map<string, { at: number; entries: TasSummary[] }>();
const summaryInflight = new Map<string, Promise<TasSummary[]>>();

/** Drop one level's cached board (or all of them) after a write. */
export function invalidateTasBoard(levelId?: string): void {
  if (levelId) {
    boardCache.delete(levelId);
    summaryCache.delete(levelId);
  } else {
    boardCache.clear();
    summaryCache.clear();
  }
}

export async function fetchTasBoard(levelId: string, options: { force?: boolean } = {}) {
  const hit = boardCache.get(levelId);
  if (!options.force && hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.entries;

  const pending = boardInflight.get(levelId);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(`/api/tas-leaderboard/${encodeURIComponent(levelId)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`TAS board request failed (${res.status})`);
    const entries = (await res.json()) as TasEntry[];
    boardCache.set(levelId, { at: Date.now(), entries });
    return entries;
  })();

  boardInflight.set(levelId, request);
  try {
    return await request;
  } finally {
    boardInflight.delete(levelId);
  }
}

/**
 * The board without its input blobs. The main leaderboard only renders the best
 * time and the tracker only needs names/times, so this avoids downloading a
 * base64 input stream per run for a single number. Watchers and the editor use
 * `fetchTasBoard`, which does carry the inputs.
 */
export async function fetchTasBoardSummary(levelId: string): Promise<TasSummary[]> {
  const hit = summaryCache.get(levelId);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.entries;

  const pending = summaryInflight.get(levelId);
  if (pending) return pending;

  const request = (async () => {
    const res = await fetch(`/api/tas-leaderboard/${encodeURIComponent(levelId)}?summary=1`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`TAS board request failed (${res.status})`);
    const entries = (await res.json()) as TasSummary[];
    summaryCache.set(levelId, { at: Date.now(), entries });
    return entries;
  })();

  summaryInflight.set(levelId, request);
  try {
    return await request;
  } finally {
    summaryInflight.delete(levelId);
  }
}

/**
 * One entry *with* its input string. The board list is fetched without inputs
 * (see `fetchTasBoardSummary`), so a viewer pulls the single stream it is about
 * to play through this instead of paying for every run's blob up front.
 */
export async function fetchTasEntry(levelId: string, entryId: string): Promise<TasEntry | null> {
  const cached = boardCache.get(levelId)?.entries.find((e) => e.id === entryId);
  if (cached) return cached;
  try {
    const res = await fetch(
      `/api/tas-leaderboard/${encodeURIComponent(levelId)}?entry=${encodeURIComponent(entryId)}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!res.ok) return null;
    return (await res.json()) as TasEntry;
  } catch {
    return null;
  }
}

/**
 * Every level's TAS board in one request, keyed by level id. The record tracker
 * folds these into its timeline alongside the real-game runs, so a TAS upload
 * shows up as an event rather than only living on its own board.
 */
export async function fetchAllTasBoards(): Promise<Record<string, TasSummary[]>> {
  const res = await fetch("/api/tas-leaderboards", {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TAS boards request failed (${res.status})`);
  return (await res.json()) as Record<string, TasSummary[]>;
}

export async function submitTasRun(payload: {
  levelId: string;
  username: string;
  arrowName: string;
  timeMs: number;
  inputs: string;
  inputCount: number;
}): Promise<TasSubmitResult> {
  const res = await fetch(`/api/tas-leaderboard/${encodeURIComponent(payload.levelId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as TasSubmitResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Submit failed (${res.status})`);
  invalidateTasBoard(payload.levelId);
  return data;
}

export async function removeTasRun(levelId: string, id: string): Promise<TasEntry[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(
    `/api/tas-leaderboard/${encodeURIComponent(levelId)}?id=${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = (await res.json()) as { entries?: TasEntry[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Remove failed (${res.status})`);
  invalidateTasBoard(levelId);
  return data.entries ?? [];
}

/** Admin-only: change the owner name shown for an existing entry. */
export async function renameTasRun(
  levelId: string,
  id: string,
  username: string,
): Promise<TasEntry[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(
    `/api/tas-leaderboard/${encodeURIComponent(levelId)}?id=${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ username }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = (await res.json()) as { entries?: TasEntry[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Rename failed (${res.status})`);
  invalidateTasBoard(levelId);
  return data.entries ?? [];
}

/** The level's fastest TAS time in ms, or null when the board is empty. */
export async function fetchBestTasTime(levelId: string): Promise<number | null> {
  const entries = await fetchTasBoardSummary(levelId);
  return entries.length > 0 ? Math.min(...entries.map((e) => e.timeMs)) : null;
}
