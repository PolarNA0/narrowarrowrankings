/**
 * Snapshot of the community-level feed, for the "Unbeaten authors" view.
 *
 * `/published-levels` is paged 10 levels at a time and every filter runs ~101
 * pages, so a full sweep is ~303 upstream requests — far past the ~120/min
 * budget and well beyond a request handler's patience. So this mirrors
 * `all-leaderboards`: each request advances a bounded batch of the sweep and the
 * result is persisted, letting successive requests warm the snapshot until it
 * covers every page.
 *
 * The sweep is deliberately rare and must not be driven by visitor traffic: a
 * completed sweep is trusted for `SWEEP_INTERVAL_MS` (4h), so however many
 * people open the view, upstream sees at most one sweep per four hours. The
 * cron target is `GET /api/public/custom-levels-refresh`.
 *
 * The feed already carries each level's `creator_name` and `world_record`, so
 * the author-defended check needs no per-level request.
 */
import { fetchJson } from "@/lib/na-proxy";
import type { CustomLevelCompact } from "@/lib/unbeaten-authors";

const COLLECTION = "cache";
const DOC_ID = "customLevels";

/**
 * The three feeds are largely *distinct*, not overlapping (measured: 766 unique
 * levels across 900 page slots, with `new` adding 285 that `popular` lacks and
 * `discover` adding 181 more), so every feed must be walked — dropping one would
 * silently lose levels from the view.
 */
export const FEEDS = ["popular", "new", "discover"] as const;
export type FeedName = (typeof FEEDS)[number];

/** Pages are fixed at 10 levels; 101 is the last page that returns data. */
export const MAX_PAGE = 100;
/**
 * Pages swept per advance. The upstream budget is ~60 requests/min and the
 * proxy spaces calls 520ms apart, so a batch of six is ~3s of work — the same
 * slice size `all-leaderboards` uses.
 */
export const BATCH = 6;
const FEED_TTL = 6 * 60 * 60 * 1000;
/**
 * How long a completed sweep is trusted before it is walked again. This is the
 * whole cost control: upstream sees at most one full sweep per window no matter
 * how much traffic the view gets. A day matches the cron cadence — the feed is
 * community levels that change slowly, so there is no reason to walk it oftener.
 */
export const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CustomLevelSnapshot {
  levels: Record<string, CustomLevelCompact>;
  /** Per-feed cursor: the next page to sweep. */
  cursor: Record<string, number>;
  /** True once every feed has been walked end to end at least once. */
  done: boolean;
  /** When the snapshot was last written. */
  at: number;
  /**
   * When the current sweep began. The re-sweep window is measured from here, not
   * from completion, so the cadence is exactly `SWEEP_INTERVAL_MS` rather than
   * that plus however long the sweep took.
   */
  startedAt?: number;
}

const memoryStore: { snapshot: CustomLevelSnapshot | null } = { snapshot: null };

function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function emptySnapshot(): CustomLevelSnapshot {
  return { levels: {}, cursor: {}, done: false, at: 0, startedAt: 0 };
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
 * True when a sweep should be advanced: nothing persisted yet, an unfinished
 * sweep to continue, or a completed one old enough to re-walk. This is the
 * visitor-facing gate — a fresh completed sweep is never advanced on a view
 * request, so traffic alone can never cost upstream another sweep.
 */
export function sweepDue(snapshot: CustomLevelSnapshot | null): boolean {
  if (!snapshot || !snapshot.done) return true;
  return Date.now() - (snapshot.startedAt ?? snapshot.at) > SWEEP_INTERVAL_MS;
}

export interface SweepResult {
  snapshot: CustomLevelSnapshot;
  /** Pages swept by this advance; 0 when a fresh completed sweep was skipped. */
  swept: number;
  done: boolean;
}

/**
 * Sweep one bounded slice of the feed into the snapshot and persist it.
 * A cold snapshot starts at page 0 of every feed; once every feed's cursor
 * passes the last page the sweep is done, and a completed sweep is only walked
 * again once `SWEEP_INTERVAL_MS` has elapsed. `swept === 0` means the snapshot
 * was fresh and nothing was requested upstream.
 *
 * `force` restarts a completed sweep regardless of its age. It resets the
 * cursors, so `done` goes false and later calls continue rather than restarting
 * again — pass it only on the first call of a forced run.
 */
export async function advanceCustomLevelSweep(
  options: { force?: boolean } = {},
): Promise<SweepResult> {
  const snapshot = (await readCustomLevelSnapshot()) ?? emptySnapshot();
  const cursor = { ...snapshot.cursor };
  // A finished, still-fresh sweep is left alone; an old one starts over so new
  // levels (and new records) are picked up. `startedAt` is stamped once at the
  // beginning of a run and carried across its batches, so the re-sweep window is
  // measured from when the sweep started rather than when it happened to finish.
  const restart =
    options.force ||
    (snapshot.done && Date.now() - (snapshot.startedAt ?? snapshot.at) > SWEEP_INTERVAL_MS);
  if (restart) {
    for (const feed of FEEDS) cursor[feed] = 0;
  }
  const startedAt = restart ? Date.now() : snapshot.startedAt || Date.now();
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
  if (swept === 0 && done === snapshot.done) return { snapshot, swept, done };
  const next: CustomLevelSnapshot = {
    levels: snapshot.levels,
    cursor,
    done,
    at: Date.now(),
    // The run keeps the time it began, so the window is measured from the sweep's
    // start rather than from whenever its last batch happened to land.
    startedAt,
  };
  await writeCustomLevelSnapshot(next);
  return { snapshot: next, swept, done };
}

/** The level list from a snapshot. */
export function snapshotLevels(snapshot: CustomLevelSnapshot | null): CustomLevelCompact[] {
  return snapshot ? Object.values(snapshot.levels) : [];
}
