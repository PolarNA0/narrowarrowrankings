import { createFileRoute } from "@tanstack/react-router";
import { fetchJson } from "@/lib/na-proxy";

const TTL = 30 * 60 * 1000;
const MAX_USERS = 40;

interface DailyMedals {
  first?: number;
  second?: number;
  third?: number;
  top10?: number;
}

/** In-game medal tallies keyed by tier. */
export interface MedalCounts {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
  author: number;
}

export interface ProfileSummary {
  username: string;
  found: boolean;
  customCompleted: number;
  mapsCompleted: number;
  totalMaps: number;
  medalCounts: MedalCounts;
  medalCountsPacks: MedalCounts;
  medalCountsCommunity: MedalCounts;
  dailyMedals: DailyMedals;
  dailyDaysPlayed: number;
  dailyBestStreak: number;
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

function medalTiers(raw: unknown): MedalCounts {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (raw ?? {}) as any;
  return {
    bronze: Number(m.bronze ?? 0) || 0,
    silver: Number(m.silver ?? 0) || 0,
    gold: Number(m.gold ?? 0) || 0,
    platinum: Number(m.platinum ?? 0) || 0,
    author: Number(m.author ?? 0) || 0,
  };
}

function summarise(username: string, payload: unknown): ProfileSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (payload ?? {}) as any;
  const found = !raw.error;
  return {
    username: raw.user?.username ?? username,
    found,
    customCompleted: Number(raw.custom_levels_completed ?? 0) || 0,
    mapsCompleted: Number(raw.maps_completed ?? 0) || 0,
    totalMaps: Number(raw.total_maps ?? 0) || 0,
    medalCounts: medalTiers(raw.medal_counts),
    medalCountsPacks: medalTiers(raw.medal_counts_packs),
    medalCountsCommunity: medalTiers(raw.medal_counts_community),
    dailyMedals: raw.daily_stats?.medals ?? {},
    dailyDaysPlayed: Number(raw.daily_stats?.days_played ?? 0) || 0,
    dailyBestStreak: Number(raw.daily_stats?.best_streak ?? 0) || 0,
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
