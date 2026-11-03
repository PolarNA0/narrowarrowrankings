import * as React from "react";
import { ArrowUpDown, Loader2, RefreshCw, Search, Shield, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  buildUnbeatenAuthorRows,
  sortUnbeatenAuthorRows,
  summariseUnbeatenAuthors,
  tallyUnbeatenAuthors,
  type UnbeatenAuthorRow,
  type UnbeatenSort,
} from "@/lib/unbeaten-authors";
import { fetchCustomLevelFeed, type CustomLevelCompact } from "@/lib/unbeaten-authors-client";

interface Props {
  profiles?: ProfileDirectory;
  /** Open the level in the Customs browser. */
  onLevelClick?: (levelId: string) => void;
  onPlayerClick?: (username: string) => void;
  formatTime: (seconds: number) => string;
}

const ARROW_FILTERS: { value: ArrowKind | "all"; label: string }[] = [
  { value: "all", label: "All arrows" },
  { value: "narrow", label: "Narrow" },
  { value: "speedy", label: "Speedy" },
  { value: "energy", label: "Energy" },
];

const SORT_OPTIONS: { value: UnbeatenSort; label: string; hint: string }[] = [
  { value: "plays", label: "Most played", hint: "The most-contested unbeaten times first" },
  { value: "gap", label: "Widest margin", hint: "How far the author still leads the best run" },
  { value: "time", label: "Fastest", hint: "The quickest author times" },
  { value: "recent", label: "Newest", hint: "The most recently published levels" },
  { value: "author", label: "Author", hint: "Group the levels by author" },
];

/** Minimum play counts offered as a "how contested" filter. */
const MIN_PLAY_OPTIONS = [0, 10, 50];

/**
 * "Unbeaten authors": community levels whose creator's own time is still the
 * fastest anyone has recorded.
 *
 * The author's time is the level's `medals.topTime` (the top/diamond threshold
 * is seeded from the author's run), so a level is unbeaten while no recorded run
 * has gone under it. The feed is swept in the background by
 * `/api/unbeaten-authors`, so this view never issues a per-level request.
 */
export function UnbeatenAuthorsView({ profiles, onLevelClick, onPlayerClick, formatTime }: Props) {
  const [levels, setLevels] = React.useState<CustomLevelCompact[]>([]);
  const [done, setDone] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [arrow, setArrow] = React.useState<ArrowKind | "all">("all");
  const [minPlays, setMinPlays] = React.useState(0);
  const [sortBy, setSortBy] = React.useState<UnbeatenSort>("plays");
  const [query, setQuery] = React.useState("");
  const deferredQuery = React.useDeferredValue(query);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const payload = await fetchCustomLevelFeed();
      setLevels(payload.levels);
      setDone(payload.done);
      return payload.done;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return true; // stop polling on error rather than hammering a failing route
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // The snapshot warms a bounded batch per request (the feed is ~300 pages and
  // the upstream budget is ~60/min), so a cold server needs several minutes. Poll
  // while it is incomplete and stop once the sweep is done. The interval sits
  // just above the route's own refresh gate, so a poll is never swallowed by it.
  React.useEffect(() => {
    if (done) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const finished = await load();
      if (cancelled || finished) clearInterval(timer);
    }, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [done, load]);

  const rows = React.useMemo(
    () =>
      buildUnbeatenAuthorRows(levels, {
        arrow: arrow === "all" ? undefined : arrow,
        minPlays,
      }),
    [levels, arrow, minPlays],
  );

  const summary = React.useMemo(() => summariseUnbeatenAuthors(rows), [rows]);
  const tally = React.useMemo(() => tallyUnbeatenAuthors(rows), [rows]);

  const visible = React.useMemo(() => {
    const sorted = sortUnbeatenAuthorRows(rows, sortBy);
    const q = deferredQuery.trim();
    if (!q) return sorted;
    return sorted.filter(
      (row) =>
        row.levelName.toLowerCase().includes(q.toLowerCase()) ||
        matchesPlayerSearch(profiles, row.author, q),
    );
  }, [rows, sortBy, deferredQuery, profiles]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--app-accent)]" /> Unbeaten authors
          </h2>
          <p className="text-slate-500 text-sm">
            Community levels whose creator's own time is still the fastest anyone has recorded. A
            custom level's top-medal threshold is seeded from the author's run, so this reads the
            author's time and checks no recorded run has gone under it. Swept from the
            published-levels feed, so a freshly published level may take a few minutes to appear.
            {!done && !loading && (
              <>
                {" "}
                Still warming the feed — showing {summary.levels} unbeaten time
                {summary.levels === 1 ? "" : "s"} found so far.
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
            onClick={() => void load()}
            disabled={loading}
            title="Fetch the latest snapshot"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search level or author..."
            className="bg-white/5 border-white/10 h-10 pl-10 focus-visible:ring-[var(--app-accent)]/50"
          />
        </div>
        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500">
          <span className="mr-1">Min plays</span>
          {MIN_PLAY_OPTIONS.map((value) => (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              onClick={() => setMinPlays(value)}
              className={cn(
                "h-7 text-[11px] rounded-md",
                minPlays === value
                  ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                  : "text-slate-400 hover:text-white",
              )}
            >
              {value === 0 ? "Any" : `${value}+`}
            </Button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const index = SORT_OPTIONS.findIndex((o) => o.value === sortBy);
            setSortBy(SORT_OPTIONS[(index + 1) % SORT_OPTIONS.length].value);
          }}
          title={SORT_OPTIONS.find((o) => o.value === sortBy)?.hint}
        >
          <ArrowUpDown className="w-3.5 h-3.5 mr-1.5" />
          {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 text-xs font-mono text-slate-500">
        <span>
          <span className="text-white font-bold">{summary.levels}</span> unbeaten time
          {summary.levels === 1 ? "" : "s"}
        </span>
        <span>
          <span className="text-[var(--app-accent)] font-bold">{summary.authors}</span> author
          {summary.authors === 1 ? "" : "s"}
        </span>
        <span>
          <span className="text-slate-300 font-bold">{summary.plays.toLocaleString()}</span> total
          plays
        </span>
        {summary.fastest !== null && (
          <span>
            fastest <span className="text-yellow-400 font-bold">{formatTime(summary.fastest)}</span>
          </span>
        )}
        {summary.closest !== null && (
          <span>
            closest to falling{" "}
            <span className="text-sky-300 font-bold">{formatTime(summary.closest)}</span>
          </span>
        )}
        {loading && (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> loading feed…
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {tally.length > 1 && (
        <Card className="bg-white/5 border-white/10">
          <div className="flex flex-wrap gap-2 p-3">
            {tally.slice(0, 12).map((entry) => (
              <button
                key={entry.author.toLowerCase()}
                type="button"
                onClick={() => onPlayerClick?.(entry.author)}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-xs hover:border-[var(--app-accent)]/50"
                title={`${entry.defended} unbeaten time${entry.defended === 1 ? "" : "s"}`}
              >
                <span className="text-slate-200">{displayNameFor(profiles, entry.author)}</span>
                <span className="font-mono font-bold text-[var(--app-accent)]">
                  {entry.defended}
                </span>
              </button>
            ))}
            {tally.length > 12 && (
              <span className="self-center text-[11px] text-slate-500 font-mono">
                +{tally.length - 12} more
              </span>
            )}
          </div>
        </Card>
      )}

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/[0.02]">
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Level
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Author
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Author time
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Best run
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Arrow
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Plays
                </TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Likes
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-slate-500 font-mono text-xs"
                  >
                    {loading
                      ? "Loading the community feed…"
                      : query.trim() || minPlays > 0 || arrow !== "all"
                        ? "No unbeaten time matches those filters."
                        : "No unbeaten author times found yet."}
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((row) => (
                  <UnbeatenRow
                    key={row.levelId}
                    row={row}
                    profiles={profiles}
                    formatTime={formatTime}
                    onLevelClick={onLevelClick}
                    onPlayerClick={onPlayerClick}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function UnbeatenRow({
  row,
  profiles,
  formatTime,
  onLevelClick,
  onPlayerClick,
}: {
  row: UnbeatenAuthorRow;
  profiles?: ProfileDirectory;
  formatTime: (seconds: number) => string;
  onLevelClick?: (levelId: string) => void;
  onPlayerClick?: (username: string) => void;
}) {
  return (
    <TableRow className="border-white/5 hover:bg-white/[0.02]">
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
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => onLevelClick?.(row.levelId)}
              className="font-bold text-[var(--app-accent)] hover:underline truncate text-left block max-w-[220px]"
            >
              {row.levelName}
            </button>
            {row.authorHoldsRecord ? (
              <Badge
                variant="outline"
                className="mt-0.5 border-[var(--app-accent)]/30 text-[var(--app-accent)] text-[9px]"
              >
                author holds record
              </Badge>
            ) : (
              <Badge variant="outline" className="mt-0.5 border-sky-400/30 text-sky-300 text-[9px]">
                tied by {displayNameFor(profiles, row.holder)}
              </Badge>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="py-2.5">
        <div className="flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
          <button
            type="button"
            onClick={() => onPlayerClick?.(row.author)}
            className="text-slate-200 hover:text-[var(--app-accent)] truncate text-sm text-left max-w-[160px]"
          >
            {displayNameFor(profiles, row.author)}
          </button>
        </div>
      </TableCell>
      <TableCell className="py-2.5 text-right">
        <span className="font-mono font-bold text-[var(--app-accent)] whitespace-nowrap">
          {formatTime(row.authorTime)}
        </span>
      </TableCell>
      <TableCell className="py-2.5 text-right">
        <span
          className={cn(
            "font-mono whitespace-nowrap",
            row.gap > 0 ? "text-slate-300" : "text-slate-500",
          )}
          title={
            row.gap > 0
              ? `${displayNameFor(profiles, row.holder)} is ${row.gap.toFixed(3)}s behind`
              : "The fastest recorded run merely ties the author"
          }
        >
          {formatTime(row.bestTime)}
        </span>
        {row.gap > 0 && (
          <span className="ml-1.5 font-mono text-[10px] text-sky-300">+{row.gap.toFixed(3)}</span>
        )}
      </TableCell>
      <TableCell className="py-2.5">
        {row.arrow ? (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-slate-400"
            title={row.arrow}
          >
            <ArrowIcon name={row.arrow} className="w-3 h-3" />
            {arrowKind(row.arrow)}
          </span>
        ) : (
          <span className="text-slate-600 text-xs">—</span>
        )}
      </TableCell>
      <TableCell className="py-2.5 text-right font-mono text-slate-400 text-xs">
        {row.plays.toLocaleString()}
      </TableCell>
      <TableCell className="py-2.5 text-right font-mono text-slate-500 text-xs">
        {row.likes.toLocaleString()}
      </TableCell>
    </TableRow>
  );
}
