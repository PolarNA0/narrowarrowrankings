/**
 * Client helpers for site levels and their leaderboards (see
 * `src/routes/api/site-levels*.ts`). A site level is a community level authored
 * with the Level editor that may use the site-only wind/suction mechanics; the
 * site hosts it and owns its leaderboard, since the game's engine cannot run
 * those fields.
 */
import type { SiteLevelRecord, SiteLevelSummary } from "@/lib/site-levels.server";
import type { RawLevelData } from "@/lib/replay-sim";

export type { SiteLevelRecord, SiteLevelSummary };

/** The engine payload for a stored level, ready to hand to the physics layer. */
export function siteLevelToRawData(record: SiteLevelRecord): RawLevelData {
  return {
    map_name: record.data.map_name,
    game_mode: record.data.game_mode,
    obstacles: record.data.obstacles as RawLevelData["obstacles"],
  };
}

export interface SiteScoreEntry {
  id: string;
  username: string;
  timeMs: number;
  arrowName: string;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface SiteSubmitResult {
  isRecord: boolean;
  /** False when the player already holds a faster run, so this one is not their row. */
  isPersonalBest: boolean;
  rank: number;
  entries: SiteScoreEntry[];
}

export interface SiteRecord {
  levelId: string;
  levelName: string;
  author: string;
  arrowName: string;
  hasCustomMechanics: boolean;
  obstacleCount: number;
  completions: number;
  holder: string | null;
  timeMs: number | null;
  holderArrow: string | null;
  inputCount: number | null;
  achievedAt: string | null;
}

/** Every site level with its record run, fastest first. */
export async function fetchSiteRecords(): Promise<SiteRecord[]> {
  const res = await fetch("/api/site-records", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Site records request failed (${res.status})`);
  const data = (await res.json()) as { records?: SiteRecord[] };
  return data.records ?? [];
}

/** Every published site level, newest first. */
export async function fetchSiteLevels(): Promise<SiteLevelSummary[]> {
  const res = await fetch("/api/site-levels", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Site levels request failed (${res.status})`);
  const data = (await res.json()) as { levels?: SiteLevelSummary[] };
  return data.levels ?? [];
}

/** One level's full payload, for Play and the replay viewer. */
export async function fetchSiteLevel(id: string): Promise<SiteLevelRecord | null> {
  const res = await fetch(`/api/site-levels/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Site level request failed (${res.status})`);
  const data = (await res.json()) as { level?: SiteLevelRecord };
  return data.level ?? null;
}

/** Publish a level. Returns the new summary and the full listing. */
export async function publishSiteLevel(payload: {
  name: string;
  author: string;
  arrowName: string;
  data: unknown;
}): Promise<{ level: SiteLevelSummary | null; levels: SiteLevelSummary[] }> {
  const res = await fetch("/api/site-levels", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as {
    level?: SiteLevelSummary | null;
    levels?: SiteLevelSummary[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `Publish failed (${res.status})`);
  return { level: data.level ?? null, levels: data.levels ?? [] };
}

/** Admin-only: unpublish a level. */
export async function removeSiteLevel(id: string): Promise<SiteLevelSummary[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(`/api/site-levels/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json()) as { levels?: SiteLevelSummary[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Remove failed (${res.status})`);
  return data.levels ?? [];
}

export async function fetchSiteScores(levelId: string): Promise<SiteScoreEntry[]> {
  const res = await fetch(`/api/site-leaderboard/${encodeURIComponent(levelId)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Site leaderboard request failed (${res.status})`);
  return (await res.json()) as SiteScoreEntry[];
}

export async function submitSiteRun(payload: {
  levelId: string;
  username: string;
  arrowName: string;
  timeMs: number;
  inputs: string;
  inputCount: number;
}): Promise<SiteSubmitResult> {
  const res = await fetch(`/api/site-leaderboard/${encodeURIComponent(payload.levelId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as SiteSubmitResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Submit failed (${res.status})`);
  return data;
}

/** Admin-only: remove one run from a site level's board. */
export async function removeSiteRun(levelId: string, id: string): Promise<SiteScoreEntry[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const res = await fetch(
    `/api/site-leaderboard/${encodeURIComponent(levelId)}?id=${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = (await res.json()) as { entries?: SiteScoreEntry[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Remove failed (${res.status})`);
  return data.entries ?? [];
}
