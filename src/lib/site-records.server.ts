/**
 * Aggregate view over site levels and their leaderboards: one row per level
 * carrying its record run. The site level browser already shows a level's own
 * board, but there was no single place to see every site level's record side by
 * side, which is what the "Site level records" section is for.
 */
import { listSiteLevels } from "@/lib/site-levels.server";
import { readSiteScores, sortSiteScores } from "@/lib/site-scores.server";

export interface SiteRecord {
  levelId: string;
  levelName: string;
  author: string;
  /** The level's suggested arrow (a hint, not a restriction). */
  arrowName: string;
  hasCustomMechanics: boolean;
  obstacleCount: number;
  completions: number;
  /** The fastest run's fields, or null when the level has no submissions. */
  holder: string | null;
  timeMs: number | null;
  holderArrow: string | null;
  inputCount: number | null;
  achievedAt: string | null;
}

/** Every site level with its record run, fastest first (unfinished levels last). */
export async function listSiteRecords(): Promise<SiteRecord[]> {
  const levels = await listSiteLevels();
  const rows = await Promise.all(
    levels.map(async (level): Promise<SiteRecord> => {
      const entries = sortSiteScores(await readSiteScores(level.id));
      const top = entries[0] ?? null;
      return {
        levelId: level.id,
        levelName: level.name,
        author: level.author,
        arrowName: level.arrowName,
        hasCustomMechanics: level.hasCustomMechanics,
        obstacleCount: level.obstacleCount,
        completions: level.completions,
        holder: top?.username ?? null,
        timeMs: top?.timeMs ?? null,
        holderArrow: top?.arrowName ?? null,
        inputCount: top?.inputCount ?? null,
        achievedAt: top?.createdAt ?? null,
      };
    }),
  );
  return rows.sort((a, b) => {
    if (a.timeMs === null && b.timeMs === null) return a.levelName.localeCompare(b.levelName);
    if (a.timeMs === null) return 1;
    if (b.timeMs === null) return -1;
    return a.timeMs - b.timeMs;
  });
}
