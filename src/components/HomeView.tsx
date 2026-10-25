import * as React from "react";
import { Crown, Timer, Target, Trophy, Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowIcon } from "@/components/ArrowIcon";
import { toStandings } from "@/lib/medals";
import { computeNarrowScores, type PlayerScore } from "@/lib/narrowscore";
import { arrowKind } from "@/lib/arrow-sprites";
import { displayNameFor, avatarFor, type ProfileDirectory } from "@/lib/display-name";
import { NAV_GROUPS, type NavigableView } from "@/components/GroupedNavigation";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import type { TasSummary } from "@/lib/tas-leaderboard";

/**
 * Which runs a "record holder" tally counts.
 *
 * - `overall`  — the fastest run on a level, whichever arrow flew it.
 * - `category` — the fastest run per arrow on a level (the repo's "Arrow WRs").
 * - `tas`      — the site's own TAS board, which is a separate record set.
 */
type RecordScope = "overall" | "category" | "tas";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  tasBoards: Record<string, TasSummary[]>;
  tasLoading: boolean;
  /** How many level boards have loaded, out of the total — the boards warm in
   * batches, so totals are partial until this reaches `levels.length`. */
  boardsLoaded: number;
  profiles?: ProfileDirectory;
  formatTime: (seconds: number, forceMode?: "seconds" | "minutes") => string;
  onNavigate: (view: NavigableView) => void;
  onLevelClick: (levelId: string) => void;
  onPlayerClick: (username: string) => void;
}

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

const SCOPE_LABELS: Record<RecordScope, { label: string; hint: string }> = {
  overall: { label: "Overall", hint: "Fastest run on each level" },
  category: { label: "Per arrow", hint: "Fastest run per arrow, per level" },
  tas: { label: "TAS", hint: "Best tool-assisted run per level" },
};

const SCOPE_ORDER: RecordScope[] = ["overall", "category", "tas"];

interface Holder {
  username: string;
  count: number;
}

/** Tallies record holders for one scope, descending by count then name. */
function tallyHolders(
  levels: LevelInfo[],
  data: Record<string, LeaderboardEntry[]>,
  tasBoards: Record<string, TasSummary[]>,
  scope: RecordScope,
): Holder[] {
  const counts = new Map<string, number>();
  const bump = (username?: string) => {
    if (!username) return;
    counts.set(username, (counts.get(username) ?? 0) + 1);
  };

  for (const level of levels) {
    if (scope === "tas") {
      const entries = tasBoards[level.id] ?? [];
      // TAS boards are per level but carry mixed arrows, so the level's record
      // is a single best time rather than one per arrow.
      const best = entries.reduce<TasSummary | null>(
        (acc, e) => (acc === null || e.timeMs < acc.timeMs ? e : acc),
        null,
      );
      bump(best?.username);
      continue;
    }

    const board = data[level.id] ?? [];
    if (board.length === 0) continue;
    const standings = toStandings(board);
    if (scope === "overall") {
      bump(standings[0]?.username);
      continue;
    }
    for (const arrow of ARROWS) {
      const runs = standings.filter(
        (run) => (run.arrow_name || "").toLowerCase() === arrow.toLowerCase(),
      );
      if (runs.length > 0) bump(runs[0].username);
    }
  }

  return [...counts.entries()]
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
}

/** Totals for the "how close are humans to perfection" cards. */
function timeTotals(
  levels: LevelInfo[],
  data: Record<string, LeaderboardEntry[]>,
  tasBoards: Record<string, TasSummary[]>,
) {
  let humanAll = 0;
  let humanAllLevels = 0;
  let humanTassed = 0;
  let tasTotal = 0;
  let tasLevels = 0;

  for (const level of levels) {
    const standings = toStandings(data[level.id] ?? []);
    if (standings.length > 0) {
      humanAll += standings[0].completion_time;
      humanAllLevels += 1;
    }

    const entries = tasBoards[level.id] ?? [];
    if (entries.length === 0) continue;
    // Compare only levels that have a TAS run, so the gap is like-for-like
    // instead of subtracting a partial TAS total from a full human total.
    const bestTas = Math.min(...entries.map((e) => e.timeMs)) / 1000;
    tasTotal += bestTas;
    tasLevels += 1;
    if (standings.length > 0) humanTassed += standings[0].completion_time;
  }

  return {
    humanAll,
    humanAllLevels,
    humanTassed,
    tasTotal,
    tasLevels,
    gap: humanTassed - tasTotal,
  };
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-mono text-slate-500">
          <span className={tone ?? "text-[var(--app-accent)]"}>{icon}</span>
          {label}
        </div>
        <div className="mt-2 text-2xl font-bold text-white tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * The site's landing page: what the site is, how far the community is from the
 * best known times, and who holds the records.
 *
 * The record tally is switchable because "world record" means three different
 * things here — the fastest run on a level, the fastest per arrow, and the
 * site-owned TAS board — and each produces a different leaderboard of holders.
 */
export function HomeView({
  levels,
  data,
  tasBoards,
  tasLoading,
  boardsLoaded,
  profiles,
  formatTime,
  onNavigate,
  onLevelClick,
  onPlayerClick,
}: Props) {
  const [scope, setScope] = React.useState<RecordScope>("overall");
  const [topBy, setTopBy] = React.useState<"narrowscore" | "time">("narrowscore");

  const totals = React.useMemo(
    () => timeTotals(levels, data, tasBoards),
    [levels, data, tasBoards],
  );

  /** True while the bulk board warm-up still has levels to load, so every total
   * on the page is understated rather than final. */
  const partial = boardsLoaded < levels.length;

  const holders = React.useMemo(
    () => tallyHolders(levels, data, tasBoards, scope),
    [levels, data, tasBoards, scope],
  );

  const scores = React.useMemo(() => computeNarrowScores(levels, data), [levels, data]);

  const topPlayers = React.useMemo(() => {
    if (topBy === "narrowscore") {
      return scores.slice(0, 5).map((p: PlayerScore) => ({
        username: p.username,
        primary: `${Math.round(p.average)} avg`,
        secondary: `${p.total.toLocaleString()} pts · ${p.levelsPlayed} levels`,
      }));
    }
    // Total time is a sum of each player's best run per level, so a raw sum
    // would rank whoever played the *fewest* levels first (one 10s run beats
    // Polar's 72). The sums are only comparable between players who covered the
    // same ground, so this mode ranks the players who have played every level
    // that has a recorded time.
    const playedLevels = levels.filter((level) => (data[level.id]?.length ?? 0) > 0);
    const totalsByPlayer = new Map<string, { total: number; levels: number }>();
    for (const level of playedLevels) {
      for (const run of toStandings(data[level.id] ?? [])) {
        const key = run.username.toLowerCase();
        const row = totalsByPlayer.get(key) ?? { total: 0, levels: 0 };
        row.total += run.completion_time;
        row.levels += 1;
        totalsByPlayer.set(key, row);
      }
    }
    const fullCoverage = [...totalsByPlayer.entries()]
      .map(([key, row]) => ({ key, ...row }))
      .filter((row) => row.levels === playedLevels.length);
    return fullCoverage
      .sort((a, b) => a.total - b.total)
      .slice(0, 5)
      .map((row) => {
        const username =
          scores.find((s) => s.username.toLowerCase() === row.key)?.username ?? row.key;
        return {
          username,
          primary: formatTime(row.total, "minutes"),
          secondary: `${row.levels} levels`,
        };
      });
  }, [topBy, scores, levels, data, formatTime]);

  const topLevels = React.useMemo(
    () => levels.filter((level) => (data[level.id]?.length ?? 0) > 0).slice(0, 6),
    [levels, data],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Hero */}
      <section className="text-center space-y-3 pt-2">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">
          Narrow Arrow Rankings
        </h1>
        <p className="text-slate-400 text-sm md:text-base max-w-2xl mx-auto">
          Live leaderboards, world records, player profiles and a tool-assisted speedrun board for
          Narrow Arrow — {levels.length} levels tracked.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Button size="sm" onClick={() => onNavigate("leaderboard")}>
            Browse leaderboards
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("score")}>
            NarrowScore
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("wrs")}>
            World records
          </Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("play")}>
            Play a level
          </Button>
        </div>
      </section>

      {/* Community totals */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)]">
            Community totals
          </h2>
          {partial && (
            <span className="text-[11px] text-slate-500 font-mono">
              warming boards… {boardsLoaded}/{levels.length} levels
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<Timer className="w-3.5 h-3.5" />}
            label="Total human WR time"
            value={formatTime(totals.humanAll, "minutes")}
            sub={`sum of the fastest run on ${totals.humanAllLevels} levels`}
          />
          <StatCard
            icon={<Target className="w-3.5 h-3.5" />}
            label="Total TAS time"
            value={formatTime(totals.tasTotal, "minutes")}
            sub={
              tasLoading
                ? "loading TAS boards…"
                : `${totals.tasLevels} of ${levels.length} levels have a TAS run`
            }
            tone="text-[#22c55e]"
          />
          <StatCard
            icon={<Sparkles className="w-3.5 h-3.5" />}
            label="Humans vs perfection"
            value={
              totals.tasLevels === 0
                ? "—"
                : `${totals.gap >= 0 ? "+" : ""}${totals.gap.toFixed(3)}s`
            }
            sub={
              totals.tasLevels === 0
                ? "no TAS runs submitted yet"
                : `across the same ${totals.tasLevels} TAS'd levels`
            }
            tone="text-[#FBBF24]"
          />
          <StatCard
            icon={<Trophy className="w-3.5 h-3.5" />}
            label="Levels tracked"
            value={String(levels.length)}
            sub={`${totals.humanAllLevels} with a recorded time`}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top players */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)]">
              Top players
            </h2>
            <div className="flex bg-white/5 border border-white/10 rounded-lg p-1">
              {(["narrowscore", "time"] as const).map((mode) => (
                <Button
                  key={mode}
                  variant="ghost"
                  size="sm"
                  onClick={() => setTopBy(mode)}
                  className={cn(
                    "h-7 text-[11px] rounded-md",
                    topBy === mode
                      ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                      : "text-slate-400 hover:text-white",
                  )}
                >
                  {mode === "narrowscore" ? "NarrowScore" : "Total time"}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            {topBy === "narrowscore"
              ? "Sum of NarrowScore across every level played — 1000 is a world record."
              : "Total of each player's best time on every level, for players who have run them all."}
            {partial && " Still warming boards."}
          </p>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-0 divide-y divide-white/5">
              {topPlayers.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">Loading boards…</div>
              ) : (
                topPlayers.map((player, index) => {
                  const avatar = avatarFor(profiles, player.username);
                  return (
                    <button
                      key={player.username}
                      type="button"
                      onClick={() => onPlayerClick(player.username)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    >
                      <span
                        className={cn(
                          "w-6 text-center font-mono text-sm font-bold shrink-0",
                          index === 0 ? "text-[#FBBF24]" : "text-slate-500",
                        )}
                      >
                        {index + 1}
                      </span>
                      {avatar ? (
                        <img
                          src={avatar}
                          alt=""
                          className="w-7 h-7 rounded-full border border-white/10 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full border border-white/10 bg-black/40 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-white text-sm font-medium truncate">
                          {displayNameFor(profiles, player.username)}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">
                          {player.secondary}
                        </div>
                      </div>
                      <div className="text-sm font-mono text-[var(--app-accent)] tabular-nums shrink-0">
                        {player.primary}
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>

        {/* Record holders */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] flex items-center gap-2">
              <Crown className="w-4 h-4" /> WR holders
            </h2>
            <div className="flex bg-white/5 border border-white/10 rounded-lg p-1">
              {SCOPE_ORDER.map((value) => (
                <Button
                  key={value}
                  variant="ghost"
                  size="sm"
                  onClick={() => setScope(value)}
                  title={SCOPE_LABELS[value].hint}
                  className={cn(
                    "h-7 text-[11px] rounded-md",
                    scope === value
                      ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                      : "text-slate-400 hover:text-white",
                  )}
                >
                  {SCOPE_LABELS[value].label}
                </Button>
              ))}
            </div>
          </div>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="p-0">
              <div className="px-4 pt-3 text-[11px] text-slate-500">
                {SCOPE_LABELS[scope].hint}
                {scope === "tas" && tasLoading ? " · loading…" : ""}
                {scope === "tas" && !tasLoading && !partial
                  ? ` · ${totals.tasLevels} TAS'd levels`
                  : ""}
              </div>
              {holders.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  {scope === "tas" ? "No TAS runs submitted yet." : "Loading boards…"}
                </div>
              ) : (
                <div className="divide-y divide-white/5 mt-2 max-h-[420px] overflow-y-auto">
                  {holders.map((holder) => (
                    <button
                      key={holder.username}
                      type="button"
                      onClick={() => onPlayerClick(holder.username)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
                    >
                      <span className="text-white text-sm truncate">
                        {displayNameFor(profiles, holder.username)}
                      </span>
                      <span className="font-mono text-sm font-bold text-[var(--app-accent)] tabular-nums shrink-0">
                        {holder.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* Jump back in */}
      <section className="space-y-3">
        <h2 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)]">
          Jump back in
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {topLevels.map((level) => {
            const best = toStandings(data[level.id] ?? [])[0];
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => onLevelClick(level.id)}
                className="text-left"
              >
                <Card className="bg-white/5 border-white/10 hover:bg-white/[0.07] transition-colors h-full">
                  <CardContent className="p-3 flex items-center gap-3">
                    <img
                      src={`https://api.narrowarrow.xyz/level-image/${level.id}.png`}
                      referrerPolicy="no-referrer"
                      alt=""
                      className="w-10 h-10 rounded border border-white/10 object-cover bg-black/40 shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-white text-sm font-medium truncate">{level.name}</div>
                      {best && (
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                          <ArrowIcon
                            name={arrowKind(best.arrow_name)}
                            className="w-3.5 h-3.5 shrink-0"
                          />
                          <span className="truncate">
                            {displayNameFor(profiles, best.username)}
                          </span>
                        </div>
                      )}
                    </div>
                    {best && (
                      <div className="font-mono text-xs text-[var(--app-accent)] tabular-nums shrink-0">
                        {formatTime(best.completion_time)}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>
      </section>

      {/* Explore */}
      <section className="space-y-3">
        <h2 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)]">
          Explore
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {NAV_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => onNavigate(group.items[0].id)}
              className="group text-left"
            >
              <Card className="bg-white/5 border-white/10 hover:bg-white/[0.07] transition-colors h-full">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white text-sm font-bold">{group.label}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-[var(--app-accent)] transition-colors shrink-0" />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                    {group.items.map((item) => item.label).join(" · ")}
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
