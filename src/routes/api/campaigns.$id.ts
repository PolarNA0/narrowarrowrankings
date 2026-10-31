import { createFileRoute } from "@tanstack/react-router";
import { buildCampaignStandings, campaignStatus, type CampaignStanding } from "@/lib/campaign";
import {
  readCampaign,
  readCampaignPublic,
  saveCampaign,
  readStandingsMemo,
  writeStandingsMemo,
  clearStandingsMemo,
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
        const record = await readCampaignPublic(params.id);
        if (!record) return Response.json({ error: "Not found." }, { status: 404 });

        const summaryOnly = new URL(request.url).searchParams.get("summary") === "1";
        const status = campaignStatus(record, Date.now());

        if (record.frozenAt !== null && record.standings) {
          return Response.json(
            {
              campaign: publicView(record),
              standings: summaryOnly ? record.standings.slice(0, 5) : record.standings,
              status: "ended",
            },
            { headers: { "cache-control": "public, max-age=300" } },
          );
        }

        const standings = await computeStandings(record);
        return Response.json(
          {
            campaign: publicView(record),
            standings: summaryOnly ? standings.slice(0, 5) : standings,
            status,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },

      /**
       * Admin: freeze the campaign, snapshotting its standings permanently.
       * Safe to call repeatedly — the first snapshot wins.
       */
      POST: async ({ params, request }) => {
        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Not authorized." }, { status: 403 });
        }
        const record = await readCampaign(params.id);
        if (!record) return Response.json({ error: "Not found." }, { status: 404 });

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
