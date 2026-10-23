import { fetchJson } from "./na-proxy";

/**
 * The in-game "featured level" — one level featured per calendar day, with its
 * own leaderboard and streak rewards. The game server used to announce it on
 * `/startup-data`, but that endpoint now 404s, so we keep a deterministic
 * rotation as the source of truth and prefer the server's pick when it is up.
 *
 * The rotation is pure: it takes a date, sorts the candidate levels by id and
 * indexes by the number of days since an epoch. The same day therefore yields
 * the same level for every player and every device, with no shared state to
 * drift, and a level is never featured twice in one full cycle.
 */
export interface DailyLevel {
  levelId: string;
  name: string;
  /** Where the pick came from, so the UI can say how authoritative it is. */
  source: "upstream" | "rotation";
  /** The day the pick is for, as `YYYY-MM-DD` (UTC). */
  date: string;
}

/** A candidate the rotation can pick from: a level id and its display name. */
export interface DailyCandidate {
  levelId: string;
  name: string;
}

/** Days since the Unix epoch for `date`, in UTC — the rotation index. */
export function dayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000,
  );
}

/** `YYYY-MM-DD` (UTC) for `date`. */
export function dayKey(date: Date): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/**
 * The level featured on `date`, chosen deterministically from `candidates`.
 *
 * Sorted by id first so the pool's order does not depend on how the caller
 * assembled it; then indexed by the day number, which makes consecutive days
 * walk the list in order and every level come up before any repeats. Returns
 * null for an empty pool, so the caller can show an empty state.
 */
export function pickDailyLevel(candidates: DailyCandidate[], date: Date): DailyLevel | null {
  if (candidates.length === 0) return null;
  const pool = [...candidates].sort((a, b) => a.levelId.localeCompare(b.levelId));
  const idx = ((dayNumber(date) % pool.length) + pool.length) % pool.length;
  const chosen = pool[idx];
  return { levelId: chosen.levelId, name: chosen.name, source: "rotation", date: dayKey(date) };
}

/**
 * The featured level for `date`, preferring the game server's pick.
 *
 * The server's `/startup-data` carries `daily.level` when it is up; a fresh
 * response wins, because a manual pick or a rescheduled day must be honoured.
 * Otherwise the local rotation decides, so the tab still works while the
 * endpoint is down (it currently 404s).
 *
 * The upstream call shares the proxy's rate-limited queue with the bulk
 * leaderboard load, so it can take many seconds to settle. `onResolved` reports
 * the rotation immediately, then reports the server's pick only if it differs,
 * letting the caller paint a level at once instead of showing an empty card.
 */
export async function fetchDailyLevel(
  candidates: DailyCandidate[],
  date: Date = new Date(),
  onResolved?: (level: DailyLevel) => void,
): Promise<DailyLevel | null> {
  const rotation = pickDailyLevel(candidates, date);
  if (rotation) onResolved?.(rotation);
  try {
    const data = (await fetchJson("/startup-data", 10 * 60 * 1000)) as {
      daily?: { level?: Record<string, unknown> };
    };
    const level = data?.daily?.level;
    if (level) {
      const id = String(level.levelKey ?? level.id ?? level.level_id ?? "").trim();
      if (id) {
        const name = String(level.name ?? level.title ?? "").trim();
        const upstream: DailyLevel = {
          levelId: id,
          name: name || id,
          source: "upstream",
          date: dayKey(date),
        };
        if (upstream.levelId !== rotation?.levelId) onResolved?.(upstream);
        return upstream;
      }
    }
  } catch {
    /* server pick unavailable — the rotation above is the fallback */
  }
  return rotation;
}

/** The most recent `count` daily picks, newest first, for a history strip. */
export function recentDailyLevels(
  candidates: DailyCandidate[],
  count: number,
  from: Date = new Date(),
): DailyLevel[] {
  const out: DailyLevel[] = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(from.getTime() - i * 86_400_000);
    const pick = pickDailyLevel(candidates, day);
    if (pick) out.push(pick);
  }
  return out;
}

/**
 * The UTC `YYYY-MM-DD` a run was set on, or null when it carries no date.
 *
 * The upstream board timestamps runs in UTC ISO form; a run without one cannot
 * be placed on a day, so it is excluded from a daily board rather than guessed
 * onto today's.
 */
export function runDay(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Whether a run belongs on `day`'s daily board. */
export function isRunOnDay(createdAt: string | null | undefined, day: string): boolean {
  return runDay(createdAt) === day;
}
