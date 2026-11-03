/**
 * Client helper for the community-level feed snapshot behind the "Unbeaten
 * authors" view (see `src/routes/api/unbeaten-authors.ts`). The feed carries
 * each level's creator and world record, so the view derives defended records
 * without any per-level request.
 */
import type { CustomLevelCompact } from "@/lib/unbeaten-authors";

export type { CustomLevelCompact };

export interface UnbeatenAuthorsPayload {
  levels: CustomLevelCompact[];
  /** How many levels the snapshot currently covers. */
  total: number;
  /** True once every feed has been swept end to end at least once. */
  done: boolean;
  at: number;
}

export async function fetchCustomLevelFeed(): Promise<UnbeatenAuthorsPayload> {
  const res = await fetch("/api/unbeaten-authors", { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Unbeaten authors request failed (${res.status})`);
  const data = (await res.json()) as Partial<UnbeatenAuthorsPayload>;
  return {
    levels: Array.isArray(data.levels) ? data.levels : [],
    total: Number(data.total) || 0,
    done: Boolean(data.done),
    at: Number(data.at) || 0,
  };
}
