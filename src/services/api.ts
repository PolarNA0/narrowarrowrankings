import { LeaderboardEntry } from "../types";

const BASE_URL = "/api/leaderboard";

interface CacheEntry {
  data: LeaderboardEntry[];
  timestamp: number;
}

const leaderboardCache: Record<string, CacheEntry> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

export async function fetchLeaderboard(levelId: string, forceRefresh = false): Promise<LeaderboardEntry[]> {
  const now = Date.now();
  if (!forceRefresh && leaderboardCache[levelId] && (now - leaderboardCache[levelId].timestamp < CACHE_TTL)) {
    return leaderboardCache[levelId].data;
  }

  const encodedLevel = encodeURIComponent(levelId);
  const response = await fetch(`${BASE_URL}/${encodedLevel}?infiniteLeaderboard=true`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard for ${levelId}`);
  }
  
  const data = await response.json();
  
  // Save to cache
  leaderboardCache[levelId] = {
    data,
    timestamp: now
  };
  
  return data;
}
