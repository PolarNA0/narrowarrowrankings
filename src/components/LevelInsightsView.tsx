import * as React from "react";
import { Activity, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import { toStandings } from "@/lib/medals";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  onLevelClick?: (levelId: string) => void;
  formatTime: (seconds: number) => string;
}

export function LevelInsightsView({ levels, data, onLevelClick, formatTime }: Props) {
  const [query, setQuery] = React.useState("");
  const rows = React.useMemo(() => levels.map((level) => {
    const board = toStandings(data[level.id] ?? []);
    const wr = board[0]?.completion_time ?? 0;
    const median = board.length ? board[Math.floor(board.length / 2)].completion_time : 0;
    const topTen = board[Math.min(9, board.length - 1)]?.completion_time ?? 0;
    return { level, players: board.length, wr, median, topTen, spread: wr ? median / wr : 0 };
  }).filter((row) => row.level.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.spread - a.spread), [levels, data, query]);

  return <div className="space-y-6 animate-in fade-in duration-300">
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-white flex items-center gap-2"><Activity className="w-5 h-5 text-[var(--app-accent)]" /> Level Insights</h2><p className="text-slate-500 text-sm">Compare depth, WR pace and the median completion across every official map.</p></div>
      <div className="relative"><Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search level" className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm" /></div>
    </div>
    <Card className="bg-white/5 border-white/10"><CardHeader className="border-b border-white/10 py-3"><CardTitle className="text-base text-white">Hardest by community spread</CardTitle></CardHeader><CardContent className="p-0 divide-y divide-white/5">
      {rows.map((row, index) => <button key={row.level.id} type="button" onClick={() => onLevelClick?.(row.level.id)} className="w-full grid grid-cols-[2rem_minmax(0,1fr)_auto] md:grid-cols-[2rem_minmax(10rem,1fr)_7rem_7rem_7rem_6rem] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]">
        <span className="font-mono text-xs text-slate-500">#{index + 1}</span><span className="font-bold text-white truncate">{row.level.name}</span><Badge variant="outline" className="font-mono text-[10px] border-white/10 text-[var(--app-accent)]">{row.players} players</Badge><span className="hidden md:block font-mono text-xs text-amber-300">WR {formatTime(row.wr)}</span><span className="hidden md:block font-mono text-xs text-slate-300">T10 {formatTime(row.topTen)}</span><span className="hidden md:block font-mono text-xs text-slate-300">Med {formatTime(row.median)}</span>
      </button>)}
    </CardContent></Card>
  </div>;
}