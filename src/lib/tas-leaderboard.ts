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

export async function fetchTasBoard(levelId: string): Promise<TasEntry[]> {
  const res = await fetch(`/api/tas-leaderboard/${encodeURIComponent(levelId)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`TAS board request failed (${res.status})`);
  return (await res.json()) as TasEntry[];
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
