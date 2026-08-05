import * as React from "react";
import { Swords } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { LeaderboardEntry, LevelInfo } from "@/types";
import { toStandings } from "@/lib/medals";

interface Props { levels: LevelInfo[]; data: Record<string, LeaderboardEntry[]>; usernames: string[]; onPlayerClick?: (username: string) => void; }

export function RivalriesView({ levels, data, usernames, onPlayerClick }: Props) {
  const [left, setLeft] = React.useState("");
  const [right, setRight] = React.useState("");
  const canonical = React.useMemo(() => new Map(usernames.map((name) => [name.toLowerCase(), name])), [usernames]);
  const result = React.useMemo(() => {
    const a = canonical.get(left.trim().toLowerCase()); const b = canonical.get(right.trim().toLowerCase());
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;
    let winsA = 0, winsB = 0, ties = 0, common = 0;
    const maps: { name: string; winner: string; gap: number }[] = [];
    for (const level of levels) {
      const board = toStandings(data[level.id] ?? []);
      const runA = board.find((run) => run.username.toLowerCase() === a.toLowerCase());
      const runB = board.find((run) => run.username.toLowerCase() === b.toLowerCase());
      if (!runA || !runB) continue;
      common += 1; const gap = Math.abs(runA.completion_time - runB.completion_time);
      if (runA.completion_time === runB.completion_time) { ties += 1; maps.push({ name: level.name, winner: "Tie", gap }); }
      else if (runA.completion_time < runB.completion_time) { winsA += 1; maps.push({ name: level.name, winner: a, gap }); }
      else { winsB += 1; maps.push({ name: level.name, winner: b, gap }); }
    }
    return { a, b, winsA, winsB, ties, common, maps: maps.sort((x, y) => y.gap - x.gap) };
  }, [left, right, canonical, levels, data]);

  return <div className="space-y-6 animate-in fade-in duration-300"><div><h2 className="text-2xl font-bold text-white flex items-center gap-2"><Swords className="w-5 h-5 text-[var(--app-accent)]" /> Rivalries</h2><p className="text-slate-500 text-sm">Put two players head-to-head across every official map they both completed.</p></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Input list="rival-players" value={left} onChange={(e) => setLeft(e.target.value)} placeholder="First player" className="bg-black/30 border-white/10" /><Input list="rival-players" value={right} onChange={(e) => setRight(e.target.value)} placeholder="Second player" className="bg-black/30 border-white/10" /><datalist id="rival-players">{usernames.map((name) => <option key={name} value={name} />)}</datalist></div>
    {!result ? <Card className="bg-white/5 border-white/10"><CardContent className="p-10 text-center text-slate-500">Choose two valid player names to start the matchup.</CardContent></Card> : <><div className="grid grid-cols-3 gap-3"><Button variant="outline" onClick={() => onPlayerClick?.(result.a)} className="h-auto py-4 border-white/10 bg-white/5 flex-col"><strong className="text-xl text-[var(--app-accent)]">{result.winsA}</strong><span className="truncate max-w-full">{result.a}</span></Button><Card className="bg-white/5 border-white/10"><CardContent className="p-4 text-center"><strong className="text-xl text-white">{result.common}</strong><div className="text-[10px] text-slate-500 uppercase">common maps · {result.ties} ties</div></CardContent></Card><Button variant="outline" onClick={() => onPlayerClick?.(result.b)} className="h-auto py-4 border-white/10 bg-white/5 flex-col"><strong className="text-xl text-[var(--app-accent)]">{result.winsB}</strong><span className="truncate max-w-full">{result.b}</span></Button></div><Card className="bg-white/5 border-white/10"><CardContent className="p-0 divide-y divide-white/5">{result.maps.map((map) => <div key={map.name} className="flex items-center justify-between gap-3 px-4 py-3"><span className="font-medium text-white truncate">{map.name}</span><span className="text-xs text-slate-400"><strong className="text-[var(--app-accent)]">{map.winner}</strong> by {map.gap.toFixed(3)}s</span></div>)}</CardContent></Card></>}
  </div>;
}