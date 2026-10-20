/**
 * Client helpers for the endless-mode board (see
 * `src/routes/api/endless-leaderboard.ts`). Scores are site-owned: a run against
 * a generated course never touches the real game leaderboard.
 *
 * There is one global board — the score is sections survived, a measure of the
 * player rather than of a course — so no helper here is keyed by seed.
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
 * (the board list, the best-score card) into one request per window; a write
 * invalidates the cache so the board never shows stale rows.
 */
const BOARD_TTL_MS = 30_000;
let boardCache: { at: number; entries: EndlessEntry[] } | null = null;
let boardInflight: Promise<EndlessEntry[]> | null = null;

export function invalidateEndlessBoard(): void {
  boardCache = null;
}

export async function fetchEndlessBoard(
  options: { force?: boolean } = {},
): Promise<EndlessEntry[]> {
  if (!options.force && boardCache && Date.now() - boardCache.at < BOARD_TTL_MS) {
    return boardCache.entries;
  }
  if (boardInflight) return boardInflight;

  const request = (async () => {
    try {
      const res = await fetch("/api/endless-leaderboard");
      if (!res.ok) return [];
      const data = (await res.json()) as EndlessEntry[];
      const entries = Array.isArray(data) ? data : [];
      boardCache = { at: Date.now(), entries };
      return entries;
    } catch {
      return [];
    } finally {
      boardInflight = null;
    }
  })();

  boardInflight = request;
  return request;
}

/** The best score on the board, or null when it is empty. */
export async function fetchBestEndlessScore(): Promise<number | null> {
  const entries = await fetchEndlessBoard();
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
  const res = await fetch("/api/endless-leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<EndlessSubmitResult> & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "Could not submit that run.");
  invalidateEndlessBoard();
  return data as EndlessSubmitResult;
}

export async function deleteEndlessEntry(id: string): Promise<EndlessEntry[]> {
  const res = await fetch(`/api/endless-leaderboard?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const data = (await res.json().catch(() => ({}))) as { entries?: EndlessEntry[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not remove that run.");
  invalidateEndlessBoard();
  return data.entries ?? [];
}
