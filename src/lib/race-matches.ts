/**
 * The browser's side of the 1v1 race archive: the shapes the API returns and the
 * one call that fetches recent matches for the "Recent matches" view.
 *
 * A match is built server-side from a settled lobby, so this file only reads.
 */
import type { RaceModeId } from "@/lib/race-modes";

export interface RaceMatchPlayer {
  username: string;
  /** Per-round times in round order; null is a round they never ran. */
  timesMs: Array<number | null>;
  roundsWon: number;
  totalMs: number | null;
  droppedSlowest: boolean;
}

export interface RaceMatch {
  code: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  mode: RaceModeId;
  modeName: string;
  players: string[];
  perPlayer: RaceMatchPlayer[];
  playedAt: string;
  winner: string | null;
  tie: boolean;
}

/** The most recent finished matches, newest first. */
export async function fetchRecentMatches(limit = 50): Promise<RaceMatch[]> {
  const res = await fetch(`/api/race-matches?limit=${encodeURIComponent(limit)}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const body = (await res.json()) as { matches?: RaceMatch[] };
  return Array.isArray(body.matches) ? body.matches : [];
}
