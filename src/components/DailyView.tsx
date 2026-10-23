import * as React from "react";
import { CalendarDays, Crown, Loader2, RefreshCw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  fetchDailyLevel,
  isRunOnDay,
  pickDailyLevel,
  recentDailyLevels,
  type DailyCandidate,
  type DailyLevel,
} from "@/lib/daily-level";
import type { LeaderboardEntry } from "@/types";

/** A board row: rank, player, time and arrow, as the daily boards show them. */
interface Row extends LeaderboardEntry {
  rank: number;
}

interface Props {
  /** The official levels the daily rotation draws from. */
  candidates: DailyCandidate[];
  /** Fetch a level's live leaderboard (upstream, through our proxy). */
  fetchBoard: (levelId: string) => Promise<LeaderboardEntry[]>;
  loading?: boolean;
  onOpenLevel: (levelId: string) => void;
  onPlayLevel?: (levelId: string) => void;
  formatTime: (seconds: number) => string;
}

type DailyTab = "daily" | "level";

/** Rank a board and cap it, so both subtabs share one row shape. */
function rank(entries: LeaderboardEntry[], limit: number): Row[] {
  return [...entries]
    .sort((a, b) => a.completion_time - b.completion_time)
    .slice(0, limit)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
}

/**
 * The Daily subtab: the game's featured level for today, in two inner subtabs.
 *
 * The upstream API only publishes per-level boards, so a "daily" board is that
 * level's runs set on the featured day, filtered out of the level board. That
 * is what makes the two subtabs differ — the daily board is the day's field and
 * the level board is all-time — and it means a past day still has a board,
 * because the runs it holds carry their own dates. A history strip lists the
 * previous picks so a day that was missed can still be inspected.
 */
export function DailyView({
  candidates,
  fetchBoard,
  loading,
  onOpenLevel,
  onPlayLevel,
  formatTime,
}: Props) {
  const [tab, setTab] = React.useState<DailyTab>("daily");
  // Seed from the rotation so the card paints on first render; the effect below
  // upgrades to the server's pick if `/startup-data` ever answers.
  const [daily, setDaily] = React.useState<DailyLevel | null>(() =>
    pickDailyLevel(candidates, new Date()),
  );
  const [entries, setEntries] = React.useState<LeaderboardEntry[]>([]);
  const [loadingRows, setLoadingRows] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);

  const history = React.useMemo(() => recentDailyLevels(candidates, 7), [candidates]);

  // The card shows today's pick unless the history strip selects another day.
  const shown = React.useMemo(() => {
    if (!selectedDay || !daily || selectedDay === daily.date) return daily;
    return history.find((h) => h.date === selectedDay) ?? daily;
  }, [selectedDay, daily, history]);

  const isToday = !!shown && shown.date === daily?.date;
  const levelId = shown?.levelId ?? null;

  // Resolve today's pick, preferring the server's when it is reachable.
  React.useEffect(() => {
    let cancelled = false;
    const seeded = pickDailyLevel(candidates, new Date());
    if (seeded) setDaily(seeded);
    fetchDailyLevel(candidates, new Date(), (level) => {
      if (!cancelled) setDaily(level);
    })
      .then((pick) => {
        if (!cancelled && pick) setDaily(pick);
      })
      .catch(() => {
        if (!cancelled) setError("Could not resolve today's featured level.");
      });
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  const load = React.useCallback(async () => {
    if (!levelId) return;
    setLoadingRows(true);
    setError(null);
    try {
      setEntries(await fetchBoard(levelId));
    } catch {
      setError("Could not load the leaderboard. Try refreshing.");
      setEntries([]);
    } finally {
      setLoadingRows(false);
    }
  }, [levelId, fetchBoard]);

  React.useEffect(() => {
    if (levelId) void load();
  }, [levelId, load]);

  // The daily board is the level board narrowed to the shown day's runs.
  const rows = React.useMemo(() => {
    if (tab === "level") return rank(entries, 100);
    const day = shown?.date;
    if (!day) return [];
    return rank(
      entries.filter((e) => isRunOnDay(e.created_at, day)),
      100,
    );
  }, [tab, entries, shown]);

  if (loading && !daily) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading the daily level…
      </div>
    );
  }

  if (!shown) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-16 text-center text-slate-400 text-sm">
          No featured level is available right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row gap-4 p-4">
            <img
              src={`https://api.narrowarrow.xyz/level-image/${shown.levelId}.png`}
              alt={shown.name}
              className="w-full sm:w-40 h-24 object-cover rounded border border-border bg-black/40"
              loading="lazy"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                <CalendarDays className="w-3.5 h-3.5" />
                {isToday ? "Featured" : "Featured on"} {shown.date}
                {isToday && shown.source === "upstream" ? (
                  <span className="text-[var(--app-accent)]">· server pick</span>
                ) : (
                  <span>· daily rotation</span>
                )}
              </div>
              <h2 className="text-lg font-bold text-white truncate mt-1">{shown.name}</h2>
              <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">{shown.levelId}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => onOpenLevel(shown.levelId)}
                >
                  <Trophy className="w-3.5 h-3.5 mr-1" /> Open leaderboard
                </Button>
                {onPlayLevel && isToday && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => onPlayLevel(shown.levelId)}
                  >
                    Play
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-slate-400"
                  onClick={() => void load()}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 mr-1", loadingRows && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {history.length > 1 && (
            <div className="border-t border-border px-4 py-2 flex items-center gap-2 overflow-x-auto">
              <span className="text-[10px] uppercase text-slate-500 shrink-0">Recent</span>
              {history.map((pick) => (
                <button
                  key={pick.date}
                  onClick={() => setSelectedDay(pick.date === daily?.date ? null : pick.date)}
                  className={cn(
                    "shrink-0 text-[10px] px-2 py-1 rounded border transition-colors",
                    pick.date === shown.date
                      ? "border-[var(--app-accent)]/50 text-[var(--app-accent)]"
                      : "border-border text-slate-400 hover:text-white",
                  )}
                  title={pick.name}
                >
                  {pick.date.slice(5)}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-1 border-b border-border pb-3">
        {(
          [
            { id: "daily", label: "Daily leaderboard" },
            { id: "level", label: "Level leaderboard" },
          ] as const
        ).map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? "secondary" : "ghost"}
            size="sm"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={cn("text-xs", tab === t.id && "font-bold")}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span>{error}</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {loadingRows ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading leaderboard…
        </div>
      ) : rows.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center text-slate-400 text-sm">
            {tab === "daily"
              ? `No runs recorded on ${shown.date} yet.`
              : "No runs on this board yet."}
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card border-border overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase text-slate-500 border-b border-border">
                  <th className="text-left px-4 py-2 w-16">Rank</th>
                  <th className="text-left px-4 py-2">Player</th>
                  <th className="text-left px-4 py-2 hidden sm:table-cell">Arrow</th>
                  <th className="text-right px-4 py-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={`${row.run_id}-${row.rank}`}
                    className="border-b border-border/50 last:border-0 hover:bg-white/5"
                  >
                    <td className="px-4 py-2 text-slate-400 tabular-nums">
                      {row.rank === 1 ? (
                        <Crown className="w-3.5 h-3.5 text-yellow-400" />
                      ) : (
                        row.rank
                      )}
                    </td>
                    <td className="px-4 py-2 text-white truncate">{row.username}</td>
                    <td className="px-4 py-2 text-slate-400 hidden sm:table-cell">
                      {row.arrow_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-200">
                      {formatTime(row.completion_time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
