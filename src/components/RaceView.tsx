import * as React from "react";
import {
  ArrowRight,
  Clock,
  Copy,
  Crown,
  Flag,
  Loader2,
  LogOut,
  Swords,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LevelPicker, type PickedLevel } from "@/components/LevelPicker";
import { cn } from "@/lib/utils";
import {
  RACE_MODES,
  DEFAULT_RACE_MODE,
  isValidLobbyCode,
  normalizeLobbyCode,
  raceMode,
  type RaceModeId,
} from "@/lib/race-modes";
import {
  createLobby,
  formatRemaining,
  forgetLobby,
  getLobby,
  joinLobby,
  leaveLobby,
  loadRememberedLobby,
  rememberLobby,
  watchLobby,
  type RaceLobbyView,
} from "@/lib/race-lobby";
import { loadPlayerName, savePlayerName } from "@/lib/play-history";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/** The level and arrow a race is pinned to, handed to the Play engine to run. */
export interface RacePlayTarget {
  code: string;
  username: string;
  round: number;
  levelId: string;
  arrowName: string;
}

/**
 * The 1v1 race room. A player opens a lobby (picking a level, arrow and mode) or
 * joins one by its code; both then see the same live standings. Races are
 * asynchronous — each player runs alone inside the window — so nothing here waits
 * on the other player being online at the same moment.
 */
export function RaceView({ onPlayRace }: { onPlayRace: (target: RacePlayTarget) => void }) {
  const [name, setName] = React.useState("");
  const [lobby, setLobby] = React.useState<RaceLobbyView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  // Create form
  const [picked, setPicked] = React.useState<PickedLevel | null>(null);
  const [arrowName, setArrowName] = React.useState<string>(ARROWS[0]);
  const [mode, setMode] = React.useState<RaceModeId>(DEFAULT_RACE_MODE);

  // Join form
  const [joinCode, setJoinCode] = React.useState("");

  React.useEffect(() => {
    setName(loadPlayerName());
  }, []);

  const changeName = (next: string) => {
    setName(next);
    savePlayerName(next.trim());
  };

  // Keep the countdown live without re-polling every second.
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Follow the lobby while one is open.
  const lobbyCode = lobby?.code ?? null;
  React.useEffect(() => {
    if (!lobbyCode) return;
    const stop = watchLobby(
      lobbyCode,
      (next) => setLobby(next),
      () => {
        /* a blip just leaves the last-known standings up */
      },
    );
    return stop;
  }, [lobbyCode]);

  // Offer to rejoin a lobby this browser was in, so a reload is not a lost match.
  React.useEffect(() => {
    const remembered = loadRememberedLobby();
    if (!remembered) return;
    let cancelled = false;
    void getLobby(remembered.code)
      .then((found) => {
        if (!cancelled && !found.closed && found.players.includes(remembered.username)) {
          setLobby(found);
          toast.message(`Back in lobby ${found.code}`);
        } else if (!cancelled) {
          forgetLobby();
        }
      })
      .catch(() => {
        if (!cancelled) forgetLobby();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requireName = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Set your name first.");
      return null;
    }
    return trimmed;
  };

  const openLobby = async () => {
    const who = requireName();
    if (!who) return;
    if (!picked) {
      toast.error("Pick a level to race.");
      return;
    }
    setBusy(true);
    try {
      const created = await createLobby({
        username: who,
        levelId: picked.id,
        levelName: picked.name,
        arrowName,
        mode,
      });
      rememberLobby(created.code, who);
      setLobby(created);
      toast.success(`Lobby ${created.code} open — share the code.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open a lobby");
    } finally {
      setBusy(false);
    }
  };

  const joinByCode = async () => {
    const who = requireName();
    if (!who) return;
    const code = normalizeLobbyCode(joinCode);
    if (!isValidLobbyCode(code)) {
      toast.error("That is not a lobby code.");
      return;
    }
    setBusy(true);
    try {
      const joined = await joinLobby(code, who);
      rememberLobby(joined.code, who);
      setLobby(joined);
      toast.success(`Joined lobby ${joined.code}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not join that lobby");
    } finally {
      setBusy(false);
    }
  };

  const exitLobby = async () => {
    const current = lobby;
    if (!current) return;
    const who = name.trim();
    // Leaving as host would strand the other player, so the host just closes the
    // view; the lobby stays joinable until it expires.
    if (who && who !== current.host) {
      try {
        await leaveLobby(current.code, who);
      } catch {
        /* leaving is best effort */
      }
    }
    forgetLobby();
    setLobby(null);
  };

  const copyCode = async () => {
    if (!lobby) return;
    try {
      await navigator.clipboard.writeText(lobby.code);
      toast.success("Lobby code copied");
    } catch {
      toast.message(`Lobby code: ${lobby.code}`);
    }
  };

  const who = name.trim();
  const myRounds = lobby
    ? Array.from({ length: lobby.rounds }, (_, r) => r).filter(
        (r) => !lobby.runs.some((run) => run.username === who && run.round === r),
      )
    : [];
  const opponent = lobby?.players.find((p) => p !== who) ?? null;
  const remaining = lobby ? formatRemaining(lobby.closesAt, now) : null;
  const activeMode = raceMode(lobby?.mode ?? mode);

  // ---- name bar -------------------------------------------------------------

  const nameBar = (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      <Label
        htmlFor="race-username"
        className="text-[10px] uppercase tracking-widest text-slate-500 font-bold"
      >
        Player
      </Label>
      <Input
        id="race-username"
        value={name}
        onChange={(e) => changeName(e.target.value)}
        placeholder="Your name"
        maxLength={32}
        className="h-8 w-full max-w-[220px] bg-white/5 border-white/10 text-sm"
      />
      <span className="text-[11px] text-slate-500">
        Races are asynchronous — run whenever, fastest wins.
      </span>
    </div>
  );

  // ---- the room -------------------------------------------------------------

  if (lobby) {
    const mode = raceMode(lobby.mode);
    return (
      <div className="space-y-4">
        {nameBar}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--app-accent)]/40 bg-[var(--app-accent)]/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <Swords className="w-5 h-5 text-[var(--app-accent)]" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg font-bold tracking-[0.2em] text-[var(--app-accent)]">
                  {lobby.code}
                </span>
                <Button variant="ghost" size="sm" className="h-6 px-2" onClick={copyCode}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
              <p className="text-[11px] text-slate-400">
                {lobby.modeName} · {lobby.levelName} · {lobby.arrowName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {remaining !== null && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 font-mono",
                  remaining === "0:00" ? "text-red-400" : "text-slate-300",
                )}
              >
                <Clock className="w-3 h-3" />
                {remaining}
              </Badge>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exitLobby}>
              <LogOut className="w-3.5 h-3.5" />
              Leave
            </Button>
          </div>
        </div>

        <p className="text-xs text-slate-400">{mode.rules}</p>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Players */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Users className="w-3.5 h-3.5" /> Players
            </div>
            <ul className="space-y-2">
              {lobby.players.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                      p === who
                        ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)]"
                        : "bg-white/5 text-slate-300",
                    )}
                  >
                    {p.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm text-slate-200">{p}</span>
                  {p === lobby.host && (
                    <Crown className="w-3.5 h-3.5 text-amber-400" aria-label="Host" />
                  )}
                  {p === who && <span className="text-[10px] text-slate-500">(you)</span>}
                </li>
              ))}
              {lobby.players.length < 2 && (
                <li className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-white/15 text-xs">
                    ?
                  </span>
                  Waiting for an opponent — share code {lobby.code}
                </li>
              )}
            </ul>
          </div>

          {/* Standings */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Trophy className="w-3.5 h-3.5" /> Standings
            </div>
            <ul className="space-y-2">
              {lobby.result.standings.map((s) => (
                <li key={s.username} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200">
                    {s.username}
                    {lobby.result.winner === s.username && (
                      <Trophy className="ml-1.5 inline w-3.5 h-3.5 text-amber-400" />
                    )}
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    {activeMode.id === "endurance"
                      ? s.totalMs !== null
                        ? `Σ ${fmtTime(s.totalMs / 1000)}`
                        : "—"
                      : mode.rounds > 1
                        ? `${s.roundsWon} round${s.roundsWon === 1 ? "" : "s"}`
                        : s.timeMs !== null
                          ? fmtTime(s.timeMs / 1000)
                          : "—"}
                  </span>
                </li>
              ))}
            </ul>
            {lobby.result.complete && (
              <p className="mt-3 border-t border-border pt-3 text-sm font-semibold text-[var(--app-accent)]">
                {lobby.result.winner
                  ? `${lobby.result.winner} wins`
                  : lobby.result.tie
                    ? "Draw"
                    : "No winner"}
              </p>
            )}
          </div>
        </div>

        {/* Rounds */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
            <Flag className="w-3.5 h-3.5" /> Rounds
          </div>
          <div className="space-y-2">
            {Array.from({ length: lobby.rounds }, (_, round) => {
              const mine = lobby.runs.find((r) => r.username === who && r.round === round);
              const theirs = opponent
                ? lobby.runs.find((r) => r.username === opponent && r.round === round)
                : undefined;
              const roundResult = lobby.result.rounds[round];
              const canPlay = myRounds.includes(round) && !lobby.closed;
              return (
                <div
                  key={round}
                  className="flex flex-wrap items-center gap-3 rounded border border-border/60 px-3 py-2"
                >
                  <span className="w-16 text-xs font-semibold text-slate-400">
                    Round {round + 1}
                  </span>
                  <span className="font-mono text-xs text-slate-300">
                    You: {mine ? fmtTime(mine.timeMs / 1000) : "—"}
                  </span>
                  <span className="font-mono text-xs text-slate-300">
                    {opponent ?? "Opponent"}: {theirs ? fmtTime(theirs.timeMs / 1000) : "—"}
                  </span>
                  {roundResult?.winner && (
                    <span className="text-[11px] text-emerald-400">
                      {roundResult.winner} took it
                    </span>
                  )}
                  {roundResult?.tie && <span className="text-[11px] text-slate-500">tied</span>}
                  <div className="ml-auto">
                    {canPlay ? (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() =>
                          onPlayRace({
                            code: lobby.code,
                            username: who,
                            round,
                            levelId: lobby.levelId,
                            arrowName: lobby.arrowName,
                          })
                        }
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        Race this round
                      </Button>
                    ) : mine ? (
                      <span className="text-[11px] text-slate-500">posted</span>
                    ) : (
                      <span className="text-[11px] text-slate-500">closed</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {lobby.closed && !lobby.result.complete && (
            <p className="mt-3 text-[11px] text-amber-400">
              The window has closed — rounds still outstanding are forfeited.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---- the lobby browser ----------------------------------------------------

  return (
    <div className="space-y-4">
      {nameBar}

      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Swords className="w-5 h-5 text-[var(--app-accent)]" /> 1v1 races
        </h2>
        <p className="text-xs text-slate-400">
          Race a friend on the same level. Run whenever you like inside the window — the fastest run
          wins.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Create */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-semibold text-slate-300">Open a lobby</div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500">Level</Label>
            <LevelPicker value={picked?.id ?? ""} onChange={setPicked} />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500">Arrow</Label>
            <div className="flex flex-wrap gap-1.5">
              {ARROWS.map((a) => (
                <Button
                  key={a}
                  variant={a === arrowName ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setArrowName(a)}
                >
                  {a}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500">Mode</Label>
            <div className="grid gap-1.5">
              {RACE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "rounded border px-3 py-2 text-left transition-colors",
                    m.id === mode
                      ? "border-[var(--app-accent)]/60 bg-[var(--app-accent)]/10"
                      : "border-border hover:border-white/20",
                  )}
                >
                  <div className="text-xs font-semibold text-slate-200">{m.name}</div>
                  <div className="text-[11px] text-slate-500">{m.blurb}</div>
                </button>
              ))}
            </div>
          </div>

          <Button className="w-full gap-1.5" disabled={busy} onClick={openLobby}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Swords className="w-4 h-4" />}
            Open lobby
          </Button>
        </div>

        {/* Join */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="text-xs font-semibold text-slate-300">Join a lobby</div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-widest text-slate-500">
              Lobby code
            </Label>
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") void joinByCode();
              }}
              placeholder="BCDF23"
              maxLength={6}
              className="bg-white/5 border-white/10 font-mono text-lg tracking-[0.3em] uppercase"
            />
          </div>
          <Button
            variant="outline"
            className="w-full gap-1.5"
            disabled={busy || !isValidLobbyCode(normalizeLobbyCode(joinCode))}
            onClick={joinByCode}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            Join
          </Button>
          <p className="text-[11px] text-slate-500">
            The code is the only credential — share it only with who you want to race. Anyone with
            the code can join under any name.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Small helper so the view can be dismissed from a parent without a dialog. */
export function RaceDismiss({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onClose} title="Close">
      <X className="w-3.5 h-3.5" />
    </Button>
  );
}
