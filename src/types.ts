export interface LeaderboardEntry {
  run_id: number;
  completion_time: number;
  username: string;
  arrow_name: string;
  created_at: string;
  replay_available?: number;
  isLegacy?: boolean;
  originalRank?: number;
}

export interface LegacyRun {
  id: string;
  levelId: string;
  username: string;
  completionTime: number;
  createdAt?: string;
  proofUrl?: string;
  addedAt?: string;
  addedBy?: string;
  arrow_name?: string;
  arrowId?: string;
}

export interface NameChange {
  id?: string;
  oldName: string;
  newName: string;
  timestamp: string;
}

export type RankName = 
  | "Champion" 
  | "Elite" 
  | "Legend" 
  | "Expert" 
  | "Master" 
  | "Pro" 
  | "Skilled" 
  | "Average" 
  | "Beginner"
  | "Beginner+";

export interface RankInfo {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
  timeCutoff: number; // Time in seconds that the player must be faster than
}

export type ArrowScope = "Narrow Arrow" | "Speedy Arrow" | "Energy Arrow";

export interface LevelRankConfig {
  ranks: Record<string, RankInfo>;
  /** Optional per-arrow cutoff overrides: arrowRanks["Narrow Arrow"]["Champion"] = 12.5 */
  arrowRanks?: Partial<Record<ArrowScope, Record<string, number>>>;
  theoreticalMax?: number;
  humanLimit?: number;
  updatedAt: any;
}

export interface LevelInfo {
  id: string;
  name: string;
  gameOrder: number;
  packId: string;
}

/**
 * In-game medal thresholds for a level, straight from the game API. The game's
 * "top" tier is what players see as the Diamond medal; the other three are
 * Gold / Silver / Bronze. Times are seconds; a run earns the tier when its
 * completion time is at or below the cutoff.
 */
export interface InGameMedals {
  bronzeTime: number;
  silverTime: number;
  goldTime: number;
  topTime: number;
  official: boolean;
  finisherCount: number;
}

export interface LevelPack {
  id: string;
  name: string;
}

export interface PlayerLevelStats {
  levelId: string;
  levelName: string;
  bestTime: number;
  rankId: string;
  arrowName: string;
  date: string;
}

export interface PlayerStats {
  username: string;
  levels: Record<string, PlayerLevelStats>;
  averageTime: number;
  totalLevels: number;
  bestRank: string;
}
