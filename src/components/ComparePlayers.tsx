import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { 
  Users, 
  ChevronLeft, 
  ArrowRight, 
  Minus, 
  Plus, 
  Trophy,
  Search,
  Check,
  X,
  Play,
  ArrowUpDown
} from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { motion } from "motion/react";
import { PlayerStats, LevelInfo, RankInfo, LevelPack } from "../types";
import { DEFAULT_RANKS } from "../constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn, capitalizeName } from "@/lib/utils";

interface ComparePlayersProps {
  initialPlayer: PlayerStats;
  allUsernames: string[];
  levels: LevelInfo[];
  packs: LevelPack[];
  onBack: () => void;
  getPlayerStats: (username: string) => PlayerStats | null;
  onLevelClick: (levelId: string) => void;
}

export function ComparePlayers({ initialPlayer, allUsernames, levels, packs, onBack, getPlayerStats, onLevelClick }: ComparePlayersProps) {
  const formatTime = (seconds: number, forceMode?: 'seconds' | 'minutes') => {
    const mode = forceMode || 'seconds';
    if (mode === 'seconds') {
      return `${seconds.toFixed(3)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3);
    return `${mins}:${secs.padStart(6, '0')}m`;
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([initialPlayer.username]);

  const players = useMemo(() => {
    return selectedUsernames
      .map(u => getPlayerStats(u))
      .filter((p): p is PlayerStats => p !== null);
  }, [selectedUsernames, getPlayerStats]);

  const sortedLevelsForComparison = useMemo(() => {
    return [...levels].sort((a, b) => {
      const idxA = packs.findIndex(p => p.id === a.packId);
      const idxB = packs.findIndex(p => p.id === b.packId);
      if (idxA !== idxB) return idxA - idxB;
      return a.gameOrder - b.gameOrder;
    });
  }, [levels, packs]);

  const packComparisonData = useMemo(() => {
    // Filter out packs with 0 levels to prevent showing unreleased or empty packs
    return packs
      .map(pack => {
        const packLevels = levels.filter(l => l.packId === pack.id);
        const playersStats = players.map(p => {
          let completed = 0;
          let totalTime = 0;
          packLevels.forEach(level => {
            const lStats = p.levels[level.id];
            if (lStats) {
              completed += 1;
              totalTime += lStats.bestTime;
            }
          });
          return {
            username: p.username,
            completed,
            totalTime,
            allCompleted: completed === packLevels.length
          };
        });

        let bestIndex = -1;
        let maxCompleted = 0;
        let minTime = Infinity;
        
        playersStats.forEach((ps, idx) => {
          if (ps.completed > maxCompleted) {
            maxCompleted = ps.completed;
            minTime = ps.totalTime;
            bestIndex = idx;
          } else if (ps.completed === maxCompleted && ps.completed > 0 && ps.totalTime < minTime) {
            minTime = ps.totalTime;
            bestIndex = idx;
          }
        });

        return {
          pack,
          playersStats,
          bestIndex,
          totalLevelsInPack: packLevels.length
        };
      })
      .filter(p => p.totalLevelsInPack > 0);
  }, [players, levels, packs]);

  const filteredUsernames = useMemo(() => {
    return allUsernames
      .filter(u => 
        u.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !selectedUsernames.includes(u)
      )
      .slice(0, 5);
  }, [allUsernames, searchQuery, selectedUsernames]);

  const addPlayer = (username: string) => {
    if (selectedUsernames.length < 4) {
      setSelectedUsernames(prev => [...prev, username]);
      setSearchQuery("");
    }
  };

  const removePlayer = (username: string) => {
    if (selectedUsernames.length > 1) {
      setSelectedUsernames(prev => prev.filter(u => u !== username));
    }
  };

  const comparisonData = useMemo(() => {
    return sortedLevelsForComparison.map(level => {
      const levelStats = players.map(p => ({
        username: p.username,
        stats: p.levels[level.id]
      }));

      const playedStats = levelStats.filter(s => s.stats);
      const bestTime = playedStats.length > 0 
        ? Math.min(...playedStats.map(s => s.stats!.bestTime))
        : null;

      return {
        level,
        playerStats: levelStats,
        bestTime
      };
    }).filter(d => d.playerStats.some(s => s.stats));
  }, [players, sortedLevelsForComparison]);

  const [chartViewMode, setChartViewMode] = useState<'all' | 'shared'>('all');

  const multiChartData = useMemo(() => {
    let filtered = comparisonData;
    if (chartViewMode === 'shared') {
      filtered = comparisonData.filter(d => 
        players.every(p => d.playerStats.some(ps => ps.username === p.username && ps.stats))
      );
    }
    
    return filtered.map(d => {
      const dataPoint: Record<string, any> = {
        levelName: d.level.name,
      };
      
      players.forEach(p => {
        const run = d.playerStats.find(ps => ps.username === p.username)?.stats;
        dataPoint[p.username] = run ? parseFloat(run.bestTime.toFixed(3)) : null;
      });
      
      return dataPoint;
    });
  }, [comparisonData, players, chartViewMode]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onBack}
            className="text-slate-400 hover:text-white hover:bg-white/5"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--app-accent)]/20 rounded-lg flex items-center justify-center border border-[var(--app-accent)]/30">
              <Users className="w-6 h-6 text-[var(--app-accent)]" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Compare Players</h2>
              <p className="text-slate-500 text-xs">Compare up to 4 players side-by-side</p>
            </div>
          </div>
        </div>

        {selectedUsernames.length < 4 && (
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input 
              placeholder="Add player..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-white/5 border-white/10 pl-10 h-10"
            />
            {searchQuery && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1a1a] border border-white/10 rounded-md overflow-hidden z-50 shadow-2xl">
                {filteredUsernames.length > 0 ? filteredUsernames.map(u => (
                  <button 
                    key={u}
                    onClick={() => addPlayer(u)}
                    className="w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-[var(--app-accent)] hover:text-white transition-colors border-b border-white/5 last:border-0"
                  >
                    {u}
                  </button>
                )) : (
                  <div className="px-4 py-2 text-sm text-slate-500 italic">No players found</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {players.map((player, idx) => (
          <Card key={player.username} className={cn(
            "bg-white/5 border-white/10 relative overflow-hidden group",
            idx === 0 ? "border-[var(--app-accent)]/30" : 
            idx === 1 ? "border-[#6366F1]/30" :
            idx === 2 ? "border-[#2DD4BF]/30" : "border-[#F59E0B]/30"
          )}>
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className={cn(
                    "text-[10px] uppercase tracking-widest font-bold mb-1",
                    idx === 0 ? "text-[var(--app-accent)]" : 
                    idx === 1 ? "text-[#6366F1]" :
                    idx === 2 ? "text-[#2DD4BF]" : "text-[#F59E0B]"
                  )}>Player {idx + 1}</p>
                  <h3 className="text-lg font-bold text-white truncate max-w-[120px]">{player.username}</h3>
                </div>
                {selectedUsernames.length > 1 && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removePlayer(player.username)} 
                    className="h-6 w-6 text-slate-500 hover:text-red-400 hover:bg-red-400/10"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-black/20 rounded p-2">
                  <p className="text-[8px] text-slate-500 uppercase font-bold">Levels</p>
                  <p className="text-sm font-mono text-white">{Object.keys(player.levels).length}</p>
                </div>
                <div className="bg-black/20 rounded p-2">
                  <p className="text-[8px] text-slate-500 uppercase font-bold">Avg Time</p>
                  <p className="text-sm font-mono text-white">
                    {formatTime((Object.values(player.levels) as { bestTime: number }[]).reduce((a, b) => a + b.bestTime, 0) / Math.max(1, Object.keys(player.levels).length), 'seconds')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Multi-Player Performance Comparison Chart */}
      {players.length >= 2 && (
        <Card className="bg-white/5 border-white/10 overflow-hidden">
          <CardHeader className="border-b border-white/10 bg-white/[0.02] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                <ArrowUpDown className="w-5 h-5 text-[var(--app-accent)]" />
                Performance Comparison Timeline
              </CardTitle>
              <p className="text-slate-500 text-xs mt-1">
                Visualizing run times across campaigns. Lower means faster speedrun times.
              </p>
            </div>
            
            {/* Chart mode toggle */}
            <div className="flex bg-black/30 p-1 rounded-lg border border-white/5 shrink-0 self-start sm:self-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChartViewMode('all')}
                className={cn(
                  "h-7 text-xs px-3 rounded-md font-medium transition-all",
                  chartViewMode === 'all' 
                    ? "bg-[var(--app-accent)] text-white shadow-sm" 
                    : "text-slate-400 hover:text-white"
                )}
              >
                All Levels
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setChartViewMode('shared')}
                className={cn(
                  "h-7 text-xs px-3 rounded-md font-medium transition-all",
                  chartViewMode === 'shared' 
                    ? "bg-[var(--app-accent)] text-white shadow-sm" 
                    : "text-slate-400 hover:text-white"
                )}
              >
                Shared Completed Only
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {multiChartData.length > 0 ? (
              <div className="space-y-4">
                <div className="h-[360px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={multiChartData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                      <XAxis 
                        dataKey="levelName" 
                        stroke="#64748b" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        dy={5}
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        unit="s"
                      />
                      <Tooltip 
                        content={({ active, payload, label }) => {
                          if (active && payload && payload.length) {
                            const dataPoint = payload[0].payload;
                            
                            // Map all compared players
                            const list = players.map((p, idx) => {
                              const time = dataPoint[p.username];
                              const color = idx === 0 ? "#38BDF8" : idx === 1 ? "#6366F1" : idx === 2 ? "#2DD4BF" : "#F59E0B";
                              return {
                                username: p.username,
                                time,
                                color
                              };
                            });
                            
                            // Sort by time (fastest first), placing nulls at the end
                            const sortedList = [...list].sort((a, b) => {
                              if (a.time === null || a.time === undefined) return 1;
                              if (b.time === null || b.time === undefined) return -1;
                              return a.time - b.time;
                            });
                            
                            return (
                              <div className="bg-[#121212]/95 border border-white/10 p-3 rounded-lg shadow-xl font-sans min-w-[220px]">
                                <p className="text-white font-extrabold mb-2 text-xs border-b border-white/10 pb-1 flex items-center justify-between">
                                  <span>{label}</span>
                                  <span className="text-slate-500 font-mono text-[9px]">Level Rank</span>
                                </p>
                                <div className="space-y-1.5 text-xs font-mono">
                                  {sortedList.map((item, index) => {
                                    const isFirst = index === 0 && item.time !== null && item.time !== undefined;
                                    return (
                                      <div key={item.username} className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                                          <span className={cn("truncate text-slate-300 font-medium", isFirst && "text-white font-semibold")}>
                                            {item.username} {isFirst && "👑"}
                                          </span>
                                        </div>
                                        <span className={cn("font-bold shrink-0", isFirst ? "text-[var(--app-accent)]" : "text-slate-200")}>
                                          {item.time !== null && item.time !== undefined ? `${item.time.toFixed(3)}s` : "No Run"}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Legend 
                        verticalAlign="top" 
                        height={36} 
                        wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', paddingBottom: '10px' }}
                      />
                      {players.map((player, idx) => {
                        const color = idx === 0 ? "#38BDF8" : idx === 1 ? "#6366F1" : idx === 2 ? "#2DD4BF" : "#F59E0B";
                        return (
                          <Line 
                            key={player.username}
                            name={player.username} 
                            type="monotone" 
                            dataKey={player.username} 
                            stroke={color} 
                            strokeWidth={2.5}
                            activeDot={{ r: 6, stroke: '#000', strokeWidth: 1.5 }} 
                            dot={{ r: 3, stroke: color, strokeWidth: 1 }}
                            connectNulls={true}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-center text-slate-500 font-mono">
                  Line points represent level times. Connected lines show consecutive levels.
                </div>
              </div>
            ) : (
              <div className="h-[220px] flex flex-col items-center justify-center text-center text-slate-500 p-4 border border-dashed border-white/5 rounded-lg bg-black/10">
                <Users className="w-8 h-8 text-slate-600 mb-2" />
                <p className="text-sm font-bold text-slate-400">No levels to compare</p>
                <p className="text-xs text-slate-600 max-w-md mt-1">
                  {chartViewMode === 'shared' 
                    ? "None of the compared players have completed the same set of levels yet. Try switching to 'All Levels' mode to see individual progress!"
                    : "No completed campaign runs found for any of the compared players."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Map Pack Comparison Board */}
      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/10 bg-white/[0.02]">
          <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
            <img 
              src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
              alt="Trophy" 
              className="w-5 h-5 object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            Map Pack Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/[0.02]">
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Map Pack</TableHead>
                  {players.map((p, idx) => (
                    <TableHead key={p.username} className="font-mono text-[10px] uppercase tracking-widest text-slate-500 text-center">
                      {p.username}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {packComparisonData.map(({ pack, playersStats, bestIndex }) => (
                  <TableRow key={pack.id} className="border-white/5 hover:bg-white/[0.01]">
                    <TableCell className="font-bold text-slate-200 py-3.5 whitespace-nowrap">
                      {pack.name}
                    </TableCell>
                    {playersStats.map((ps, idx) => {
                      const isBest = idx === bestIndex;
                      return (
                        <TableCell key={ps.username} className="text-center py-3.5">
                          {ps.completed > 0 ? (
                            <div className="space-y-1">
                              <div className={cn(
                                "font-mono font-bold text-sm flex items-center justify-center gap-1.5",
                                isBest ? (
                                  idx === 0 ? "text-[var(--app-accent)]" : 
                                  idx === 1 ? "text-[#6366F1]" :
                                  idx === 2 ? "text-[#2DD4BF]" : "text-[#F59E0B]"
                                ) : "text-slate-400"
                              )}>
                                {formatTime(ps.totalTime, 'seconds')}
                                {isBest && (
                                  <img 
                                    src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
                                    alt="Best" 
                                    className="w-3.5 h-3.5 object-contain"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  />
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {ps.completed} Completed
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-700 font-mono text-xs">No runs</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Comparison Table */}
      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/10 bg-white/[0.02]">
          <CardTitle className="text-lg font-bold text-white">Level Comparison</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-white/[0.02]">
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Level</TableHead>
                  {players.map((p, idx) => (
                    <TableHead key={p.username} className="font-mono text-[10px] uppercase tracking-widest text-slate-500 text-center">
                      {p.username}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonData.map(({ level, playerStats, bestTime }) => (
                  <TableRow key={level.id} className="border-white/5 hover:bg-white/[0.01] transition-colors">
                    <TableCell 
                      className="font-medium text-slate-300 whitespace-nowrap hover:underline cursor-pointer hover:text-[var(--app-accent)] transition-colors"
                      onClick={() => onLevelClick(level.id)}
                    >
                      <div className="flex items-center gap-3">
                        <img 
                          src={`https://api.narrowarrow.xyz/level-image/${level.id}.png`}
                          referrerPolicy="no-referrer"
                          alt=""
                          className="w-9 h-9 rounded border border-white/10 object-cover bg-black/40 shrink-0"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-slate-200 group-hover:text-[var(--app-accent)] transition-colors">{level.name}</span>
                            <a
                              href={`https://narrowarrow.xyz/levelid=${level.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-500 hover:text-emerald-400 p-1 rounded hover:bg-white/5 transition-colors shrink-0"
                              onClick={(e) => e.stopPropagation()}
                              title="Play Level"
                              id={`play-btn-compare-${level.id}`}
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </a>
                          </div>
                          <div className="text-[9px] text-slate-500 font-normal mt-0.5">
                            {packs.find(p => p.id === level.packId)?.name || capitalizeName(level.packId) || 'Unknown Pack'}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    {playerStats.map((ps, idx) => (
                      <TableCell key={ps.username} className="text-center">
                        {ps.stats ? (
                          <div className={cn(
                            "font-mono font-bold whitespace-nowrap",
                            ps.stats.bestTime === bestTime ? (
                              idx === 0 ? "text-[var(--app-accent)]" : 
                              idx === 1 ? "text-[#6366F1]" :
                              idx === 2 ? "text-[#2DD4BF]" : "text-[#F59E0B]"
                            ) : "text-slate-500"
                          )}>
                            {formatTime(ps.stats.bestTime, 'seconds')}
                            {ps.stats.bestTime === bestTime && (
                              <img 
                                src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
                                alt="Best" 
                                className="inline-block ml-2 w-3 h-3 object-contain"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            )}
                          </div>
                        ) : <span className="text-slate-700 font-mono text-xs">--</span>}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
