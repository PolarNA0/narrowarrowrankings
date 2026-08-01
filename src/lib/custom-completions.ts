import { fetchJson } from "./na-proxy";

export interface CompletionRow {
  username: string;
  first: number;
  second: number;
  third: number;
  top10: number;
  completed: number;
  points: number;
}

export interface CompletionsSnapshot {
  done: boolean;
  loaded: number;
  total: number;
  updatedAt: number;
  levels: Array<{ id: string; name: string; creator: string }>;
  players: CompletionRow[];
}

interface Job {
  startedAt: number;
  done: boolean;
  loaded: number;
  total: number;
  levels: Array<{ id: string; name: string; creator: string }>;
  players: Map<string, CompletionRow>;
}

const REFRESH_MS = 30 * 60 * 1000;
const PAGE_SIZE = 10;

let job: Job | null = null;
let running = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function listOf(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.levels || payload.results || [];
}

function bump(row: CompletionRow, place: number) {
  row.completed += 1;
  if (place === 1) row.first += 1;
  else if (place === 2) row.second += 1;
  else if (place === 3) row.third += 1;
  if (place <= 10) row.top10 += 1;
  row.points += place === 1 ? 10 : place === 2 ? 6 : place === 3 ? 4 : place <= 10 ? 2 : 1;
}

async function runJob(pages: number) {
  const state: Job = {
    startedAt: Date.now(),
    done: false,
    loaded: 0,
    total: pages * PAGE_SIZE,
    levels: [],
    players: new Map(),
  };
  job = state;

  try {
    const levels: Array<{ id: string; name: string; creator: string }> = [];
    for (let page = 0; page < pages; page++) {
      try {
        const payload = await fetchJson(`/published-levels?filter=popular&page=${page}`, 10 * 60 * 1000);
        for (const raw of listOf(payload)) {
          const id = String(raw.level_id ?? raw.levelKey ?? raw.id ?? "");
          if (!id || levels.some((l) => l.id === id)) continue;
          levels.push({
            id,
            name: raw.name ?? raw.data?.map_name ?? `Level ${id}`,
            creator: raw.creator_name ?? raw.author ?? raw.username ?? "Unknown",
          });
        }
      } catch (error) {
        console.error("custom-completions: page failed", page, error);
      }
      state.levels = levels;
      state.total = levels.length || state.total;
    }

    for (const level of levels) {
      try {
        const rows = listOf(
          await fetchJson(`/leaderboard?levelId=${encodeURIComponent(level.id)}&limit=150`, 15 * 60 * 1000),
        );
        const best = new Map<string, number>();
        for (const entry of rows) {
          const name = String(entry.username ?? "").trim();
          const time = Number(entry.completion_time);
          if (!name || !Number.isFinite(time)) continue;
          const current = best.get(name.toLowerCase());
          if (current === undefined || time < current) best.set(name.toLowerCase(), time);
        }
        const times = [...best.values()].sort((a, b) => a - b);
        for (const entry of rows) {
          const name = String(entry.username ?? "").trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const time = best.get(key);
          if (time === undefined) continue;
          if (state.players.has(key) && state.players.get(key)!.completedLevel === level.id) continue;
          const place = times.findIndex((t) => t >= time - 1e-9) + 1;
          let row = state.players.get(key);
          if (!row) {
            row = { username: name, first: 0, second: 0, third: 0, top10: 0, completed: 0, points: 0 };
            state.players.set(key, row);
          }
          if (row.completedLevel === level.id) continue;
          row.completedLevel = level.id;
          bump(row, place);
        }
      } catch (error) {
        console.error("custom-completions: level failed", level.id, error);
      }
      state.loaded += 1;
    }
  } finally {
    state.done = true;
    running = false;
  }
}

export function getCustomCompletions(pages = 6): CompletionsSnapshot {
  const stale = !job || (job.done && Date.now() - job.startedAt > REFRESH_MS);
  if (stale && !running) {
    running = true;
    void runJob(pages);
  }
  const state = job!;
  const players = [...state.players.values()].sort(
    (a, b) =>
      b.first - a.first ||
      b.second - a.second ||
      b.third - a.third ||
      b.top10 - a.top10 ||
      b.completed - a.completed,
  );
  return {
    done: state.done,
    loaded: state.loaded,
    total: state.total,
    updatedAt: state.startedAt,
    levels: state.levels,
    players,
  };
}
