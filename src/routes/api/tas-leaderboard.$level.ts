import { createFileRoute } from "@tanstack/react-router";
import { decodeInputSymbols } from "@/lib/replay";
import { runTasCheck } from "@/lib/tas-tracker.server";
import {
  addTasEntry,
  hasDuplicateInputs,
  isNewTasRecord,
  readTasBoard,
  readTasBoardPublic,
  removeTasEntry,
  renameTasEntry,
  sortTasEntries,
  verifyAdminRequest,
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
      GET: async ({ params, request }) => {
        const url = new URL(request.url);

        // `?entry=<id>` returns a single run *with* its input string. The board
        // list no longer ships inputs (see `summary`), so this is how a viewer
        // pulls the one stream it is about to play.
        const entryId = url.searchParams.get("entry");
        if (entryId) {
          const entries = await readTasBoardPublic(params.level);
          const found = entries.find((e) => e.id === entryId) ?? null;
          if (!found) return Response.json({ error: "No such entry" }, { status: 404 });
          return Response.json(found, { headers: { "cache-control": "no-store" } });
        }

        const entries = await readTasBoardPublic(params.level);
        const sorted = sortTasEntries(entries);
        // `?summary=1` strips the input blobs. The main leaderboard only needs
        // the best time and the record tracker needs a timeline, so shipping a
        // ~2KB base64 stream per run for a single number is pure egress — the
        // per-level board view is the only caller that needs `inputs`.
        const summary = url.searchParams.get("summary") === "1";
        const payload = summary ? sorted.map(({ inputs: _inputs, ...rest }) => rest) : sorted;
        return Response.json(payload, {
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
        // Each entry has to be a distinct run — otherwise everyone would just
        // load the WR and re-submit the same inputs.
        if (hasDuplicateInputs(existing, inputs)) {
          return Response.json(
            { error: "This exact run is already on the board. Tweak it before submitting." },
            { status: 409 },
          );
        }

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
        const isRecord = isNewTasRecord(existing, timeMs);

        // Announce a new record right away through the TAS tracker. Best effort:
        // a slow upstream or a dead webhook must never fail the upload itself.
        if (isRecord) {
          try {
            await runTasCheck([params.level], { force: true });
          } catch {
            /* notification is best effort */
          }
        }

        return Response.json({
          isRecord,
          rank: sorted.findIndex((e) => e.id === entry.id) + 1,
          entries: sorted,
        });
      },
      /** Admin-only: rename the owner of an existing entry (e.g. re-attribute). */
      PATCH: async ({ params, request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "Missing entry id" }, { status: 400 });

        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Only admins can rename TAS runs." }, { status: 403 });
        }

        const body = (await request.json().catch(() => ({}))) as { username?: unknown };
        const username = String(body.username ?? "").trim();
        if (!/^[A-Za-z0-9_\-. ]{1,32}$/.test(username)) {
          return Response.json({ error: "Enter a valid name (1-32 letters)." }, { status: 400 });
        }

        let entries: TasEntry[];
        try {
          entries = await renameTasEntry(params.level, id, username);
        } catch {
          return Response.json({ error: "Could not rename that run." }, { status: 500 });
        }
        return Response.json({ entries: sortTasEntries(entries) });
      },
      DELETE: async ({ params, request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "Missing entry id" }, { status: 400 });

        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Only admins can remove TAS runs." }, { status: 403 });
        }

        let entries: TasEntry[];
        try {
          entries = await removeTasEntry(params.level, id);
        } catch {
          return Response.json({ error: "Could not remove that run." }, { status: 500 });
        }
        return Response.json({ entries: sortTasEntries(entries) });
      },
    },
  },
});
