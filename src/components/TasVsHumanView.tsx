import * as React from "react";
import { ArrowUpDown, Loader2, Search, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowIcon } from "@/components/ArrowIcon";
import { cn } from "@/lib/utils";
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";
import { displayNameFor, matchesPlayerSearch, type ProfileDirectory } from "@/lib/display-name";
import {
  buildTasVsHumanRows,
  formatGap,
  sortTasVsHumanRows,
  summariseTasVsHuman,
  type TasVsHumanRow,
} from "@/lib/tas-vs-human";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import type { TasSummary } from "@/lib/tas-leaderboard";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  tasBoards: Record<string, TasSummary[]>;
  tasLoading?: boolean;
  profiles?: ProfileDirectory;
  formatTime: (seconds: number) => string;
  onLevelClick?: (levelId: string) => void;
  onPlayerClick?: (username: string) => void;
}

const ARROW_FILTERS: { value: ArrowKind | "all"; label: string }[] = [
  { value: "all", label: "All arrows" },
  { value: "narrow", label: "Narrow" },
  { value: "speedy", label: "Speedy" },
  { value: "energy", label: "Energy" },
];

function ArrowBadge({ arrow }: { arrow: string }) {
  if (!arrow) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-slate-400"
      title={arrow}
    >
      <ArrowIcon name={arrow} className="w-3 h-3" />
      {arrowKind(arrow)}
    </span>
  );
}

/**
 * The per-level TAS-vs-human table: every level's fastest human run beside the
 * fastest tool-assisted run, with the gap between them. The home page sums this
 * gap into one number; this is where the individual levels behind it live.
 *
 * Levels with no TAS run (and therefore no gap) are kept in the list — they are
 * what a TAS hunter still has to fill in — and the default sort sinks them.
 */
export function TasVsHumanView({
  levels,
  data,
  tasBoards,
  tasLoading,
  profiles,
  formatTime,
  onLevelClick,
  onPlayerClick,
}: Props) {
  const [arrow, setArrow] = React.useState<ArrowKind | "all">("all");
  const [sortBy, setSortBy] = React.useState<"gap" | "level">("gap");
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query);

  const rows = React.useMemo(
    () =>
      buildTasVsHumanRows(levels, data, tasBoards, {
        arrow: arrow === "all" ? undefined : arrow,
      }),
    [levels, data, tasBoards, arrow],
  );

  const summary = React.useMemo(() => summariseTasVsHuman(rows), [rows]);

  const visible = React.useMemo(() => {
    const sorted = sortTasVsHumanRows(rows, sortBy);
    const q = deferredQuery.trim();
    if (!q) return sorted;
    return sorted.filter(
      (row) =>
        row.levelName.toLowerCase().includes(q.toLowerCase()) ||
        matchesPlayerSearch(profiles, row.human?.username ?? "", q) ||
        matchesPlayerSearch(profiles, row.tas?.username ?? "", q),
    );
  }, [rows, sortBy, deferredQuery, profiles]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--app-accent)]" /> TAS vs human
          </h2>
          <p className="text-slate-500 text-sm">
            Every level's fastest human run next to the fastest tool-assisted run, with the gap
            between them — a negative gap means the TAS is ahead.
            {summary.compared > 0 && (
              <>
                {" "}
                The TAS leads {summary.tasAhead} of the {summary.compared} compared level
                {summary.compared === 1 ? "" : "s"}, a net{" "}
                <span
                  className={cn(
                    "font-mono",
                    summary.totalGap <= 0 ? "text-[#22c55e]" : "text-yellow-400",
                  )}
                >
                  {formatGap(summary.totalGap)}
                </span>
                .
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white/5 border border-white/10 rounded-lg p-1">
            {ARROW_FILTERS.map((option) => (
              <Button
                key={option.value}
                variant="ghost"
                size="sm"
                onClick={() => setArrow(option.value)}
                className={cn(
                  "h-7 text-[11px] rounded-md",
                  arrow === option.value
                    ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {option.label}
              </Button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortBy((prev) => (prev === "gap" ? "level" : "gap"))}
            title="Toggle between biggest TAS advantage and level name"
          >
            <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
            {sortBy === "gap" ? "Biggest gap" : "Level name"}
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search level or player..."
          className="bg-white/5 border-white/10 h-11 pl-10 focus-visible:ring-[var(--app-accent)]/50"
        />
      </div>

      <div className="flex flex-wrap gap-4 text-xs font-mono text-slate-500">
        <span>
          <span className="text-white font-bold">{summary.withTas}</span> of {summary.levels} levels
          have a TAS run
        </span>
        <span>
          <span className="text-[#22c55e] font-bold">{summary.tasAhead}</span> TAS ahead
        </span>
        <span>
          <span className="text-yellow-400 font-bold">{summary.humanAhead}</span> human ahead
        </span>
        {tasLoading && (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> loading TAS boards…
          </span>
        )}
      </div>

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/[0.02]">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Level
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Human WR
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  TAS
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Gap
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center py-8 text-slate-500 font-mono text-xs"
                  >
                    {query.trim()
                      ? "No level or player matches that search."
                      : "No levels to compare yet."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((row) => (
                  <TableRow key={row.levelId} className="border-white/5 hover:bg-white/[0.02]">
                    <TableCell className="py-2.5">
                      <div className="flex items-center gap-3">
                        <img
                          src={`https://api.narrowarrow.xyz/level-image/${row.levelId}.png`}
                          referrerPolicy="no-referrer"
                          alt=""
                          className="w-8 h-8 rounded border border-white/10 object-cover bg-black/40 shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => onLevelClick?.(row.levelId)}
                          className="font-bold text-[var(--app-accent)] hover:underline truncate text-left"
                        >
                          {row.levelName}
                        </button>
                      </div>
                    </TableCell>
                    <HumanOrTasSide
                      side={row.human}
                      profiles={profiles}
                      formatTime={formatTime}
                      onPlayerClick={onPlayerClick}
                      tone="text-yellow-400"
                      empty="no human run"
                    />
                    <HumanOrTasSide
                      side={row.tas}
                      profiles={profiles}
                      formatTime={formatTime}
                      onPlayerClick={onPlayerClick}
                      tone="text-[#22c55e]"
                      empty="no TAS run"
                    />
                    <TableCell className="text-right whitespace-nowrap">
                      <GapCell row={row} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function HumanOrTasSide({
  side,
  profiles,
  formatTime,
  onPlayerClick,
  tone,
  empty,
}: {
  side: TasVsHumanRow["human"];
  profiles?: ProfileDirectory;
  formatTime: (seconds: number) => string;
  onPlayerClick?: (username: string) => void;
  tone: string;
  empty: string;
}) {
  return (
    <TableCell className="py-2.5">
      {side ? (
        <div className="flex items-center gap-2">
          <span className={cn("font-mono font-bold whitespace-nowrap", tone)}>
            {formatTime(side.time)}
          </span>
          <button
            type="button"
            onClick={() => onPlayerClick?.(side.username)}
            className="text-slate-300 hover:text-[var(--app-accent)] truncate text-xs max-w-[140px] text-left"
          >
            {displayNameFor(profiles, side.username)}
          </button>
          <ArrowBadge arrow={side.arrow} />
        </div>
      ) : (
        <span className="text-slate-600 text-xs">{empty}</span>
      )}
    </TableCell>
  );
}

function GapCell({ row }: { row: TasVsHumanRow }) {
  if (row.delta === null) {
    return <span className="text-slate-600 text-xs font-mono">—</span>;
  }
  const ahead = row.delta < 0;
  return (
    <span
      className={cn("font-mono font-bold text-sm", ahead ? "text-[#22c55e]" : "text-yellow-400")}
      title={ahead ? "TAS is ahead of the human WR" : "The human WR is still ahead"}
    >
      {formatGap(row.delta)}
    </span>
  );
}
