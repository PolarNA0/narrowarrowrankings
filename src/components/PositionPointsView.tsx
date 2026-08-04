import * as React from "react";
import { ListOrdered, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry, LevelInfo } from "@/types";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  onPlayerClick?: (username: string) => void;
  onLevelClick?: (levelId: string) => void;
}

interface Row {
  username: string;
  points: number;
  maps: number;
  best: number;
  average: number;
  positions: { levelId: string; levelName: string; position: number }[];
}

const PAGE = 50;

/** Golf-style scoring: your leaderboard position is your point total. Lower wins. */
export function PositionPointsView({ levels, data, onPlayerClick, onLevelClick }: Props) {
  const [query, setQuery] = React.useState("");
  const [minMaps, setMinMaps] = React.useState(1);
  const [visible, setVisible] = React.useState(PAGE);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const rows = React.useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const level of levels) {
      const entries = data[level.id];
      if (!entries || entries.length === 0) continue;
      const sorted = [...entries].sort((a, b) => a.completion_time - b.completion_time);
      sorted.forEach((entry, index) => {
        const key = entry.username;
        const row =
          map.get(key) ??
          ({ username: key, points: 0, maps: 0, best: Infinity, average: 0, positions: [] } as Row);
        const position = index + 1;
        row.points += position;
        row.maps += 1;
        row.best = Math.min(row.best, position);
        row.positions.push({ levelId: level.id, levelName: level.name, position });
        map.set(key, row);
      });
    }
    const list = Array.from(map.values()).map((row) => ({
      ...row,
      average: row.points / Math.max(1, row.maps),
      positions: row.positions.sort((a, b) => a.position - b.position),
    }));
    list.sort((a, b) => a.points - b.points || a.maps - b.maps || a.username.localeCompare(b.username));
    return list;
  }, [levels, data]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => r.maps >= minMaps && (!q || r.username.toLowerCase().includes(q)));
  }, [rows, query, minMaps]);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-[var(--app-accent)]" /> Position Points
          </h2>
          <p className="text-slate-500 text-sm">
            1st place = 1 point, 30th = 30 points. Add up every level — the lowest total tops the board.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisible(PAGE);
              }}
              placeholder="Search player"
              className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {[1, 10, 25, 50, 64].map((n) => (
          <Button
            key={n}
            size="sm"
            variant="ghost"
            onClick={() => {
              setMinMaps(n);
              setVisible(PAGE);
            }}
            className={cn(
              "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
              minMaps === n ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400",
            )}
          >
            {n === 1 ? "All players" : `${n}+ maps`}
          </Button>
        ))}
      </div>

      <Card className="bg-white/5 border-white/10">
        <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
          <CardTitle className="text-base font-bold text-white">
            Standings ({filtered.length.toLocaleString()} players)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-white/5">
          {filtered.slice(0, visible).map((row, index) => (
            <div key={row.username}>
              <button
                type="button"
                onClick={() => setExpanded((prev) => (prev === row.username ? null : row.username))}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
              >
                <span className="w-8 font-mono text-xs text-slate-500">#{index + 1}</span>
                <span
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayerClick?.(row.username);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && onPlayerClick?.(row.username)}
                  className="font-bold text-white truncate flex-1 hover:text-[var(--app-accent)]"
                >
                  {row.username}
                </span>
                <Badge variant="outline" className="font-mono text-[10px] border-white/10 text-slate-300 bg-white/5">
                  {row.maps} maps
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] border-white/10 text-slate-300 bg-white/5">
                  avg {row.average.toFixed(1)}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10px] border-white/10 text-emerald-300 bg-emerald-400/10">
                  best #{row.best}
                </Badge>
                <span className="font-mono text-sm font-bold text-[var(--app-accent)] w-16 text-right">
                  {row.points.toLocaleString()}
                </span>
              </button>
              {expanded === row.username && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 pb-4">
                  {row.positions.map((p) => (
                    <button
                      key={p.levelId}
                      type="button"
                      onClick={() => onLevelClick?.(p.levelId)}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-left hover:border-[var(--app-accent)]/40"
                    >
                      <span className="text-[11px] text-slate-300 truncate">{p.levelName}</span>
                      <span className="font-mono text-[11px] font-bold text-white shrink-0">#{p.position}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">No players match that filter.</div>
          )}
        </CardContent>
      </Card>

      {visible < filtered.length && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setVisible((v) => v + PAGE * 2)}
            className="border-white/10 bg-white/5 text-slate-300"
          >
            Show more ({filtered.length - visible} left)
          </Button>
        </div>
      )}
    </div>
  );
}
