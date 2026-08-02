import { createFileRoute } from "@tanstack/react-router";
import { fetchJson } from "@/lib/na-proxy";

const TTL = 30 * 60 * 1000;
const MAX_USERS = 40;

interface Medals {
  first?: number;
  second?: number;
  third?: number;
  top10?: number;
}

export interface ProfileSummary {
  username: string;
  found: boolean;
  customCompleted: number;
  customMedals: Medals;
  officialMedals: Medals;
  packMedals: Medals;
  mapsCompleted: number;
  totalRuns: number;
  league: string | null;
  trophies: number;
  levelsPublished: number;
  totalLikes: number;
  totalPlays: number;
  joined: string | null;
  bio: string | null;
  dailyBestFinish: number | null;
}

function summarise(username: string, payload: unknown): ProfileSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (payload ?? {}) as any;
  const found = !raw.error;
  return {
    username: raw.user?.username ?? username,
    found,
    customCompleted: Number(raw.custom_levels_completed ?? 0) || 0,
    customMedals: raw.custom_medals ?? {},
    officialMedals: raw.official_medals ?? {},
    packMedals: raw.pack_medals ?? {},
    mapsCompleted: Number(raw.maps_completed ?? 0) || 0,
    totalRuns: Number(raw.total_runs ?? 0) || 0,
    league: raw.league ?? null,
    trophies: Number(raw.trophies ?? 0) || 0,
    levelsPublished: Number(raw.creator?.levels_published ?? 0) || 0,
    totalLikes: Number(raw.creator?.total_likes ?? 0) || 0,
    totalPlays: Number(raw.creator?.total_plays ?? 0) || 0,
    joined: raw.user?.joined ?? null,
    bio: raw.user?.bio ?? null,
    dailyBestFinish: raw.daily_stats?.best_finish ?? null,
  };
}

/** Batch profile summaries — the source of truth for custom completion medals. */
export const Route = createFileRoute("/api/profiles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const users = (new URL(request.url).searchParams.get("users") ?? "")
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean)
          .slice(0, MAX_USERS);

        const profiles = await Promise.all(
          users.map(async (username) => {
            try {
              const payload = await fetchJson(`/user/${encodeURIComponent(username)}`, TTL);
              return summarise(username, payload);
            } catch {
              return summarise(username, { error: true });
            }
          }),
        );

        return Response.json(
          { profiles },
          { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=1800" } },
        );
      },
    },
  },
});
