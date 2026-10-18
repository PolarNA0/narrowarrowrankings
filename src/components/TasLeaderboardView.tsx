import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Loader2,
  Medal,
  Pencil,
  RefreshCw,
  Search,
  Tag,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LEVELS } from "@/constants";
import { fetchTasBoard, removeTasRun, renameTasRun, type TasEntry } from "@/lib/tas-leaderboard";
import { TasReplayViewer } from "@/components/ReplayViewer";
import { LevelPicker } from "@/components/LevelPicker";
import { ArrowIcon } from "@/components/ArrowIcon";
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";
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
  /** Save a practice checkpoint off a watched run, for the Play tab. */
  onMakeCheckpoint?: (request: TasCheckpointRequest) => void;
  /** Selected level, controlled by the app so it survives Tools tab switches. */
  levelId: string;
  onLevelChange: (id: string) => void;
}

/** A practice checkpoint request handed up from a watched TAS run. */
export interface TasCheckpointRequest {
  levelId: string;
  arrowName: string;
  tick: number;
}

/** One board per arrow, so each has its own winner. */
const ARROW_BOARDS: { kind: ArrowKind; label: string }[] = [
  { kind: "narrow", label: "Narrow Arrow" },
  { kind: "speedy", label: "Speedy Arrow" },
  { kind: "energy", label: "Energy Arrow" },
];

/**
 * The community TAS leaderboard. Unlike the real game board, these are
 * tool-assisted runs posted by players, so they live on their own board and
 * never touch the official rankings. It is split into one board per arrow, so
 * each arrow has its own WR.
 */
export function TasLeaderboardView({
  isAdmin,
  onLoadRun,
  onMakeCheckpoint,
  levelId,
  onLevelChange,
}: TasLeaderboardViewProps) {
  const [entries, setEntries] = React.useState<TasEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  /** Player-name filter, applied to every arrow board at once. */
  const [query, setQuery] = React.useState("");
  /** Newest-first ordering, for "what changed lately" rather than "who leads". */
  const [sortBy, setSortBy] = React.useState<"time" | "date">("time");
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

  const rename = async (entry: TasEntry) => {
    const next = window.prompt(`New name for ${entry.username}'s run:`, entry.username);
    if (next == null) return;
    const username = next.trim();
    if (!username || username === entry.username) return;
    setRenamingId(entry.id);
    try {
      setEntries(await renameTasRun(levelId, entry.id, username));
      toast.success(`Renamed to ${username}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename run.");
    } finally {
      setRenamingId(null);
    }
  };

  const levelName = LEVELS.find((l) => l.id === levelId)?.name ?? levelId;

  /** The level's position in the catalog, so the board can step to its neighbours. */
  const levelIndex = LEVELS.findIndex((l) => l.id === levelId);
  const gotoLevel = React.useCallback(
    (offset: number) => {
      const index = LEVELS.findIndex((l) => l.id === levelId);
      if (index < 0) return;
      const next = LEVELS[index + offset];
      if (next) onLevelChange(next.id);
    },
    [levelId, onLevelChange],
  );

  // Left/right arrows step through levels, so a browsing session does not need
  // the picker. Ignored while typing, and while any Radix popover/dialog/menu is
  // open — those use the arrow keys for their own navigation.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;
      if (
        document.querySelector(
          '[data-state="open"][role="dialog"], [data-radix-popper-content-wrapper]',
        )
      )
        return;
      if (e.key === "ArrowLeft") gotoLevel(-1);
      else if (e.key === "ArrowRight") gotoLevel(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gotoLevel]);

  const boardEntries = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ARROW_BOARDS.map((board) => {
      const all = entries.filter((e) => arrowKind(e.arrowName) === board.kind);
      const filtered = needle ? all.filter((e) => e.username.toLowerCase().includes(needle)) : all;
      // "time" keeps the WR pin on the fastest run; "date" is a plain
      // newest-first list, where the top row is simply the latest upload.
      const rows =
        sortBy === "date"
          ? [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : filtered;
      return { ...board, entries: rows, total: all.length };
    });
  }, [entries, query, sortBy]);

  /** Copy every arrow board as TSV, ready to paste into a sheet or a chat. */
  const copyBoard = async () => {
    const lines = ["Arrow", "Rank", "Player", "Time (s)", "Inputs", "Date"];
    for (const board of boardEntries) {
      board.entries.forEach((e, i) => {
        lines.push(
          [
            board.label,
            String(i + 1),
            e.username,
            (e.timeMs / 1000).toFixed(3),
            String(e.inputCount),
            new Date(e.createdAt).toISOString().slice(0, 10),
          ].join("\t"),
        );
      });
    }
    if (lines.length === 1) {
      toast.error("Nothing to copy on this level's boards.");
      return;
    }
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${lines.length - 1} rows from ${levelName}.`);
    } catch {
      window.prompt("Copy the board:", text);
    }
  };

  /** One arrow's board: its own table, with its own fastest run pinned as WR. */
  const renderBoard = (board: (typeof boardEntries)[number]) => {
    const rows = board.entries;
    const filteredOut = board.total - rows.length;
    return (
      <div
        key={board.kind}
        className="bg-black/30 border border-white/5 rounded-lg overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
          <ArrowIcon name={board.label} className="w-4 h-4" />
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            {board.label}
          </span>
          <span className="text-[11px] text-slate-500 ml-auto">
            {rows.length} {rows.length === 1 ? "time" : "times"}
            {filteredOut > 0 && <span className="text-slate-600"> of {board.total}</span>}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            {board.total > 0
              ? `No ${board.label} runs match “${query.trim()}”.`
              : `No ${board.label} times for ${levelName} yet.`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="text-left font-bold px-3 py-2 w-12">#</th>
                  <th className="text-left font-bold px-3 py-2">Player</th>
                  <th className="text-right font-bold px-3 py-2">Time</th>
                  <th className="text-right font-bold px-3 py-2 hidden sm:table-cell">Inputs</th>
                  <th className="text-right font-bold px-3 py-2 hidden md:table-cell">Date</th>
                  <th className="text-right font-bold px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry, i) => {
                  // The WR pin only makes sense in time order; in date order the
                  // top row is just the newest upload, not the fastest.
                  const isWr = sortBy === "time" && i === 0;
                  return (
                    <tr key={entry.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                      <td className="px-3 py-2 font-mono text-slate-500">
                        {isWr ? (
                          <span className="inline-flex items-center gap-1">
                            <Trophy className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                            <span className="text-[9px] font-bold text-[var(--app-accent)]">
                              WR
                            </span>
                          </span>
                        ) : (
                          <span
                            className={cn(
                              sortBy === "time" && i < 3 && "font-bold",
                              sortBy === "time" && i === 1 && "text-slate-300",
                              sortBy === "time" && i === 2 && "text-amber-700/80",
                            )}
                          >
                            {i + 1}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-200 truncate max-w-[12rem]">
                        {entry.username}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right font-mono",
                          isWr ? "text-[var(--app-accent)] font-bold" : "text-slate-200",
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
                            boardEntries={compareCandidates.filter(
                              (c) => c.id !== `tas-${entry.id}`,
                            )}
                            onMakeCheckpoint={
                              onMakeCheckpoint
                                ? (cp) =>
                                    onMakeCheckpoint({
                                      levelId,
                                      arrowName: entry.arrowName,
                                      tick: cp.tick,
                                    })
                                : undefined
                            }
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
                              title="Rename owner (re-attribute this run)"
                              disabled={renamingId === entry.id}
                              onClick={() => void rename(entry)}
                              className="text-slate-600 hover:text-amber-300 hover:bg-amber-500/10 h-8 w-8"
                            >
                              {renamingId === entry.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Tag className="w-4 h-4" />
                              )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Medal className="w-4 h-4 text-[var(--app-accent)]" /> TAS Leaderboard
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Tool-assisted runs submitted from the TAS editor, split into one board per arrow.
            Fastest time wins; each entry keeps the input string that reproduces it. This board is
            separate from the real game leaderboard.
          </p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Level
            </label>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0"
                title="Previous level"
                disabled={levelIndex <= 0}
                onClick={() => gotoLevel(-1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <LevelPicker value={levelId} onChange={(l) => onLevelChange(l.id)} className="w-44" />
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0"
                title="Next level"
                disabled={levelIndex < 0 || levelIndex >= LEVELS.length - 1}
                onClick={() => gotoLevel(1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Player
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name"
                className="bg-white/5 border-white/10 h-9 w-44 text-xs pl-8"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  aria-label="Clear player filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Sort
            </label>
            <div className="inline-flex rounded-md border border-white/10 overflow-hidden h-9">
              {(["time", "date"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSortBy(mode)}
                  className={cn(
                    "px-3 text-[10px] font-bold uppercase tracking-wider",
                    sortBy === mode
                      ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)]"
                      : "text-slate-500 hover:text-slate-300",
                  )}
                >
                  {mode === "time" ? "Fastest" : "Newest"}
                </button>
              ))}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 text-xs"
            onClick={() => void copyBoard()}
            title="Copy every board on this level as TSV"
          >
            <ClipboardCopy className="w-3.5 h-3.5 mr-1" /> Copy
          </Button>
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

      {loading && entries.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-500 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading TAS boards…
        </div>
      ) : error ? (
        <div className="py-16 text-center text-red-400 text-sm">{error}</div>
      ) : (
        <div className="space-y-4">{boardEntries.map(renderBoard)}</div>
      )}
    </div>
  );
}
