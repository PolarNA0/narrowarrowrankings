import { createFileRoute } from "@tanstack/react-router";
import { decodeInputSymbols } from "@/lib/replay";
import {
  addSiteScore,
  hasDuplicateInputs,
  isNewSiteRecord,
  readSiteScores,
  readSiteScoresPublic,
  removeSiteScore,
  sortSiteScores,
  type SiteScoreEntry,
} from "@/lib/site-scores.server";
import { verifyAdminRequest } from "@/lib/site-levels.server";

interface SubmitBody {
  username?: unknown;
  arrowName?: unknown;
  timeMs?: unknown;
  inputs?: unknown;
}

export const Route = createFileRoute("/api/site-leaderboard/$level")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const entries = await readSiteScoresPublic(params.level);
        return Response.json(sortSiteScores(entries), {
          headers: { "cache-control": "no-store" },
        });
      },
      POST: async ({ params, request }) => {
        let body: SubmitBody;
        try {
          body = (await request.json()) as SubmitBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const username = String(body.username ?? "").trim();
        const arrowName = String(body.arrowName ?? "").trim();
        const inputs = String(body.inputs ?? "");
        const timeMs = Math.round(Number(body.timeMs));

        if (!/^[A-Za-z0-9_\-. ]{1,32}$/.test(username)) {
          return Response.json({ error: "Enter a valid name (1-32 letters)." }, { status: 400 });
        }
        if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > 60 * 60 * 1000) {
          return Response.json({ error: "That run has no valid time to submit." }, { status: 400 });
        }
        const decoded = decodeInputSymbols(inputs);
        if (decoded.length === 0) {
          return Response.json({ error: "The run has no inputs to attach." }, { status: 400 });
        }

        const existing = await readSiteScores(params.level);
        if (hasDuplicateInputs(existing, inputs)) {
          return Response.json(
            { error: "This exact run is already on the board. Tweak it before submitting." },
            { status: 409 },
          );
        }

        const entry: SiteScoreEntry = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          username,
          timeMs,
          arrowName: arrowName || "Narrow Arrow",
          inputCount: decoded.length,
          inputs,
          createdAt: new Date().toISOString(),
        };

        let entries: SiteScoreEntry[];
        try {
          entries = await addSiteScore(params.level, entry);
        } catch {
          return Response.json({ error: "Could not save that submission." }, { status: 500 });
        }

        const sorted = sortSiteScores(entries);
        const isRecord = isNewSiteRecord(existing, timeMs);
        return Response.json({
          isRecord,
          rank: sorted.findIndex((e) => e.id === entry.id) + 1,
          entries: sorted,
        });
      },
      /** Admin-only: remove one run from the board. */
      DELETE: async ({ params, request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "Missing entry id" }, { status: 400 });
        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Only admins can remove runs." }, { status: 403 });
        }
        const entries = await removeSiteScore(params.level, id);
        return Response.json({ entries: sortSiteScores(entries) });
      },
    },
  },
});
