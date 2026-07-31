import * as React from "react";
import {
  ChevronDown,
  Crown,
  Download,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  BadgeCheck,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry, LevelInfo, LevelPack } from "@/types";
import {
  MAX_SCORE,
  biggestGains,
  computeNarrowScores,
  tierFor,
  type PlayerScore,
} from "@/lib/narrowscore";
import type { PlayerProfileRow } from "@/hooks/usePlayerProfiles";

interface NarrowScoreViewProps {
  levels: LevelInfo[];
  packs: LevelPack[];
  data: Record<string, LeaderboardEntry[]>;
  profiles: Record<string, PlayerProfileRow>;
  onPlayerClick: (username: string) => void;
  onLevelClick: (levelId: string) => void;
  formatTime: (seconds: number) => string;
}

function scoreColor(points: number) {
  if (points >= MAX_SCORE) return "#FBBF24";
  if (points >= 950) return "#A78BFA";
  if (points >= 880) return "var(--app-accent)";
  if (points >= 750) return "#2DD4BF";
  return "#94A3B8";
}

export function NarrowScoreView({
  levels,
  packs,
  data,
  profiles,
  onPlayerClick,
  onLevelClick,
  formatTime,
}: NarrowScoreViewProps) {
  const [query, setQuery] = React.useState("");
  const [packFilter, setPackFilter] = React.useState<string>("all");
  const [sortBy, setSortBy] = React.useState<"total" | "average" | "perfects">("total");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const scopedLevels = React.useMemo(
    () => (packFilter === "all" ? levels : levels.filter((l) => l.packId === packFilter)),
    [levels, packFilter],
  );

  const scores = React.useMemo(
    () => computeNarrowScores(scopedLevels, data),
    [scopedLevels, data],
  );

  const ranked = React.useMemo(() => {
    const sorted = [...scores].sort((a, b) => {
      if (sortBy === "average") return b.average - a.average || b.levelsPlayed - a.levelsPlayed;
      if (sortBy === "perfects") return b.perfects - a.perfects || b.total - a.total;
      return b.total - a.total;
    });
    return sorted.map((player, index) => ({ player, rank: index + 1 }));
  }, [scores, sortBy]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ranked.filter((r) => r.player.username.toLowerCase().includes(q)) : ranked;
  }, [ranked, query]);

  const exportCsv = () => {
    const rows = [
      ["rank", "player", "total", "average", "levels", "perfect_1000s"],
      ...ranked.map(({ player, rank }) => [
        rank,
        player.username,
        player.total,
        player.average.toFixed(1),
        player.levelsPlayed,
        player.perfects,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "narrowscore.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxTotal = scopedLevels.length * MAX_SCORE;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[var(--app-accent)]" /> NarrowScore
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-1">
              1000 points per level for the world record · {scopedLevels.length} levels ·{" "}
              {maxTotal.toLocaleString()} max
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            className="border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          >
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player..."
              className="pl-9 bg-black/30 border-white/10 text-slate-200"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
            {(["total", "average", "perfects"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortBy(key)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[10px] uppercase font-bold tracking-wider transition-colors",
                  sortBy === key
                    ? "bg-[var(--app-accent)] text-slate-950"
                    : "text-slate-400 hover:text-white",
                )}
              >
                {key === "perfects" ? "1000s" : key}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setPackFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors",
              packFilter === "all"
                ? "border-[var(--app-accent)] text-[var(--app-accent)] bg-[var(--app-accent)]/10"
                : "border-white/10 text-slate-400 hover:text-white",
            )}
          >
            All packs
          </button>
          {packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => setPackFilter(pack.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors",
                packFilter === pack.id
                  ? "border-[var(--app-accent)] text-[var(--app-accent)] bg-[var(--app-accent)]/10"
                  : "border-white/10 text-slate-400 hover:text-white",
              )}
            >
              {pack.name.replace(" Pack", "")}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card className="border-white/10 bg-white/[0.02]">
          <CardContent className="py-16 text-center text-slate-500 font-mono text-sm">
            No players scored yet — leaderboards are still loading.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map(({ player, rank }) => (
            <ScoreRow
              key={player.username}
              player={player}
              rank={rank}
              profile={profiles[player.username.toLowerCase()]}
              open={expanded === player.username}
              onToggle={() =>
                setExpanded((prev) => (prev === player.username ? null : player.username))
              }
              onPlayerClick={onPlayerClick}
              onLevelClick={onLevelClick}
              formatTime={formatTime}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ScoreRowProps {
  player: PlayerScore;
  rank: number;
  profile?: PlayerProfileRow;
  open: boolean;
  onToggle: () => void;
  onPlayerClick: (username: string) => void;
  onLevelClick: (levelId: string) => void;
  formatTime: (seconds: number) => string;
}

function ScoreRow({
  player,
  rank,
  profile,
  open,
  onToggle,
  onPlayerClick,
  onLevelClick,
  formatTime,
}: ScoreRowProps) {
  const tier = tierFor(player.average);
  const gains = React.useMemo(() => biggestGains(player, 3), [player]);

  return (
    <div
      className={cn(
        "rounded-xl border bg-white/[0.02] transition-colors",
        open ? "border-[var(--app-accent)]/40" : "border-white/10 hover:border-white/20",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-3 text-left"
      >
        <span
          className={cn(
            "w-8 shrink-0 text-center font-mono text-sm font-bold",
            rank === 1 ? "text-[#FBBF24]" : rank <= 3 ? "text-slate-300" : "text-slate-500",
          )}
        >
          {rank}
        </span>

        {profile?.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt={`${player.username} avatar`}
            loading="lazy"
            className="h-9 w-9 rounded-full object-cover border border-white/10 shrink-0"
          />
        ) : (
          <span
            className="h-9 w-9 rounded-full shrink-0 grid place-items-center text-xs font-bold text-slate-950"
            style={{ backgroundColor: profile?.accent_color || tier.color }}
          >
            {player.username.slice(0, 2).toUpperCase()}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span
              className="font-bold text-white truncate hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onPlayerClick(player.username);
              }}
            >
              {profile?.display_name || player.username}
            </span>
            {profile?.verified && <BadgeCheck className="w-3.5 h-3.5 text-[var(--app-accent)]" />}
            {player.perfects > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] font-mono text-[#FBBF24]">
                <Crown className="w-3 h-3" /> {player.perfects}
              </span>
            )}
          </span>
          <span className="block text-[10px] font-mono uppercase tracking-wider" style={{ color: tier.color }}>
            {tier.name} · {player.levelsPlayed} levels
          </span>
        </span>

        <span className="text-right shrink-0">
          <span className="block font-mono text-lg font-bold text-white tabular-nums">
            {player.total.toLocaleString()}
          </span>
          <span className="block text-[10px] font-mono text-slate-500">
            avg {player.average.toFixed(1)}
          </span>
        </span>

        <ChevronDown
          className={cn(
            "w-4 h-4 text-slate-500 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-white/10 px-3 py-4 space-y-4">
          {gains.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold flex items-center gap-1.5">
                <TrendingUp className="w-3 h-3" /> Biggest available gains
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {gains.map((level) => (
                  <span
                    key={level.levelId}
                    className="text-[11px] font-mono rounded-md border border-white/10 px-2 py-1 text-slate-300"
                  >
                    {level.levelName}{" "}
                    <span className="text-[var(--app-accent)]">+{MAX_SCORE - level.points}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5 sm:grid-cols-2">
            {player.levels.map((level) => (
              <button
                key={level.levelId}
                type="button"
                onClick={() => onLevelClick(level.levelId)}
                className="text-left rounded-lg border border-white/5 bg-black/20 px-3 py-2 hover:border-white/20 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-200 truncate">
                    {level.levelName}
                  </span>
                  <span
                    className="font-mono text-sm font-bold tabular-nums shrink-0"
                    style={{ color: scoreColor(level.points) }}
                  >
                    {level.points}
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(level.points / MAX_SCORE) * 100}%`,
                      backgroundColor: scoreColor(level.points),
                    }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>
                    #{level.position}/{level.entrants} · {formatTime(level.time)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    {level.gap <= 0 ? "WR" : `+${level.gap.toFixed(3)}s`}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
