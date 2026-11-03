/**
 * Snapshot of the community-level feed, for the "Unbeaten authors" view.
 *
 * `/published-levels` is paged 10 levels at a time and the corpus is ~1,900
 * levels across three filters, so a full sweep is ~300 upstream requests —
 * far past the ~120/min budget and well beyond a request handler's patience.
 * So this mirrors `all-leaderboards`: each request advances a bounded batch of
 * the sweep and the result is persisted, letting successive requests warm the
 * snapshot until it covers every page.
 *
 * The feed already carries each level's `creator_name` and `world_record`, so
 * the author-defended check needs no per-level request.
 */
import { fetchJson } from "@/lib/na-proxy";
import type { CustomLevelCompact } from "@/lib/unbeaten-authors";

const COLLECTION = "cache";
const DOC_ID = "customLevels";

/** The three feeds overlap heavily; the union is what a sweep needs. */
export const FEEDS = ["popular", "new", "discover"] as const;
export type FeedName = (typeof FEEDS)[number];

/** Pages are fixed at 10 levels; 101 is the last page that returns data. */
export const MAX_PAGE = 100;
/**
 * Pages swept per request. The upstream budget is ~60 requests/min and the
 * proxy spaces calls 520ms apart, so a batch of six is ~3s of work — the same
 * slice size `all-leaderboards` uses.
 */
export const BATCH = 6;
const FEED_TTL = 6 * 60 * 60 * 1000;
/** How long a completed sweep is trusted before it is walked again. */
const RESWEEP_MS = 3 * 60 * 60 * 1000;

export interface CustomLevelSnapshot {
  levels: Record<string, CustomLevelCompact>;
  /** Per-feed cursor: the next page to sweep. */
  cursor: Record<string, number>;
  /** True once every feed has been walked end to end at least once. */
  done: boolean;
  at: number;
}

const memoryStore: { snapshot: CustomLevelSnapshot | null } = { snapshot: null };

function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function emptySnapshot(): CustomLevelSnapshot {
  return { levels: {}, cursor: {}, done: false, at: 0 };
}

/** The persisted snapshot, or null when nothing has been saved yet. */
export async function readCustomLevelSnapshot(): Promise<CustomLevelSnapshot | null> {
  if (memoryStoreEnabled()) return memoryStore.snapshot;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", DOC_ID)
      .maybeSingle();
    const snap = data?.data as unknown as CustomLevelSnapshot | undefined;
    return snap?.levels ? snap : null;
  } catch {
    return null;
  }
}

async function writeCustomLevelSnapshot(snap: CustomLevelSnapshot): Promise<void> {
  if (memoryStoreEnabled()) {
    memoryStore.snapshot = snap;
    return;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_docs")
      .upsert(
        { collection: COLLECTION, doc_id: DOC_ID, data: snap as never },
        { onConflict: "collection,doc_id" },
      );
  } catch {
    /* best effort — a failed write just means the sweep resumes from the old cursor */
  }
}

/**
 * The fields the view needs, projected out of a feed entry. The feed entry
 * itself carries the level's whole obstacle list (~80KB each), so storing it
 * verbatim would make the snapshot — and every response — tens of megabytes.
 * Only what "unbeaten" is judged on is kept.
 */
function toCompact(entry: unknown): CustomLevelCompact | null {
  const record = entry as Record<string, unknown> | null;
  if (!record) return null;
  const levelId = record.level_id ?? (record.id !== undefined ? String(record.id) : null);
  if (!levelId) return null;
  const wr = record.world_record as Record<string, unknown> | null | undefined;
  const medals = record.medals as Record<string, unknown> | null | undefined;
  const pack = record.pack as Record<string, unknown> | null | undefined;
  return {
    level_id: String(levelId),
    name: typeof record.name === "string" ? record.name : String(levelId),
    creator_name: typeof record.creator_name === "string" ? record.creator_name : null,
    like_count: Number(record.like_count) || 0,
    play_count: Number(record.play_count) || 0,
    created_at: typeof record.created_at === "string" ? record.created_at : null,
    pack: pack
      ? {
          slug: typeof pack.slug === "string" ? pack.slug : undefined,
          name: typeof pack.name === "string" ? pack.name : undefined,
        }
      : null,
    world_record:
      wr && typeof wr.completion_time === "number"
        ? {
            completion_time: wr.completion_time,
            username: typeof wr.username === "string" ? wr.username : "",
            arrow_name: typeof wr.arrow_name === "string" ? wr.arrow_name : "",
          }
        : null,
    medals:
      medals && (typeof medals.finisherCount === "number" || typeof medals.topTime === "number")
        ? {
            ...(typeof medals.topTime === "number" ? { topTime: medals.topTime } : {}),
            finisherCount: typeof medals.finisherCount === "number" ? medals.finisherCount : 0,
          }
        : null,
  };
}

/** Merge one page of feed entries into the snapshot's level map. */
function mergePage(snapshot: CustomLevelSnapshot, page: unknown): void {
  if (!Array.isArray(page)) return;
  for (const entry of page) {
    const compact = toCompact(entry);
    if (compact) snapshot.levels[compact.level_id] = compact;
  }
}

/**
 * Sweep one bounded slice of the feed into the snapshot and persist it.
 * Returns the snapshot after the slice. A cold snapshot starts at page 0 of
 * every feed; once every feed's cursor passes the last page the sweep is done,
 * and a completed sweep is only walked again once `RESWEEP_MS` has elapsed.
 */
export async function advanceCustomLevelSweep(): Promise<CustomLevelSnapshot> {
  const snapshot = (await readCustomLevelSnapshot()) ?? emptySnapshot();
  const cursor = { ...snapshot.cursor };
  // A finished, still-fresh sweep is left alone; an old one starts over so new
  // levels (and new records) are picked up.
  const restart = snapshot.done && Date.now() - snapshot.at > RESWEEP_MS;
  if (restart) {
    for (const feed of FEEDS) cursor[feed] = 0;
  }
  let swept = 0;

  for (const feed of FEEDS) {
    let page = cursor[feed] ?? 0;
    while (page <= MAX_PAGE && swept < BATCH) {
      let payload: unknown;
      try {
        payload = await fetchJson(`/published-levels?filter=${feed}&page=${page}`, FEED_TTL);
      } catch {
        break; // keep the cursor here so the next request retries this page
      }
      const list = Array.isArray(payload) ? payload : [];
      if (list.length === 0) {
        page = MAX_PAGE + 1;
        break;
      }
      mergePage(snapshot, list);
      page += 1;
      swept += 1;
    }
    cursor[feed] = page;
  }

  const done = FEEDS.every((feed) => (cursor[feed] ?? 0) > MAX_PAGE);
  // A fresh, completed sweep sweeps nothing — skip the write so a settled
  // snapshot is not re-upserted on every request.
  if (swept === 0 && done === snapshot.done) return snapshot;
  const next: CustomLevelSnapshot = {
    levels: snapshot.levels,
    cursor,
    done,
    at: Date.now(),
  };
  await writeCustomLevelSnapshot(next);
  return next;
}

/** The level list from a snapshot. */
export function snapshotLevels(snapshot: CustomLevelSnapshot | null): CustomLevelCompact[] {
  return snapshot ? Object.values(snapshot.levels) : [];
}
