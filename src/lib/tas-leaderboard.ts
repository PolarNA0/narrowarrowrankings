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

export async function fetchTasBoard(levelId: string): Promise<TasEntry[]> {
  const res = await fetch(`/api/tas-leaderboard/${encodeURIComponent(levelId)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TAS board request failed (${res.status})`);
  return (await res.json()) as TasEntry[];
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
  return data.entries ?? [];
}

/** The level's fastest TAS time in ms, or null when the board is empty. */
export async function fetchBestTasTime(levelId: string): Promise<number | null> {
  const entries = await fetchTasBoard(levelId);
  return entries.length > 0 ? Math.min(...entries.map((e) => e.timeMs)) : null;
}
