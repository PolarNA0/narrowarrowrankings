export interface LeaderboardEntry {
  run_id: number;
  completion_time: number;
  username: string;
  arrow_name: string;
  created_at: string;
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

export interface LevelRankConfig {
  ranks: Record<string, RankInfo>;
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
