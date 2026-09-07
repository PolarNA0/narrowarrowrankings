import { fetchJson } from "./na-proxy";

// Upstream hard-caps a leaderboard request at 150 rows and ignores offsets, but
// each arrow has its own board — merging them surfaces players far outside the
// global top 150.
const MAX_LIMIT = 150;
const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"];
const TTL = 150 * 1000;

export interface BoardEntry {
  run_id: number;
  completion_time: number;
  username: string;
  arrow_name?: string;
  created_at?: string;
  replay_available?: number;
  is_verifier?: boolean;
}

function asList(payload: unknown): BoardEntry[] {
  return Array.isArray(payload) ? (payload as BoardEntry[]) : [];
}

/** Fetch a level board, optionally merging every arrow board for full depth. */
export async function fetchLevelBoard(
  levelId: string,
  options: { deep?: boolean; arrowFilter?: string } = {},
): Promise<BoardEntry[]> {
  const base = `/leaderboard?levelId=${encodeURIComponent(levelId)}&limit=${MAX_LIMIT}`;

  if (options.arrowFilter) {
    return asList(await fetchJson(`${base}&arrowFilter=${encodeURIComponent(options.arrowFilter)}`, TTL));
  }

  const overall = asList(await fetchJson(base, TTL));
  if (!options.deep) return overall;

  const merged = new Map<string, BoardEntry>();
  const add = (entries: BoardEntry[]) => {
    for (const entry of entries) {
      const key = String(entry.run_id ?? `${entry.username}-${entry.completion_time}`);
      if (!merged.has(key)) merged.set(key, entry);
    }
  };
  add(overall);

  const arrowBoards = await Promise.all(
    ARROWS.map(async (arrow) => {
      try {
        return asList(await fetchJson(`${base}&arrowFilter=${encodeURIComponent(arrow)}`, TTL));
      } catch {
        return [];
      }
    }),
  );
  arrowBoards.forEach(add);

  return [...merged.values()].sort((a, b) => a.completion_time - b.completion_time);
}
