import { createFileRoute } from "@tanstack/react-router";
import {
  applyLevelColors,
  buildCampaignStandings,
  campaignStatus,
  type CampaignStanding,
} from "@/lib/campaign";
import {
  readCampaign,
  readCampaignPublic,
  normalizeStoredCampaign,
  saveCampaign,
  readStandingsMemo,
  writeStandingsMemo,
  clearStandingsMemo,
  readStandingsCache,
  writeStandingsCache,
  isStandingsCacheStale,
  MIN_REFRESH_INTERVAL_MS,
  type CampaignRecord,
  type StandingsCache,
} from "@/lib/campaign.server";
import { fetchLevelBoard } from "@/lib/leaderboard-source";
import { readSnapshot } from "@/lib/board-snapshot.server";
import { verifyAdminRequest } from "@/lib/tas-board.server";
import type { LeaderboardEntry } from "@/types";

/** Boards are only fetched for levels the snapshot does not already cover. */
async function boardsFor(levelIds: string[]): Promise<Record<string, LeaderboardEntry[]>> {
  const snapshot = await readSnapshot();
  const boards: Record<string, LeaderboardEntry[]> = {};
  const missing: string[] = [];

  for (const id of levelIds) {
    const cached = snapshot?.boards?.[id];
    if (cached && cached.length > 0) {
      boards[id] = cached.map(toEntry);
    } else {
      missing.push(id);
    }
  }

  // A campaign is at most ~25 levels, so a deep fetch is affordable, but bound
  // it so a misconfigured campaign cannot stall the handler.
  for (const id of missing.slice(0, 30)) {
    try {
      const board = await fetchLevelBoard(id, { deep: true });
      boards[id] = board.map(toEntry);
    } catch {
      /* leave the level unscored rather than failing the whole read */
    }
  }

  return boards;
}

function toEntry(b: {
  username?: string;
  completion_time?: number;
  arrow_name?: string;
}): LeaderboardEntry {
  return {
    run_id: 0,
    completion_time: Number(b.completion_time ?? 0),
    username: String(b.username ?? ""),
    arrow_name: String(b.arrow_name ?? ""),
    created_at: "",
  };
}

/** A short-lived per-process memo so home and the campaign view share one computation. */
async function computeStandings(
  record: {
    id: string;
    levels: { id: string }[];
  } & Parameters<typeof buildCampaignStandings>[0],
): Promise<CampaignStanding[]> {
  const cached = readStandingsMemo(record.id);
  if (cached) return cached;
  const boards = await boardsFor(record.levels.map((l) => l.id));
  const standings = buildCampaignStandings(record, boards);
  writeStandingsMemo(record.id, standings);
  return standings;
}

/**
 * Recomputes standings and persists them onto the campaign, so the next read is
 * served from the stored cache rather than re-reading every level's board.
 *
 * The persist is best-effort: a read must still succeed if the write fails (a
 * missing service key, a transient error), it just stays slow.
 */
async function recomputeStandings(record: CampaignRecord): Promise<StandingsCache> {
  const standings = await computeStandings(record);
  const at = Date.now();
  try {
    await writeStandingsCache(record, standings, at);
  } catch {
    /* the cache is an optimisation; the response is still correct */
  }
  return { standings, cachedAt: at };
}

export const Route = createFileRoute("/api/campaigns/$id")({
  server: {
    handlers: {
      /**
       * Public: one campaign with its standings.
       *
       * Once `frozenAt` is set the stored snapshot is served verbatim — the
       * live boards keep moving, so re-deriving a finished campaign would
       * silently rewrite its result.
       *
       * `?summary=1` returns only the top rows, for the home-page card.
       */
      GET: async ({ params, request }) => {
        const stored = await readCampaignPublic(params.id);
        if (!stored) return Response.json({ error: "Not found." }, { status: 404 });
        // A campaign saved before per-level colours still names a class; fold it
        // in so the client and the standings see the current shape.
        const record = normalizeStoredCampaign(stored);

        const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
        const status = campaignStatus(record, Date.now());

        if (record.frozenAt !== null && record.standings) {
          // The snapshot is the historical record, but its colours are
          // presentation and may predate per-level colours.
          const snapshot = applyLevelColors(record.standings, record.levels);
          return Response.json(
            {
              campaign: publicView(record),
              standings: summaryOnly ? snapshot.slice(0, 5) : snapshot,
              status: "ended",
              cachedAt: record.frozenAt,
              stale: false,
            },
            { headers: { "cache-control": "public, max-age=300" } },
          );
        }

        /**
         * A live campaign is served from its stored snapshot so a visitor never
         * waits on a board per level. The first read after a level-list change
         * (or on a campaign with nothing cached yet) computes and stores one.
         */
        const cache = readStandingsCache(record);
        const cached = cache ?? (await recomputeStandings(record));
        const stale = isStandingsCacheStale(cached);

        return Response.json(
          {
            campaign: publicView(record),
            standings: summaryOnly ? cached.standings.slice(0, 5) : cached.standings,
            status,
            cachedAt: cached.cachedAt,
            stale,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },

      /**
       * `?refresh=1`: recompute the standings from the live boards and store
       * them, returning the fresh result. Public on purpose — any visitor can
       * pull a campaign up to date, which is what keeps the cached snapshot from
       * drifting. Rate-limited by `MIN_REFRESH_INTERVAL_MS` so a burst of presses
       * cannot burn the upstream budget.
       *
       * Without the flag: admin only — freeze the campaign, snapshotting its
       * standings permanently. Safe to call repeatedly; the first snapshot wins.
       */
      POST: async ({ params, request }) => {
        const refresh = new URL(request.url).searchParams.get("refresh") === "1";

        if (refresh) {
          // The public read is tried too: refresh must work in a deployment
          // without the service role, and the admin read returns null there.
          const stored = (await readCampaign(params.id)) ?? (await readCampaignPublic(params.id));
          if (!stored) return Response.json({ error: "Not found." }, { status: 404 });
          const record = normalizeStoredCampaign(stored);

          // A closed campaign's result is final; there is nothing to refresh.
          if (record.frozenAt !== null && record.standings) {
            const snapshot = applyLevelColors(record.standings, record.levels);
            return Response.json({
              standings: snapshot,
              status: "ended",
              cachedAt: record.frozenAt,
              stale: false,
            });
          }

          const existing = readStandingsCache(record);
          if (existing && Date.now() - existing.cachedAt < MIN_REFRESH_INTERVAL_MS) {
            // Too soon: answer from what we have rather than hammering upstream.
            return Response.json({
              standings: existing.standings,
              status: campaignStatus(record, Date.now()),
              cachedAt: existing.cachedAt,
              stale: isStandingsCacheStale(existing),
              throttled: true,
            });
          }

          const fresh = await recomputeStandings(record);
          return Response.json({
            standings: fresh.standings,
            status: campaignStatus(record, Date.now()),
            cachedAt: fresh.cachedAt,
            stale: false,
          });
        }

        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Not authorized." }, { status: 403 });
        }
        const stored = await readCampaign(params.id);
        if (!stored) return Response.json({ error: "Not found." }, { status: 404 });
        const record = normalizeStoredCampaign(stored);

        if (record.frozenAt !== null) {
          return Response.json({ ok: true, frozenAt: record.frozenAt, alreadyFrozen: true });
        }

        const boards = await boardsFor(record.levels.map((l) => l.id));
        const standings = buildCampaignStandings(record, boards);
        const frozenAt = Date.now();
        await saveCampaign({ ...record, standings, frozenAt });
        clearStandingsMemo(record.id);
        return Response.json({ ok: true, frozenAt, standings });
      },
    },
  },
});

/** Strips the snapshot from the campaign definition sent to the client. */
function publicView(record: Awaited<ReturnType<typeof readCampaign>> & object) {
  const { standings: _standings, ...rest } = record as { standings?: CampaignStanding[] };
  return rest;
}
