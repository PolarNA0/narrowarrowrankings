import { createFileRoute } from "@tanstack/react-router";
import { decodeInputSymbols } from "@/lib/replay";
import {
  addTasEntry,
  isNewTasRecord,
  readTasBoard,
  readTasBoardPublic,
  sortTasEntries,
  type TasEntry,
} from "@/lib/tas-board.server";

/** A TAS submission: who, how fast, and the inputs that reproduce it. */
interface SubmitBody {
  levelId?: unknown;
  username?: unknown;
  arrowName?: unknown;
  timeMs?: unknown;
  inputs?: unknown;
  inputCount?: unknown;
}

export const Route = createFileRoute("/api/tas-leaderboard/$level")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const entries = await readTasBoardPublic(params.level);
        return Response.json(sortTasEntries(entries), {
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

        const existing = await readTasBoard(params.level);
        const entry: TasEntry = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          username,
          timeMs,
          arrowName: arrowName || "Narrow Arrow",
          inputCount: decoded.length,
          inputs,
          createdAt: new Date().toISOString(),
        };

        let entries: TasEntry[];
        try {
          entries = await addTasEntry(params.level, entry);
        } catch {
          return Response.json({ error: "Could not save that submission." }, { status: 500 });
        }

        const sorted = sortTasEntries(entries);
        return Response.json({
          isRecord: isNewTasRecord(existing, timeMs),
          rank: sorted.findIndex((e) => e.id === entry.id) + 1,
          entries: sorted,
        });
      },
    },
  },
});
