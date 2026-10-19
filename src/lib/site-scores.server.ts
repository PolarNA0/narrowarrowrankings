/**
 * Leaderboard storage for site levels, keyed per level in `app_docs`.
 *
 * A score is a name, a time and the input string that reproduces it — the same
 * shape as a TAS entry. Site levels are hosted here (they use the site-only
 * wind/suction mechanics the game's engine has no concept of), so the site owns
 * the leaderboard rather than proxying the upstream API.
 */
import { supabase } from "@/integrations/supabase/client";
import { updateSiteLevelStats } from "@/lib/site-levels.server";

export interface SiteScoreEntry {
  id: string;
  username: string;
  timeMs: number;
  arrowName: string;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface SiteScoreBoard {
  levelId: string;
  entries: SiteScoreEntry[];
}

const COLLECTION = "site_scores";

const memoryBoards = new Map<string, SiteScoreEntry[]>();
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Best (lowest) time first; ties broken by who got there first. */
export function sortSiteScores(entries: SiteScoreEntry[]): SiteScoreEntry[] {
  return [...entries].sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt));
}

/**
 * One row per player: a name keeps only its best (lowest) run, and an exact
 * input string keeps only its earliest submission (so copying a listed run
 * cannot clone it onto the board). Sort first, so the "best" kept is the one
 * the ordering would have ranked. Applied on read, so a name that already
 * appears several times folds to one row without a migration.
 */
export function collapseSiteEntries(entries: SiteScoreEntry[]): SiteScoreEntry[] {
  const best = new Map<string, SiteScoreEntry>();
  const seenInputs = new Set<string>();
  for (const e of sortSiteScores(entries)) {
    const key = e.username.trim().toLowerCase();
    if (seenInputs.has(e.inputs)) continue;
    if (!best.has(key)) best.set(key, e);
    seenInputs.add(e.inputs);
  }
  return sortSiteScores([...best.values()]);
}

/** True when the player already holds a faster run, so this one is not their PB. */
export function isPersonalBest(
  existing: SiteScoreEntry[],
  username: string,
  timeMs: number,
): boolean {
  const key = username.trim().toLowerCase();
  const prior = existing
    .filter((e) => e.username.trim().toLowerCase() === key)
    .reduce<number | null>((acc, e) => (acc === null || e.timeMs < acc ? e.timeMs : acc), null);
  return prior === null || timeMs < prior;
}

export function isNewSiteRecord(entries: SiteScoreEntry[], timeMs: number): boolean {
  const best = entries.reduce<number | null>(
    (acc, e) => (acc === null || e.timeMs < acc ? e.timeMs : acc),
    null,
  );
  return best === null || timeMs < best;
}

/** A submission must be a distinct run, not the board leader re-submitted. */
export function hasDuplicateInputs(entries: SiteScoreEntry[], inputs: string): boolean {
  return entries.some((e) => e.inputs === inputs);
}

export async function readSiteScores(levelId: string): Promise<SiteScoreEntry[]> {
  if (memoryStoreEnabled()) return memoryBoards.get(levelId) ?? [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", levelId)
      .maybeSingle();
    const board = data?.data as unknown as SiteScoreBoard | undefined;
    return Array.isArray(board?.entries) ? collapseSiteEntries(board.entries) : [];
  } catch {
    return [];
  }
}

/** Public (RLS) read used by the API route so no service key is needed. */
export async function readSiteScoresPublic(levelId: string): Promise<SiteScoreEntry[]> {
  if (memoryStoreEnabled()) return memoryBoards.get(levelId) ?? [];
  try {
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", levelId)
      .maybeSingle();
    if (error) return [];
    const board = data?.data as unknown as SiteScoreBoard | undefined;
    return Array.isArray(board?.entries) ? collapseSiteEntries(board.entries) : [];
  } catch {
    return [];
  }
}

/** Append a submission, refresh the level's summary stats, return the board. */
export async function addSiteScore(
  levelId: string,
  entry: SiteScoreEntry,
): Promise<SiteScoreEntry[]> {
  // Fold after appending: a player's worse run is dropped and the stored board
  // keeps one row per player, so the count the summary reports is the real one.
  const entries = collapseSiteEntries([...(await readSiteScores(levelId)), entry]);
  if (memoryStoreEnabled()) {
    memoryBoards.set(levelId, entries);
    await updateSiteLevelStats(levelId, entries.length, entries[0]?.timeMs ?? null);
    return entries;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: levelId,
      data: { levelId, entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  await updateSiteLevelStats(levelId, entries.length, entries[0]?.timeMs ?? null);
  return entries;
}

/** Admin-only: remove one entry and return the re-sorted board. */
export async function removeSiteScore(levelId: string, id: string): Promise<SiteScoreEntry[]> {
  const entries = sortSiteScores((await readSiteScores(levelId)).filter((e) => e.id !== id));
  if (memoryStoreEnabled()) {
    memoryBoards.set(levelId, entries);
    await updateSiteLevelStats(levelId, entries.length, entries[0]?.timeMs ?? null);
    return entries;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: levelId,
      data: { levelId, entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  await updateSiteLevelStats(levelId, entries.length, entries[0]?.timeMs ?? null);
  return entries;
}
