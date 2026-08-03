import * as React from "react";
import { ChevronDown, Crown, Download, Medal, Search, Sigma, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry, LevelInfo, LevelRankConfig } from "@/types";
import {
  computeRankPoints,
  RANK_POINTS,
  RANK_TEXT_COLOR,
  WR_POINTS,
  POINT_RANK_ORDER,
} from "@/lib/rankPoints";

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  rankConfigs?: Record<string, LevelRankConfig>;
  onPlayerClick?: (username: string) => void;
  onLevelClick?: (levelId: string) => void;
  formatTime: (seconds: number) => string;
}

/** Points-per-rank leaderboard: every map contributes points for the rank hit. */
export function RankPointsView({
  levels,
  data,
  rankConfigs,
  onPlayerClick,
  onLevelClick,
  formatTime,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const levelIds = React.useMemo(() => levels.map((l) => l.id), [levels]);
  const levelName = React.useMemo(() => {
    const map: Record<string, string> = {};
    levels.forEach((l) => (map[l.id] = l.name));
    return map;
  }, [levels]);

  const { players, levelTimes } = React.useMemo(() => {
    const authoredMap = Object.fromEntries(
      Object.entries(rankConfigs ?? {}).map(([id, cfg]) => [id, cfg?.ranks]),
    );
    return computeRankPoints(levelIds, data, authoredMap);
  }, [levelIds, data, rankConfigs]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? players.filter((p) => p.username.toLowerCase().includes(q)) : players;
  }, [players, query]);

  const maxPossible = Object.keys(levelTimes).length * WR_POINTS;

  const exportCsv = () => {
    const header = "rank,player,points,maps,wrs,champions\n";
    const body = filtered
      .map((p, i) => [i + 1, p.username, p.total, p.mapsPlayed, p.wrs, p.champions].join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "rank-points.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sigma className="w-5 h-5 text-[var(--app-accent)]" /> Rank Points
          </h2>
          <p className="text-slate-500 text-sm">
            Every map awards points for the rank your PB reaches. World records get a +2 bonus.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player"
              className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
            />
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9 border-white/10 bg-white/5" onClick={exportCsv}>
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card className="bg-white/5 border-white/10">
        <CardContent className="p-4 flex flex-wrap gap-2">
          <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/30 font-mono text-[10px]">
            WR = {WR_POINTS}
          </Badge>
          {POINT_RANK_ORDER.map((rank) => (
            <Badge
              key={rank}
              variant="outline"
              className={cn("border-white/10 bg-white/[0.03] font-mono text-[10px]", RANK_TEXT_COLOR[rank])}
            >
              {rank} = {RANK_POINTS[rank]}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Players ranked", value: players.length, icon: Trophy },
          { label: "Maps scored", value: Object.keys(levelTimes).length, icon: Medal },
          { label: "Max possible", value: maxPossible, icon: Sigma },
          { label: "Top score", value: players[0]?.total ?? 0, icon: Crown },
        ].map((stat) => (
          <Card key={stat.label} className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                <stat.icon className="w-3.5 h-3.5 text-[var(--app-accent)]" /> {stat.label}
              </div>
              <div className="text-2xl font-bold text-white mt-1 font-mono">{stat.value.toLocaleString()}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
          <CardTitle className="text-base font-bold text-white">Points table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/[0.02]">
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="w-14 text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">#</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Player</TableHead>
                  <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">Points</TableHead>
                  <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">Maps</TableHead>
                  <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">WRs</TableHead>
                  <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">Champ</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-slate-500 font-mono text-xs">
                      No leaderboard data loaded yet.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.slice(0, 500).map((player, index) => {
                  const key = player.username.toLowerCase();
                  const open = expanded === key;
                  return (
                    <React.Fragment key={key}>
                      <TableRow
                        className="border-white/5 hover:bg-white/[0.03] cursor-pointer"
                        onClick={() => setExpanded(open ? null : key)}
                      >
                        <TableCell className="text-center font-mono text-slate-500">{index + 1}</TableCell>
                        <TableCell
                          className="font-bold text-white whitespace-nowrap hover:text-[var(--app-accent)]"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayerClick?.(player.username);
                          }}
                        >
                          {player.username}
                        </TableCell>
                        <TableCell className="text-center font-mono font-bold text-[var(--app-accent)]">
                          {player.total}
                        </TableCell>
                        <TableCell className="text-center font-mono text-slate-400">{player.mapsPlayed}</TableCell>
                        <TableCell className="text-center font-mono text-amber-400">{player.wrs}</TableCell>
                        <TableCell className="text-center font-mono text-fuchsia-400">{player.champions}</TableCell>
                        <TableCell className="text-center">
                          <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", open && "rotate-180")} />
                        </TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="border-white/5 bg-black/20 hover:bg-black/20">
                          <TableCell colSpan={7} className="p-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                              {Object.values(player.perLevel)
                                .sort((a, b) => b.points - a.points || a.time - b.time)
                                .map((entry) => (
                                  <button
                                    key={entry.levelId}
                                    type="button"
                                    onClick={() => onLevelClick?.(entry.levelId)}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left hover:border-[var(--app-accent)]/40"
                                  >
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-white truncate">
                                        {levelName[entry.levelId] ?? entry.levelId}
                                      </div>
                                      <div className="text-[10px] font-mono text-slate-500">
                                        #{entry.position} · {formatTime(entry.time)}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="font-mono text-sm font-bold text-[var(--app-accent)]">
                                        +{entry.points}
                                      </div>
                                      <div className={cn("text-[9px] uppercase font-bold", RANK_TEXT_COLOR[entry.rank])}>
                                        {entry.isWr ? "World Record" : entry.rank}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
