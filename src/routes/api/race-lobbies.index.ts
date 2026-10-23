import { createFileRoute } from "@tanstack/react-router";
import { makeLobbyCode, raceMode, scoreRace } from "@/lib/race-modes";
import { allocateLobbyCode, makeLobby, saveLobby, type RaceLobby } from "@/lib/race-lobby.server";

const NAME_RE = /^[A-Za-z0-9_\-. ]{1,32}$/;

interface CreateBody {
  username?: unknown;
  levelId?: unknown;
  levelName?: unknown;
  arrowName?: unknown;
  mode?: unknown;
}

/** The lobby plus its derived standings, matching the shape the GET returns. */
function viewOf(lobby: RaceLobby) {
  const mode = raceMode(lobby.mode);
  return {
    ...lobby,
    modeName: mode.name,
    rounds: mode.rounds,
    result: scoreRace(lobby.mode, lobby.players, lobby.runs),
    closed: false,
  };
}

/**
 * Open a lobby and return it. The level and mode are fixed here and never change,
 * so a player joining cannot be tricked into racing something other than what
 * the host picked.
 */
export const Route = createFileRoute("/api/race-lobbies/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: CreateBody;
        try {
          body = (await request.json()) as CreateBody;
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const username = String(body.username ?? "").trim();
        const levelId = String(body.levelId ?? "").trim();
        const levelName = String(body.levelName ?? "").trim();
        const arrowName = String(body.arrowName ?? "").trim() || "Narrow Arrow";

        if (!NAME_RE.test(username)) {
          return Response.json({ error: "Enter a valid name (1-32 letters)." }, { status: 400 });
        }
        if (!levelId) {
          return Response.json({ error: "Pick a level to race." }, { status: 400 });
        }

        const code = await allocateLobbyCode(makeLobbyCode);
        if (!code) {
          return Response.json({ error: "Could not open a lobby, try again." }, { status: 503 });
        }

        const lobby = makeLobby({
          code,
          levelId,
          levelName: levelName || levelId,
          arrowName,
          mode: raceMode(String(body.mode ?? "")).id,
          host: username,
        });

        try {
          await saveLobby(lobby);
        } catch {
          return Response.json({ error: "Could not open a lobby." }, { status: 500 });
        }

        return Response.json(viewOf(lobby));
      },
    },
  },
});
