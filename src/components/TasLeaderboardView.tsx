import * as React from "react";
import { Loader2, Medal, Pencil, RefreshCw, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LEVELS } from "@/constants";
import { fetchTasBoard, removeTasRun, type TasEntry } from "@/lib/tas-leaderboard";
import { TasReplayViewer } from "@/components/ReplayViewer";
import { fetchLeaderboard } from "@/services/api";
import type { CompareCandidate } from "@/hooks/useCompareGhosts";
import type { LeaderboardEntry } from "@/types";

/** A TAS entry handed to the editor so it can be edited like any other run. */
export interface TasLoadRequest {
  levelId: string;
  arrowName: string;
  inputs: string;
  inputCount: number;
}

interface TasLeaderboardViewProps {
  isAdmin?: boolean;
  onLoadRun?: (request: TasLoadRequest) => void;
}

/**
 * The community TAS leaderboard. Unlike the real game board, these are
 * tool-assisted runs posted by players, so they live on their own board and
 * never touch the official rankings.
 */
export function TasLeaderboardView({ isAdmin, onLoadRun }: TasLeaderboardViewProps) {
  const [levelId, setLevelId] = React.useState(LEVELS[0]?.id ?? "");
  const [entries, setEntries] = React.useState<TasEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  // The level's real-game runs, so a TAS run can be compared against a human one.
  const [humanEntries, setHumanEntries] = React.useState<LeaderboardEntry[]>([]);

  const load = React.useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchTasBoard(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(levelId);
  }, [levelId, load]);

  // The real-game board for this level, so a TAS run can be compared against a
  // human run (and vice versa) on the same stage.
  React.useEffect(() => {
    let cancelled = false;
    setHumanEntries([]);
    fetchLeaderboard(levelId, false, true)
      .then((entries) => {
        if (!cancelled) setHumanEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setHumanEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [levelId]);

  const compareCandidates = React.useMemo<CompareCandidate[]>(() => {
    const human: CompareCandidate[] = humanEntries
      .filter((e) => !e.isLegacy && e.run_id > 0)
      .map((e) => ({
        id: `run-${e.run_id}`,
        runId: e.run_id,
        username: e.username,
        inputs: "",
        inputCount: 0,
        arrowName: e.arrow_name,
        timeMs: Math.round(e.completion_time * 1000),
        kind: "human" as const,
      }));
    const tas: CompareCandidate[] = entries.map((e) => ({
      id: `tas-${e.id}`,
      username: e.username,
      inputs: e.inputs,
      inputCount: e.inputCount,
      arrowName: e.arrowName,
      timeMs: e.timeMs,
      kind: "tas" as const,
    }));
    return [...human, ...tas];
  }, [humanEntries, entries]);

  const remove = async (entry: TasEntry) => {
    if (
      !window.confirm(
        `Remove ${entry.username}'s ${(entry.timeMs / 1000).toFixed(3)}s run from the TAS board?`,
      )
    )
      return;
    setRemovingId(entry.id);
    try {
      setEntries(await removeTasRun(levelId, entry.id));
      toast.success(`Removed ${entry.username}'s run`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove run.");
    } finally {
      setRemovingId(null);
    }
  };

  const levelName = LEVELS.find((l) => l.id === levelId)?.name ?? levelId;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Medal className="w-4 h-4 text-[var(--app-accent)]" /> TAS Leaderboard
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Tool-assisted runs submitted from the TAS editor. Fastest time wins; each entry keeps
            the input string that reproduces it. This board is separate from the real game
            leaderboard.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Level
            </label>
            <Select value={levelId} onValueChange={setLevelId}>
              <SelectTrigger className="bg-white/5 border-white/10 h-9 text-xs w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-72">
                {LEVELS.map((l) => (
                  <SelectItem key={l.id} value={l.id} className="text-xs">
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 text-xs"
            onClick={() => void load(levelId)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="bg-black/30 border border-white/5 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            {levelName}
          </span>
          <span className="text-[11px] text-slate-500 ml-auto">
            {entries.length} {entries.length === 1 ? "time" : "times"}
          </span>
        </div>

        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading TAS board…
          </div>
        ) : error ? (
          <div className="py-16 text-center text-red-400 text-sm">{error}</div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            No TAS times for {levelName} yet. Finish a run in the TAS editor and hit “Submit TAS” to
            set the first.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="text-left font-bold px-3 py-2 w-12">#</th>
                  <th className="text-left font-bold px-3 py-2">Player</th>
                  <th className="text-left font-bold px-3 py-2">Arrow</th>
                  <th className="text-right font-bold px-3 py-2">Time</th>
                  <th className="text-right font-bold px-3 py-2 hidden sm:table-cell">Inputs</th>
                  <th className="text-right font-bold px-3 py-2 hidden md:table-cell">Date</th>
                  <th className="text-right font-bold px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, i) => (
                  <tr key={entry.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                    <td className="px-3 py-2 font-mono text-slate-500">
                      {i === 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <Trophy className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                          <span className="text-[9px] font-bold text-[var(--app-accent)]">WR</span>
                        </span>
                      ) : (
                        i + 1
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-200 truncate max-w-[12rem]">
                      {entry.username}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{entry.arrowName}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        i === 0 ? "text-[var(--app-accent)] font-bold" : "text-slate-200",
                      )}
                    >
                      {(entry.timeMs / 1000).toFixed(3)}s
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-500 hidden sm:table-cell">
                      {entry.inputCount}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500 hidden md:table-cell">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-0.5">
                        <TasReplayViewer
                          levelId={levelId}
                          levelName={levelName}
                          username={entry.username}
                          arrowName={entry.arrowName}
                          inputs={entry.inputs}
                          inputCount={entry.inputCount}
                          timeMs={entry.timeMs}
                          boardEntries={compareCandidates.filter((c) => c.id !== `tas-${entry.id}`)}
                        />
                        {onLoadRun && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Load into the TAS editor"
                            onClick={() =>
                              onLoadRun({
                                levelId,
                                arrowName: entry.arrowName,
                                inputs: entry.inputs,
                                inputCount: entry.inputCount,
                              })
                            }
                            className="text-slate-500 hover:text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10 h-8 w-8"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Remove run from TAS board"
                            disabled={removingId === entry.id}
                            onClick={() => void remove(entry)}
                            className="text-slate-600 hover:text-red-400 hover:bg-red-500/10 h-8 w-8"
                          >
                            {removingId === entry.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <X className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
