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

  if (!options.deep) return asList(await fetchJson(base, TTL));

  // Fetch the overall board and every arrow board at once — doing the overall
  // request first made deep loads twice as slow for no extra data.
  const [overall, ...arrowBoards] = await Promise.all([
    fetchJson(base, TTL)
      .then(asList)
      .catch(() => [] as BoardEntry[]),
    ...ARROWS.map((arrow) =>
      fetchJson(`${base}&arrowFilter=${encodeURIComponent(arrow)}`, TTL)
        .then(asList)
        .catch(() => [] as BoardEntry[]),
    ),
  ]);

  const merged = new Map<string, BoardEntry>();
  const add = (entries: BoardEntry[]) => {
    for (const entry of entries) {
      const key = String(entry.run_id ?? `${entry.username}-${entry.completion_time}`);
      if (!merged.has(key)) merged.set(key, entry);
    }
  };
  add(overall);
  arrowBoards.forEach(add);

  return [...merged.values()].sort((a, b) => a.completion_time - b.completion_time);
}

