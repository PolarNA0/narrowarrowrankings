import { LeaderboardEntry } from "../types";

const BASE_URL = "/api/leaderboard";

interface CacheEntry {
  data: LeaderboardEntry[];
  timestamp: number;
}

const leaderboardCache: Record<string, CacheEntry> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
const inflight: Record<string, Promise<LeaderboardEntry[]>> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestLeaderboard(levelId: string): Promise<LeaderboardEntry[]> {
  const encodedLevel = encodeURIComponent(levelId);
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${BASE_URL}/${encodedLevel}?infiniteLeaderboard=true`);
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
): Promise<LeaderboardEntry[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    leaderboardCache[levelId] &&
    now - leaderboardCache[levelId].timestamp < CACHE_TTL
  ) {
    return leaderboardCache[levelId].data;
  }

  const pending = inflight[levelId] as Promise<LeaderboardEntry[]> | undefined;
  if (pending) return pending;
  const promise = requestLeaderboard(levelId).finally(() => {
    delete inflight[levelId];
  });
  inflight[levelId] = promise;
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
