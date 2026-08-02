import { LeaderboardEntry } from "../types";

const BASE_URL = "/api/leaderboard";
const CACHE_TTL = 5 * 60 * 1000;
const PERSIST_KEY = "naLeaderboardCache";
const PERSIST_TTL = 30 * 60 * 1000;

interface CacheEntry {
  data: LeaderboardEntry[];
  timestamp: number;
}

const leaderboardCache: Record<string, CacheEntry> = {};
const inflight: Record<string, Promise<LeaderboardEntry[]>> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Warm the in-memory cache from localStorage so revisits paint instantly. */
export function hydratePersistedLeaderboards(): Record<string, LeaderboardEntry[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { timestamp: number; boards: Record<string, LeaderboardEntry[]> };
    if (!parsed?.boards || Date.now() - parsed.timestamp > PERSIST_TTL) return {};
    for (const [id, entries] of Object.entries(parsed.boards)) {
      leaderboardCache[id] = { data: entries, timestamp: parsed.timestamp };
    }
    return parsed.boards;
  } catch {
    return {};
  }
}

export function persistLeaderboards(boards: Record<string, LeaderboardEntry[]>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ timestamp: Date.now(), boards }));
  } catch {
    /* quota — caching is best effort */
  }
}

/** Fetch every official leaderboard in a single warmed request. */
export async function fetchAllLeaderboards(
  deep = false,
): Promise<Record<string, LeaderboardEntry[]>> {
  const res = await fetch(`/api/all-leaderboards${deep ? "?deep=1" : ""}`);
  if (!res.ok) throw new Error(`Bulk leaderboard request failed (${res.status})`);
  const payload = (await res.json()) as { boards: Record<string, LeaderboardEntry[]> };
  const boards = payload.boards ?? {};
  const now = Date.now();
  for (const [id, entries] of Object.entries(boards)) {
    if (entries?.length) leaderboardCache[id] = { data: entries, timestamp: now };
  }
  return boards;
}

async function requestLeaderboard(levelId: string, deep: boolean): Promise<LeaderboardEntry[]> {
  const encodedLevel = encodeURIComponent(levelId);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${BASE_URL}/${encodedLevel}${deep ? "?deep=1" : ""}`);
    if (response.ok) {
      const data = await response.json();
      leaderboardCache[levelId] = { data, timestamp: Date.now() };
      return data;
    }
    lastStatus = response.status;
    if (response.status !== 502 && response.status !== 429) break;
    await sleep(500 * 2 ** attempt + Math.random() * 250);
  }
  // Fall back to stale cached data instead of blowing up the UI.
  if (leaderboardCache[levelId]) return leaderboardCache[levelId].data;
  throw new Error(`Failed to fetch leaderboard for ${levelId} (status ${lastStatus})`);
}

export async function fetchLeaderboard(
  levelId: string,
  forceRefresh = false,
  deep = false,
): Promise<LeaderboardEntry[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    leaderboardCache[levelId] &&
    now - leaderboardCache[levelId].timestamp < CACHE_TTL
  ) {
    return leaderboardCache[levelId].data;
  }

  const key = `${levelId}:${deep ? "deep" : "flat"}`;
  const pending = inflight[key] as Promise<LeaderboardEntry[]> | undefined;
  if (pending) return pending;
  const promise = requestLeaderboard(levelId, deep).finally(() => {
    delete inflight[key];
  });
  inflight[key] = promise;
  return promise;
}

/** Runs async tasks with a bounded concurrency so the upstream API isn't flooded. */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit = 4,
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}
