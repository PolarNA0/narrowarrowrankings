import { createFileRoute } from "@tanstack/react-router";
import { decodeInputSymbols } from "@/lib/replay";
import { buildRaceMatch, archiveMatch } from "@/lib/race-matches.server";
import {
  makeLobbyCode,
  normalizeLobbyCode,
  raceMode,
  scoreRace,
  type RaceRun,
} from "@/lib/race-modes";
import {
  allocateLobbyCode,
  isLobbyExpired,
  joinLobby,
  lobbyClosed,
  makeLobby,
  readLobby,
  readLobbyPublic,
  saveLobby,
  submitRun,
  type RaceLobby,
} from "@/lib/race-lobby.server";
const NAME_RE = /^[A-Za-z0-9_\-. ]{1,32}$/;

interface ActionBody {
  action?: unknown;
  username?: unknown;
  levelId?: unknown;
  levelName?: unknown;
  arrowName?: unknown;
  mode?: unknown;
  round?: unknown;
  timeMs?: unknown;
  inputs?: unknown;
  finished?: unknown;
}

function bad(error: string, status = 400) {
  return Response.json({ error }, { status });
}

function cleanName(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * The lobby as the browser needs it: the match document plus the standings
 * derived from its runs. The standings are computed here, from the same pure
 * `scoreRace` the client uses, so a player cannot be shown a win the server
 * would not agree with.
 */
function viewOf(lobby: RaceLobby) {
  const mode = raceMode(lobby.mode);
  return {
    ...lobby,
    modeName: mode.name,
    rounds: mode.rounds,
    result: scoreRace(lobby.mode, lobby.players, lobby.runs),
    closed: lobbyClosed(lobby),
  };
}

export const Route = createFileRoute("/api/race-lobbies/$code")({
  server: {
    handlers: {
      // The polling read. Public, because a lobby code is the only credential
      // this feature has — see the note in `race-lobby.server.ts`.
      GET: async ({ params }) => {
        const lobby = await readLobbyPublic(params.code);
        if (!lobby) return bad("No lobby with that code.", 404);
        // Backfill the archive for a lobby that settled before archiving existed
        // (or whose archive write failed). Guarded by `archivedAt`, so a poll
        // writes at most once.
        const view = lobby.settledAt ? await archiveSettledLobby(lobby) : lobby;
        return Response.json(viewOf(view), { headers: { "cache-control": "no-store" } });
      },

      POST: async ({ params, request }) => {
        let body: ActionBody;
        try {
          body = (await request.json()) as ActionBody;
        } catch {
          return bad("Invalid JSON body");
        }

        const code = normalizeLobbyCode(params.code);
        const username = cleanName(body.username);
        if (!NAME_RE.test(username)) {
          return bad("Enter a valid name (1-32 letters).");
        }

        const existing = await readLobby(code);
        if (!existing) return bad("No lobby with that code.", 404);
        if (isLobbyExpired(existing)) return bad("That lobby has expired.", 410);

        const action = String(body.action ?? "");

        if (action === "join") {
          const joined = joinLobby(existing, username);
          if (!joined.ok) return bad(joined.error, 409);
          const saved = await saveLobby(joined.lobby);
          return Response.json(viewOf(saved));
        }

        if (action === "leave") {
          // Only a non-host may leave; the host leaving would strand the lobby.
          if (username === existing.host) {
            return bad("The host cannot leave their own lobby.", 409);
          }
          const saved = await saveLobby({
            ...existing,
            players: existing.players.filter((p) => p !== username),
            runs: existing.runs.filter((r) => r.username !== username),
          });
          return Response.json(viewOf(saved));
        }

        if (action === "submit") {
          const decoded = decodeInputSymbols(String(body.inputs ?? ""));
          if (decoded.length === 0) return bad("That run has no inputs to attach.");

          const run: RaceRun = {
            round: Math.round(Number(body.round)),
            username,
            timeMs: Math.round(Number(body.timeMs)),
            inputs: String(body.inputs ?? ""),
            inputCount: decoded.length,
            arrowName: String(body.arrowName ?? existing.arrowName),
            finished: body.finished !== false,
            createdAt: new Date().toISOString(),
          };

          const submitted = submitRun(existing, run);
          if (!submitted.ok) return bad(submitted.error, 409);

          // Settle as soon as every round is in, so a finished match stops
          // accepting runs without needing a separate call.
          const settled = raceSettles(submitted.lobby);
          const saved = await saveLobby(settled);
          // The lobby is transient; archive the result the moment it is decided
          // so it survives the lobby's TTL. Best effort — a failed archive must
          // not fail the run the player just posted.
          const final = saved.settledAt ? await archiveSettledLobby(saved) : saved;
          return Response.json(viewOf(final));
        }

        return bad("Unknown action.");
      },
    },
  },
});

/** Mark the lobby settled once every player has run every round. */
function raceSettles(lobby: RaceLobby): RaceLobby {
  if (lobby.settledAt) return lobby;
  const mode = raceMode(lobby.mode);
  const complete = lobby.players.every((p) =>
    Array.from({ length: mode.rounds }, (_, round) => round).every((round) =>
      lobby.runs.some((r) => r.username === p && r.round === round && r.finished !== false),
    ),
  );
  return complete ? { ...lobby, settledAt: new Date().toISOString() } : lobby;
}

/**
 * Copy a settled lobby into the durable match archive, once. Best effort: an
 * archive failure is logged and swallowed, because the run the player just posted
 * has already been saved and must not be reported as failed over it. `archivedAt`
 * on the lobby is the guard, so a polling read does not re-write every tick; it
 * is only stamped after a successful write, so a failure is retried on the next
 * call rather than being lost.
 */
async function archiveSettledLobby(lobby: RaceLobby): Promise<RaceLobby> {
  if (!lobby.settledAt || lobby.archivedAt) return lobby;
  try {
    await archiveMatch(
      buildRaceMatch({
        code: lobby.code,
        levelId: lobby.levelId,
        levelName: lobby.levelName,
        arrowName: lobby.arrowName,
        mode: lobby.mode,
        players: lobby.players,
        runs: lobby.runs,
        playedAt: lobby.settledAt,
      }),
    );
  } catch (err) {
    console.error("Failed to archive race match", lobby.code, err);
    return lobby;
  }
  const stamped: RaceLobby = { ...lobby, archivedAt: new Date().toISOString() };
  try {
    await saveLobby(stamped);
  } catch {
    // The archive entry is already written; failing to stamp just means the next
    // read re-attempts an idempotent write, which is harmless.
  }
  return stamped;
}
