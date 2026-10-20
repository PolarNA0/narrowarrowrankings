/**
 * Client helpers for the endless-mode board (see
 * `src/routes/api/endless-leaderboard.$seed.ts`). Scores are site-owned: a run
 * against a generated course never touches the real game leaderboard.
 */

export interface EndlessEntry {
  id: string;
  username: string;
  seed: number;
  arrowName: string;
  score: number;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface EndlessSubmitResult {
  isRecord: boolean;
  rank: number;
  entries: EndlessEntry[];
}

/** An endless entry without its input string. */
export type EndlessSummary = Omit<EndlessEntry, "inputs">;

/**
 * A short TTL plus in-flight de-dupe collapses the several reads a view makes
 * (the board list, the best-score card) into one request per seed per window;
 * a write invalidates the seed so the board never shows stale rows.
 */
const BOARD_TTL_MS = 30_000;
const boardCache = new Map<string, { at: number; entries: EndlessEntry[] }>();
const boardInflight = new Map<string, Promise<EndlessEntry[]>>();

export function invalidateEndlessBoard(seed?: string): void {
  if (seed) boardCache.delete(seed);
  else boardCache.clear();
}

export async function fetchEndlessBoard(
  seed: string,
  options: { force?: boolean } = {},
): Promise<EndlessEntry[]> {
  const hit = boardCache.get(seed);
  if (!options.force && hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.entries;

  const pending = boardInflight.get(seed);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(`/api/endless-leaderboard/${encodeURIComponent(seed)}`);
      if (!res.ok) return [];
      const data = (await res.json()) as EndlessEntry[];
      const entries = Array.isArray(data) ? data : [];
      boardCache.set(seed, { at: Date.now(), entries });
      return entries;
    } catch {
      return [];
    } finally {
      boardInflight.delete(seed);
    }
  })();

  boardInflight.set(seed, request);
  return request;
}

/** The best score on a seed, or null when the board is empty. */
export async function fetchBestEndlessScore(seed: string): Promise<number | null> {
  const entries = await fetchEndlessBoard(seed);
  if (entries.length === 0) return null;
  return entries.reduce((best, e) => Math.max(best, e.score), 0);
}

export async function submitEndlessRun(payload: {
  seed: string;
  username: string;
  arrowName: string;
  score: number;
  inputs: string;
  inputCount: number;
}): Promise<EndlessSubmitResult> {
  const res = await fetch(`/api/endless-leaderboard/${encodeURIComponent(payload.seed)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<EndlessSubmitResult> & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Could not submit that run.");
  invalidateEndlessBoard(payload.seed);
  return data as EndlessSubmitResult;
}

export async function deleteEndlessEntry(seed: string, id: string): Promise<EndlessEntry[]> {
  const res = await fetch(
    `/api/endless-leaderboard/${encodeURIComponent(seed)}?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  const data = (await res.json().catch(() => ({}))) as { entries?: EndlessEntry[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not remove that run.");
  invalidateEndlessBoard(seed);
  return data.entries ?? [];
}
