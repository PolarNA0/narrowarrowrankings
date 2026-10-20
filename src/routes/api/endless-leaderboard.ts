import { createFileRoute } from "@tanstack/react-router";
import { decodeInputSymbols } from "@/lib/replay";
import {
  addEndlessEntry,
  hasDuplicateInputs,
  isNewEndlessRecord,
  readEndlessBoard,
  readEndlessBoardPublic,
  removeEndlessEntry,
  sortEndlessEntries,
  toEndlessSummary,
  type EndlessEntry,
} from "@/lib/endless-board.server";
import { verifyAdminRequest } from "@/lib/tas-board.server";

/** An endless submission: who, how many sections, and the inputs that reproduce it. */
interface SubmitBody {
  seed?: unknown;
  username?: unknown;
  arrowName?: unknown;
  score?: unknown;
  inputs?: unknown;
  inputCount?: unknown;
}

/** Max score we will accept, so a bogus client can't post an absurd number. */
const MAX_SCORE = 100_000;

export const Route = createFileRoute("/api/endless-leaderboard")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);

        // `?entry=<id>` returns a single run *with* its input string, so a
        // viewer can replay the one run it is about to watch.
        const entryId = url.searchParams.get("entry");
        if (entryId) {
          const entries = await readEndlessBoardPublic();
          const found = entries.find((e) => e.id === entryId) ?? null;
          if (!found) return Response.json({ error: "No such entry" }, { status: 404 });
          return Response.json(found, { headers: { "cache-control": "no-store" } });
        }

        const sorted = sortEndlessEntries(await readEndlessBoardPublic());
        const summary = url.searchParams.get("summary") === "1";
        const payload = summary ? sorted.map(toEndlessSummary) : sorted;
        return Response.json(payload, { headers: { "cache-control": "no-store" } });
      },
      POST: async ({ request }) => {
        let body: SubmitBody;
        try {
          body = (await request.json()) as SubmitBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const username = String(body.username ?? "").trim();
        const arrowName = String(body.arrowName ?? "").trim();
        const inputs = String(body.inputs ?? "");
        const score = Math.round(Number(body.score));
        const seed = Math.max(1, Math.floor(Number(body.seed) || 1));

        if (!/^[A-Za-z0-9_\-. ]{1,32}$/.test(username)) {
          return Response.json({ error: "Enter a valid name (1-32 letters)." }, { status: 400 });
        }
        if (!Number.isFinite(score) || score <= 0 || score > MAX_SCORE) {
          return Response.json({ error: "That run has no score to submit." }, { status: 400 });
        }
        const decoded = decodeInputSymbols(inputs);
        if (decoded.length === 0) {
          return Response.json({ error: "The run has no inputs to attach." }, { status: 400 });
        }

        const existing = await readEndlessBoard();
        if (hasDuplicateInputs(existing, inputs)) {
          return Response.json(
            { error: "This exact run is already on the board. Tweak it before submitting." },
            { status: 409 },
          );
        }

        const entry: EndlessEntry = {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          username,
          seed,
          arrowName: arrowName || "Narrow Arrow",
          score,
          inputCount: decoded.length,
          inputs,
          createdAt: new Date().toISOString(),
        };

        let entries: EndlessEntry[];
        try {
          entries = await addEndlessEntry(entry);
        } catch {
          return Response.json({ error: "Could not save that submission." }, { status: 500 });
        }

        const sorted = sortEndlessEntries(entries);
        return Response.json({
          isRecord: isNewEndlessRecord(existing, score),
          rank: sorted.findIndex((e) => e.id === entry.id) + 1,
          entries: sorted,
        });
      },
      /** Admin-only: remove one entry. */
      DELETE: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return Response.json({ error: "Missing entry id" }, { status: 400 });

        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Only admins can remove endless runs." }, { status: 403 });
        }

        let entries: EndlessEntry[];
        try {
          entries = await removeEndlessEntry(id);
        } catch {
          return Response.json({ error: "Could not remove that run." }, { status: 500 });
        }
        return Response.json({ entries: sortEndlessEntries(entries) });
      },
    },
  },
});
