import * as React from "react";
import { Crown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import { toStandings } from "@/lib/medals";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  onPlayerClick?: (username: string) => void;
}

interface FameRow {
  username: string;
  wrs: number;
  podiums: number;
  topTen: number;
  maps: number;
  legacyScore: number;
}

/** Weighted all-time standing built from world records, podiums and top-10 depth. */
export function HallOfFameView({ levels, data, onPlayerClick }: Props) {
  const rows = React.useMemo<FameRow[]>(() => {
    const table = new Map<string, FameRow>();
    for (const level of levels) {
      const board = toStandings(data[level.id] ?? []);
      board.forEach((run, index) => {
        const key = run.username.toLowerCase();
        const row =
          table.get(key) ??
          { username: run.username, wrs: 0, podiums: 0, topTen: 0, maps: 0, legacyScore: 0 };
        row.maps += 1;
        if (index === 0) row.wrs += 1;
        if (index < 3) row.podiums += 1;
        if (index < 10) row.topTen += 1;
        row.legacyScore += Math.max(0, 100 - index * 4);
        table.set(key, row);
      });
    }
    return [...table.values()]
      .sort((a, b) => b.legacyScore - a.legacyScore || b.wrs - a.wrs)
      .slice(0, 100);
  }, [levels, data]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Crown className="w-5 h-5 text-[var(--app-accent)]" /> Hall of Fame
        </h2>
        <p className="text-slate-500 text-sm">
          Legacy score weights every official placement — world records count most, top-10s still pay.
        </p>
      </div>

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-0 divide-y divide-white/5">
          {rows.length === 0 ? (
            <div className="p-10 text-center text-slate-500">Loading official boards…</div>
          ) : (
            rows.map((row, index) => (
              <button
                key={row.username}
                type="button"
                onClick={() => onPlayerClick?.(row.username)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
              >
                <span className="w-8 font-mono text-xs text-slate-500">#{index + 1}</span>
                <span className="flex-1 truncate font-medium text-white">{row.username}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500 hidden sm:block">
                  {row.wrs} wr · {row.podiums} podium · {row.topTen} top10 · {row.maps} maps
                </span>
                <span className="font-mono text-sm font-bold text-[var(--app-accent)]">
                  {row.legacyScore.toLocaleString()}
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
