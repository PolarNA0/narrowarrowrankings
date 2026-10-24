import * as React from "react";
import { ChevronDown, Loader2, RefreshCw, Swords, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchRecentMatches, type RaceMatch } from "@/lib/race-matches";
import { cn } from "@/lib/utils";
import { displayNameFor, type ProfileDirectory } from "@/lib/display-name";

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function fmtWhen(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A player's rounds as one line: `0:09.500 · 0:12.031 · —`. */
function timeLine(timesMs: Array<number | null>): string {
  return timesMs.map((t) => (t === null ? "—" : fmtTime(t / 1000))).join(" · ");
}

function MatchRow({ match, profiles }: { match: RaceMatch; profiles?: ProfileDirectory }) {
  const [open, setOpen] = React.useState(false);
  const decided = match.winner !== null;
  // Only endurance is decided on the combined time, so the running total is
  // meaningful there and noise everywhere else.
  const showTotal = match.mode === "endurance";

  return (
    <Card className="bg-white/5 border-white/10 overflow-hidden">
      <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-[var(--app-accent)]/10 text-[var(--app-accent)] border-[var(--app-accent)]/20 text-[9px] uppercase">
            {match.modeName}
          </Badge>
          <CardTitle className="text-sm font-bold text-white">{match.levelName}</CardTitle>
          <span className="text-[11px] text-slate-500 font-mono">{match.arrowName}</span>
          <span className="ml-auto text-[11px] text-slate-500 font-mono">
            {fmtWhen(match.playedAt)}
          </span>
          <span className="text-[10px] text-slate-600 font-mono uppercase tracking-widest">
            {match.code}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-white/5">
            {match.perPlayer.map((player) => {
              const won = decided && player.username === match.winner;
              return (
                <tr key={player.username} className={cn(won && "bg-amber-500/[0.06]")}>
                  <td className="p-3 w-8">
                    {won && <Trophy className="w-4 h-4 text-amber-400" aria-label="Winner" />}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-bold", won ? "text-amber-300" : "text-white")}>
                        {displayNameFor(profiles, player.username)}
                      </span>
                      {won && (
                        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] uppercase">
                          Winner
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-right font-mono text-xs text-[#2DD4BF]">
                    {timeLine(player.timesMs)}
                  </td>
                  <td className="p-3 text-right font-mono text-xs text-slate-400 w-28">
                    {showTotal && player.totalMs !== null && (
                      <span>Σ {fmtTime(player.totalMs / 1000)}</span>
                    )}
                    {player.droppedSlowest && (
                      <span className="ml-1 text-[10px] text-slate-600">slowest dropped</span>
                    )}
                  </td>
                  <td className="p-3 text-right font-mono text-xs text-slate-500 w-20">
                    {player.roundsWon} {player.roundsWon === 1 ? "round" : "rounds"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {match.tie && (
          <p className="px-3 py-2 text-[11px] text-slate-400 border-t border-white/5">
            Drawn — no outright winner.
          </p>
        )}

        <button
          className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-white/[0.03] transition-colors border-t border-white/5"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
          {open ? "Hide rounds" : "Show rounds"}
        </button>

        {open && (
          <div className="divide-y divide-white/5 border-t border-white/5">
            {match.perPlayer[0].timesMs.map((_, round) => (
              <div key={round} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-16 text-xs font-semibold text-slate-400">Round {round + 1}</span>
                {match.perPlayer.map((player) => (
                  <span key={player.username} className="font-mono text-xs text-slate-300">
                    {displayNameFor(profiles, player.username)}:{" "}
                    {player.timesMs[round] === null ? "—" : fmtTime(player.timesMs[round]! / 1000)}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentMatchesView({ profiles }: { profiles?: ProfileDirectory }) {
  const [matches, setMatches] = React.useState<RaceMatch[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setMatches(await fetchRecentMatches());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load matches.");
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Swords className="w-5 h-5 text-[var(--app-accent)]" /> Recent matches
          </h2>
          <p className="text-xs text-slate-400">
            Finished 1v1 races, newest first — the players, the mode, every round's time, and the
            winner.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto gap-1.5 text-xs"
          onClick={() => void load()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {matches === null && !error && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-xs font-mono">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading matches…
        </div>
      )}

      {matches !== null && matches.length === 0 && (
        <p className="rounded border border-border bg-card px-4 py-10 text-center text-slate-500 text-xs font-mono">
          No finished matches yet. Open a lobby in Play → 1v1 Race and finish a match.
        </p>
      )}

      <div className="space-y-3">
        {matches?.map((match) => (
          <MatchRow key={match.code} match={match} profiles={profiles} />
        ))}
      </div>
    </div>
  );
}
