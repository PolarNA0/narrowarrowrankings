/**
 * The browser's side of a 1v1 race lobby: the shapes the API returns, the calls
 * that drive a lobby, and the poll that keeps it live.
 *
 * The lobby document is the match; the standings in `result` are derived from its
 * runs by the same `scoreRace` the server runs, so the two always agree.
 */
import type { RaceResult } from "@/lib/race-modes";

export interface RaceLobbyView {
  code: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  mode: string;
  modeName: string;
  host: string;
  players: string[];
  runs: Array<{
    round: number;
    username: string;
    timeMs: number;
    inputs: string;
    inputCount: number;
    arrowName: string;
    finished?: boolean;
    createdAt: string;
  }>;
  createdAt: string;
  closesAt: string | null;
  settledAt: string | null;
  /** Rounds the mode requires, echoed by the server so the UI need not re-derive it. */
  rounds: number;
  result: RaceResult;
  closed: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function createLobby(input: {
  username: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  mode: string;
}): Promise<RaceLobbyView> {
  return call<RaceLobbyView>("/api/race-lobbies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getLobby(code: string): Promise<RaceLobbyView> {
  return call<RaceLobbyView>(`/api/race-lobbies/${encodeURIComponent(code)}`);
}

export function joinLobby(code: string, username: string): Promise<RaceLobbyView> {
  return call<RaceLobbyView>(`/api/race-lobbies/${encodeURIComponent(code)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "join", username }),
  });
}

export function leaveLobby(code: string, username: string): Promise<RaceLobbyView> {
  return call<RaceLobbyView>(`/api/race-lobbies/${encodeURIComponent(code)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "leave", username }),
  });
}

export function submitLobbyRun(
  code: string,
  run: {
    username: string;
    round: number;
    timeMs: number;
    inputs: string;
    arrowName: string;
    finished?: boolean;
  },
): Promise<RaceLobbyView> {
  return call<RaceLobbyView>(`/api/race-lobbies/${encodeURIComponent(code)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "submit", ...run }),
  });
}

/** The lobby the browser is currently in, so a reload can offer to rejoin. */
const CURRENT_KEY = "naRaceLobby";

export function rememberLobby(code: string, username: string) {
  try {
    window.localStorage.setItem(CURRENT_KEY, JSON.stringify({ code, username }));
  } catch {
    /* storage blocked — the lobby just is not remembered */
  }
}

export function forgetLobby() {
  try {
    window.localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* storage blocked */
  }
}

export function loadRememberedLobby(): { code: string; username: string } | null {
  try {
    const raw = window.localStorage.getItem(CURRENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { code?: string; username?: string };
    if (!parsed?.code || !parsed?.username) return null;
    return { code: parsed.code, username: parsed.username };
  } catch {
    return null;
  }
}

/**
 * Poll a lobby while the view is open. Realtime would be nicer, but the lobby is
 * small and a two-second poll keeps the two players in step without depending on
 * a channel staying subscribed — and it degrades to "just a bit stale" offline,
 * rather than silently freezing the standings.
 */
export function watchLobby(
  code: string,
  onUpdate: (lobby: RaceLobbyView) => void,
  onError?: (error: Error) => void,
  intervalMs = 2000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const lobby = await getLobby(code);
      if (!stopped) onUpdate(lobby);
    } catch (e) {
      if (!stopped) onError?.(e instanceof Error ? e : new Error(String(e)));
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/** "2:31" for a remaining-time readout; null when the mode is untimed. */
export function formatRemaining(closesAt: string | null, now = Date.now()): string | null {
  if (!closesAt) return null;
  const ms = Math.max(0, Date.parse(closesAt) - now);
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
