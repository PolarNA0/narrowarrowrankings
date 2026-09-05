import * as React from "react";
import { Crown, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowIcon } from "@/components/ArrowIcon";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry, LevelInfo } from "@/types";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

const ARROW_TONE: Record<string, string> = {
  "Narrow Arrow": "text-[var(--app-accent)]",
  "Speedy Arrow": "text-[#3b82f6]",
  "Energy Arrow": "text-[#22c55e]",
};

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  onLevelClick?: (levelId: string) => void;
  onPlayerClick?: (username: string) => void;
}

/** Category world records: who holds the fastest run per arrow on every level. */
export function ArrowRecordsView({ levels, data, onLevelClick, onPlayerClick }: Props) {
  const [query, setQuery] = React.useState("");

  const rows = React.useMemo(() => {
    return levels.map((level) => {
      const board = data[level.id] ?? [];
      const overall = board.length
        ? board.reduce((best, run) => (run.completion_time < best.completion_time ? run : best))
        : null;
      const perArrow = ARROWS.map((arrow) => {
        const runs = board.filter(
          (run) => (run.arrow_name || "").toLowerCase() === arrow.toLowerCase(),
        );
        const best = runs.length
          ? runs.reduce((a, b) => (a.completion_time <= b.completion_time ? a : b))
          : null;
        return { arrow, best };
      });
      return { level, overall, perArrow };
    });
  }, [levels, data]);

  const filtered = rows.filter(({ level, perArrow }) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      level.name.toLowerCase().includes(q) ||
      perArrow.some((a) => a.best?.username.toLowerCase().includes(q))
    );
  });

  const holderCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach(({ perArrow }) =>
      perArrow.forEach(({ best }) => {
        if (best) counts[best.username] = (counts[best.username] || 0) + 1;
      }),
    );
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [rows]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Crown className="w-5 h-5 text-[var(--app-accent)]" /> Arrow WR Holders
        </h2>
        <p className="text-slate-500 text-sm">
          The fastest run on every level for each arrow — category world records at a glance.
        </p>
      </div>

      {holderCounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {holderCounts.map(([username, count]) => (
            <button
              key={username}
              type="button"
              onClick={() => onPlayerClick?.(username)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-mono text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              {username} <span className="text-[var(--app-accent)] font-bold">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search level or holder..."
          className="bg-white/5 border-white/10 h-11 pl-10 focus-visible:ring-[var(--app-accent)]/50"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map(({ level, overall, perArrow }) => (
          <Card key={level.id} className="border-white/10 bg-white/[0.03]">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onLevelClick?.(level.id)}
                  className="font-bold text-sm text-[var(--app-accent)] hover:underline truncate text-left"
                >
                  {level.name}
                </button>
                {overall && (
                  <Badge className="bg-yellow-400/15 text-yellow-400 border-yellow-400/30 text-[9px] font-mono uppercase shrink-0">
                    WR {overall.completion_time.toFixed(3)}s
                  </Badge>
                )}
              </div>

              <div className="space-y-1.5">
                {perArrow.map(({ arrow, best }) => (
                  <div
                    key={arrow}
                    className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-1.5"
                  >
                    <ArrowIcon name={arrow} className={cn("w-4 h-4 shrink-0", ARROW_TONE[arrow])} />
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-500 w-14 shrink-0">
                      {arrow.split(" ")[0]}
                    </span>
                    {best ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onPlayerClick?.(best.username)}
                          className="text-xs font-bold text-slate-200 hover:text-[var(--app-accent)] truncate"
                        >
                          {best.username}
                        </button>
                        {best.isLegacy && (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[8px] uppercase font-mono px-1 py-0 shrink-0"
                          >
                            Legacy
                          </Badge>
                        )}
                        <span className="ml-auto font-mono text-xs font-bold text-[#2DD4BF] shrink-0">
                          {best.completion_time.toFixed(3)}s
                        </span>
                      </>
                    ) : (
                      <span className="ml-auto text-[10px] font-mono text-slate-600">No runs</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-slate-500 text-sm font-mono">No levels match that search.</p>
      )}
    </div>
  );
}
