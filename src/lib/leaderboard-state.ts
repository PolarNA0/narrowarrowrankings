import type { LeaderboardEntry } from "@/types";

/** A saved snapshot must never erase a PB already seen on a newer board. */
export function mergeLeaderboardUpdates(
  current: Record<string, LeaderboardEntry[]>,
  incoming: Record<string, LeaderboardEntry[]>,
): Record<string, LeaderboardEntry[]> {
  const next = { ...current };
  for (const [levelId, entries] of Object.entries(incoming)) {
    if (!entries.length) continue;
    const runs = new Map<string, LeaderboardEntry>();
    for (const entry of [...(current[levelId] ?? []), ...entries]) {
      const key = entry.run_id
        ? String(entry.run_id)
        : `${entry.username.toLowerCase()}:${entry.arrow_name?.toLowerCase()}:${entry.completion_time}`;
      const previous = runs.get(key);
      if (!previous || entry.completion_time <= previous.completion_time) runs.set(key, entry);
    }
    next[levelId] = [...runs.values()].sort((a, b) => a.completion_time - b.completion_time);
  }
  return next;
}