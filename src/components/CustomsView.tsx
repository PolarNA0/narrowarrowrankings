import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Compass, 
  Flame, 
  Sparkles, 
  Search, 
  Play, 
  Trophy, 
  Heart, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw, 
  AlertCircle,
  HelpCircle,
  Clock,
  ExternalLink,
  ArrowLeft,
  ArrowUpDown,
  Users,
  Target,
  Info
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowIcon } from "./ArrowIcon";
import { ClickToCopy } from "./ClickToCopy";

interface CustomsViewProps {
  onBack: () => void;
  onSelectPlayer?: (username: string) => void;
  selectedLevelId: string | null;
  onSelectLevelId: (id: string | null) => void;
}

export function CustomsView({ onBack, onSelectPlayer, selectedLevelId, onSelectLevelId }: CustomsViewProps) {
  // Ordered as requested: 1: Discover, 2: New, 3: Popular
  const [filter, setFilter] = useState<"discover" | "new" | "popular">("discover");
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [levels, setLevels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Detail view state for a selected level
  const [selectedLevelDetail, setSelectedLevelDetail] = useState<any>(null);
  const [leaderboardData, setLeaderboardData] = useState<any[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboardSearch, setLeaderboardSearch] = useState("");

  // Daily level states
  const [dailyLevelId, setDailyLevelId] = useState<string | null>(null);
  const [dailyLevelName, setDailyLevelName] = useState<string>("Daily Level");
  const [dailyCreator, setDailyCreator] = useState<string>("Unknown");
  const [dailyData, setDailyData] = useState<any | null>(null);
  const [dailyLevelDetail, setDailyLevelDetail] = useState<any | null>(null);

  const fetchCustomLevels = async () => {
    setLoading(true);
    setError(null);
    try {
      const q = searchQuery.trim();
      let foundSpecificLevel = false;
      let levelList: any[] = [];

      // Extractor helper to find Level ID from typed ID or a Narrow Arrow URL link
      let extractedId: string | null = null;
      if (q) {
        if (q.includes("levelid=")) {
          const match = q.match(/levelid=([^&/]+)/);
          if (match && match[1]) {
            extractedId = match[1];
          }
        } else if (q.includes("/")) {
          const segments = q.split("/");
          const last = segments[segments.length - 1];
          if (last) extractedId = last;
        } else if (/^[a-zA-Z0-9_\-]+$/.test(q)) {
          extractedId = q;
        }
      }

      if (extractedId) {
        try {
          const res = await fetch(`/api/level-details/${encodeURIComponent(extractedId)}`);
          if (res.ok) {
            const detail = await res.json();
            if (detail && (detail.id || detail.level_id || detail.levelKey)) {
              const singleLevel = {
                id: extractedId,
                level_id: extractedId,
                name: detail.name || detail.title || `Level ${extractedId}`,
                creator_name: detail.creator_name || detail.author || detail.username || "Unknown",
                plays: detail.plays ?? detail.totalPlays ?? detail.total_plays ?? detail.playCount ?? detail.play_count ?? 0,
                likes: detail.likes ?? detail.totalLikes ?? detail.total_likes ?? detail.likeCount ?? detail.like_count ?? 0,
                worldRecord: detail.worldRecord || null
              };
              levelList = [singleLevel];
              foundSpecificLevel = true;
            }
          }
        } catch (err) {
          console.error("Error trying to fetch specific level ID:", err);
        }
      }

      if (!foundSpecificLevel) {
        let url = `/api/published-levels?filter=${filter}&page=${page}`;
        if (q) {
          url += `&search=${encodeURIComponent(q)}`;
        }

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error("Failed to fetch published levels");
        }

        const data = await res.json();
        levelList = data ? (Array.isArray(data) ? data : (data.levels || data.results || [])) : [];
      }

      setLevels(levelList.filter(Boolean));
    } catch (err: any) {
      console.error("Error loading custom levels:", err);
      setError("Failed to load custom levels. The API may be temporarily down.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomLevels();
  }, [filter, page, searchQuery]);

  // Fetch daily level details from startup-data
  useEffect(() => {
    const fetchDailyLevel = async () => {
      try {
        const res = await fetch("/api/startup-data");
        if (res.ok) {
          const sData = await res.json();
          if (sData?.daily?.level) {
            const dLevel = sData.daily.level;
            const dailyId = dLevel.levelKey || dLevel.id;
            setDailyLevelId(dailyId);
            setDailyLevelName(dLevel.name || dLevel.title || "Daily Level");
            setDailyCreator(dLevel.creatorName || dLevel.author || "Unknown");
            setDailyData(sData.daily);

            if (dailyId) {
              try {
                const detailRes = await fetch(`/api/level-details/${encodeURIComponent(dailyId)}`);
                if (detailRes.ok) {
                  const detail = await detailRes.json();
                  setDailyLevelDetail({
                    id: dailyId,
                    level_id: dailyId,
                    name: detail.name || detail.title || dLevel.name || dLevel.title || "Daily Level",
                    creator_name: detail.creator_name || detail.author || detail.username || dLevel.creatorName || dLevel.author || "Unknown",
                    plays: detail.plays ?? detail.totalPlays ?? detail.total_plays ?? detail.playCount ?? detail.play_count ?? 0,
                    likes: detail.likes ?? detail.totalLikes ?? detail.total_likes ?? detail.likeCount ?? detail.like_count ?? 0,
                    worldRecord: detail.worldRecord || null
                  });
                }
              } catch (detailErr) {
                console.error("Error fetching daily level detail:", detailErr);
              }
            }
          }
        }
      } catch (err) {
        console.error("Error loading daily level:", err);
      }
    };
    fetchDailyLevel();
  }, []);

  // Fetch leaderboard data when a level is selected inside customs
  useEffect(() => {
    if (!selectedLevelId) {
      setSelectedLevelDetail(null);
      setLeaderboardData([]);
      return;
    }

    const fetchDetailAndLeaderboard = async () => {
      setLeaderboardLoading(true);
      setLeaderboardError(null);
      try {
        // Fetch level details
        const detailRes = await fetch(`/api/level-details/${encodeURIComponent(selectedLevelId)}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          setSelectedLevelDetail(detail);
        }

        // Fetch leaderboard entries
        const leaderboardRes = await fetch(`/api/leaderboard/${encodeURIComponent(selectedLevelId)}?infiniteLeaderboard=true`);
        if (!leaderboardRes.ok) {
          throw new Error("Failed to fetch leaderboard data");
        }
        const lbData = await leaderboardRes.json();
        setLeaderboardData(Array.isArray(lbData) ? lbData : []);
      } catch (err: any) {
        console.error("Error fetching custom leaderboard:", err);
        setLeaderboardError("Failed to fetch leaderboard for this custom level.");
      } finally {
        setLeaderboardLoading(false);
      }
    };

    fetchDetailAndLeaderboard();
  }, [selectedLevelId]);

  // Handle filter changes (reset page)
  const handleFilterChange = (newFilter: "discover" | "new" | "popular") => {
    setFilter(newFilter);
    setPage(0);
  };

  // Handle search submission
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(searchInput);
    setPage(0);
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchQuery("");
    setPage(0);
  };

  const formatTime = (seconds: number, forceMode?: 'seconds' | 'minutes') => {
    const mode = forceMode || 'seconds';
    if (mode === 'seconds') {
      return `${seconds.toFixed(3)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3);
    return `${mins}:${secs.padStart(6, '0')}m`;
  };

  // Process leaderboard entries
  const processedLeaderboard = useMemo(() => {
    const mapped = leaderboardData.map((entry, idx) => ({
      ...entry,
      originalRank: idx + 1
    }));

    if (leaderboardSearch.trim()) {
      const s = leaderboardSearch.toLowerCase().trim();
      return mapped.filter(entry => entry.username && entry.username.toLowerCase().includes(s));
    }
    return mapped;
  }, [leaderboardData, leaderboardSearch]);

  const activePlayersCount = useMemo(() => {
    return new Set(leaderboardData.map(d => d.username)).size;
  }, [leaderboardData]);

  const topTime = useMemo(() => {
    if (leaderboardData.length === 0) return null;
    return Math.min(...leaderboardData.map(d => d.completion_time));
  }, [leaderboardData]);

  const avgTime = useMemo(() => {
    if (leaderboardData.length === 0) return null;
    const sum = leaderboardData.reduce((acc, curr) => acc + curr.completion_time, 0);
    return sum / leaderboardData.length;
  }, [leaderboardData]);

  const totalTimeSum = useMemo(() => {
    if (leaderboardData.length === 0) return null;
    return leaderboardData.reduce((acc, curr) => acc + curr.completion_time, 0);
  }, [leaderboardData]);

  // Find name from local levels list as fallback first!
  const localLevelInfo = useMemo(() => {
    if (!selectedLevelId) return null;
    return levels.find(l => {
      const lid = l.level_id || l.id || l.levelKey || l.levelId || "";
      return lid === selectedLevelId;
    });
  }, [selectedLevelId, levels]);

  // If a level is selected, render the inner custom leaderboard details
  if (selectedLevelId) {
    const levelName = selectedLevelDetail?.name || selectedLevelDetail?.title || selectedLevelDetail?.data?.map_name || selectedLevelDetail?.data?.name || selectedLevelDetail?.level_name || localLevelInfo?.name || localLevelInfo?.title || `Level ${selectedLevelId}`;
    const creatorName = selectedLevelDetail?.creator_name || selectedLevelDetail?.author || selectedLevelDetail?.username || selectedLevelDetail?.data?.creator_name || selectedLevelDetail?.creator?.username || localLevelInfo?.creator_name || localLevelInfo?.author || localLevelInfo?.username || "Unknown";
    
    return (
      <div id="custom-leaderboard-container" className="space-y-6 max-w-7xl mx-auto px-4 md:px-8 py-6">
        {/* Navigation button */}
        <div className="flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => onSelectLevelId(null)} 
            className="text-slate-400 hover:text-white flex items-center gap-1.5 pl-0"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Custom Levels
          </Button>
          <a
            href={`https://narrowarrow.xyz/levelid=${selectedLevelId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-lg transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]"
          >
            <Play className="w-3.5 h-3.5 fill-current text-slate-950" /> Play Level <ExternalLink className="w-3 h-3 text-slate-950" />
          </a>
        </div>

        {/* Level Hero Card inside Customs */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-black/80 via-black/40 to-transparent p-6 flex flex-col md:flex-row gap-6 items-center justify-between shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
          {/* Backdrop Blur Level Image */}
          <div className="absolute inset-0 z-0 opacity-15 pointer-events-none blur-xl">
            <img 
              src={`https://api.narrowarrow.xyz/level-image/${selectedLevelId}.png`}
              referrerPolicy="no-referrer"
              alt=""
              className="w-full h-full object-cover scale-110"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          
          <div className="relative z-10 flex flex-col md:flex-row items-center gap-6 text-center md:text-left w-full md:w-auto">
            <div className="w-24 h-24 rounded-xl overflow-hidden border border-white/20 bg-black/50 shadow-lg shrink-0 group relative">
              <img 
                src={`https://api.narrowarrow.xyz/level-image/${selectedLevelId}.png`}
                referrerPolicy="no-referrer"
                alt={levelName}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                <Badge variant="outline" className="bg-[var(--app-accent)]/15 text-[var(--app-accent)] border-[var(--app-accent)]/30 uppercase font-mono tracking-wider text-[9px]">
                  Custom Level
                </Badge>
                <ClickToCopy text={selectedLevelId} label="ID" className="h-5" />
              </div>
              <div className="space-y-1">
                <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                  {levelName}
                </h2>
                <p className="text-xs text-slate-400">
                  created by <span className="text-teal-400 font-semibold">{creatorName}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Core Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { label: "Active Players", value: leaderboardLoading ? "..." : activePlayersCount, icon: Users, color: "text-[var(--app-accent)]" },
            { 
              label: "Top Time", 
              value: leaderboardLoading ? "..." : (topTime !== null ? formatTime(topTime, 'seconds') : "N/A"), 
              icon: Trophy, 
              color: "text-yellow-400",
              imgSrc: "https://play.narrowarrow.xyz/assets/assets/images/trophy.svg"
            },
            { 
              label: "Average Time", 
              value: leaderboardLoading ? "..." : (avgTime !== null ? formatTime(avgTime, 'seconds') : "N/A"), 
              icon: Target, 
              color: "text-[#2DD4BF]" 
            },
            { 
              label: "Total Time", 
              value: leaderboardLoading ? "..." : (totalTimeSum !== null ? formatTime(totalTimeSum, 'minutes') : "N/A"), 
              icon: Clock, 
              color: "text-[#6366F1]" 
            },
          ].map((stat, i) => (
            <Card key={i} className="bg-white/5 border-white/10 overflow-hidden group hover:border-white/20 transition-all">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{stat.label}</p>
                  <div className="text-xl md:text-2xl font-mono font-bold text-white">{stat.value}</div>
                </div>
                <div className={`w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform ${stat.color}`}>
                  {stat.imgSrc ? (
                    <img 
                      src={stat.imgSrc} 
                      alt={stat.label} 
                      className="w-5 h-5 object-contain"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <stat.icon className="w-5 h-5" />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filter / Search inside the selected custom leaderboard */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-white">Leaderboard Records</h4>
            <p className="text-slate-400 text-xs">Verify completed runs, run arrows, and flight dates.</p>
          </div>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input 
              placeholder="Search player name..." 
              className="bg-black/40 border-white/10 h-9 pl-9 text-xs text-slate-200 focus-visible:ring-[var(--app-accent)]/50"
              value={leaderboardSearch}
              onChange={(e) => setLeaderboardSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Leaderboard Table Grid */}
        <Card className="bg-white/5 border-white/10 overflow-hidden">
          <CardContent className="p-0">
            {leaderboardLoading ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <RefreshCw className="w-10 h-10 text-[var(--app-accent)] animate-spin" />
                <p className="text-slate-400 font-mono text-xs">Loading custom speedrun rankings...</p>
              </div>
            ) : leaderboardError ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4">
                <AlertCircle className="w-10 h-10 text-red-400" />
                <p className="text-slate-300 font-mono text-sm">{leaderboardError}</p>
              </div>
            ) : processedLeaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-slate-400 font-mono text-xs">No records found matching criteria.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/[0.02]">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="w-16 text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">#</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Player</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Time</TableHead>
                      <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedLeaderboard.map((entry, index) => {
                      const dateStr = entry.created_at ? new Date(entry.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : "---";
                      return (
                        <TableRow key={entry.run_id || index} className="border-white/5 hover:bg-white/[0.03] transition-colors group">
                          <TableCell className="text-center font-mono text-slate-500 group-hover:text-white transition-colors">
                            {entry.originalRank}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <ArrowIcon name={entry.arrow_name} className={cn(
                                "w-4 h-4 shrink-0",
                                entry.arrow_name.toLowerCase().includes("energy") ? "text-[#22c55e]" :
                                entry.arrow_name.toLowerCase().includes("speedy") ? "text-[#3b82f6]" :
                                "text-[var(--app-accent)]"
                              )} />
                              <div className="flex items-center gap-2 min-w-0">
                                <img 
                                  src="https://play.narrowarrow.xyz/assets/assets/images/account.svg" 
                                  alt="" 
                                  className="w-3.5 h-3.5 object-contain opacity-50 group-hover:opacity-100 transition-opacity shrink-0"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                                <span 
                                  onClick={() => {
                                    if (onSelectPlayer) {
                                      onSelectPlayer(entry.username);
                                    }
                                  }}
                                  className="font-bold text-slate-200 group-hover:text-[var(--app-accent)] transition-colors cursor-pointer"
                                >
                                  {entry.username}
                                </span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono font-bold text-[#2DD4BF]">
                            {formatTime(entry.completion_time, 'seconds')}
                          </TableCell>
                          <TableCell className="text-right font-mono text-slate-500 text-[11px]">
                            {dateStr}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div id="customs-view-container" className="space-y-6 max-w-7xl mx-auto px-4 md:px-8 py-6">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Compass className="w-7 h-7 text-[var(--app-accent)]" />
            Custom Levels
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Explore community creations, view active speedrun leaderboards, or launch directly into gameplay.
          </p>
        </div>
      </div>

      {/* Control bar: Search, Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between bg-white/[0.02] border border-white/5 p-4 rounded-xl">
        {/* Filters ordered as requested: 1: Discover, 2: New, 3: Popular */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleFilterChange("discover")}
            className={`font-extrabold text-xs uppercase tracking-wider px-4 py-2 ${
              filter === "discover" 
                ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200" 
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Compass className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
            Discover
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleFilterChange("new")}
            className={`font-extrabold text-xs uppercase tracking-wider px-4 py-2 ${
              filter === "new" 
                ? "bg-violet-500/10 text-violet-300 hover:bg-violet-500/15 hover:text-violet-200" 
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-violet-400" />
            New
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleFilterChange("popular")}
            className={`font-extrabold text-xs uppercase tracking-wider px-4 py-2 ${
              filter === "popular" 
                ? "bg-amber-500/10 text-amber-300 hover:bg-amber-500/15 hover:text-amber-200" 
                : "text-slate-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Flame className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
            Popular
          </Button>
        </div>

        {/* Search form */}
        <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md w-full flex gap-2">
          <div className="relative flex-1">
            <Input
              type="text"
              placeholder="Search levels by pasting ID, link, or search words..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="bg-black/40 border-white/10 text-xs text-slate-200 h-9 w-full pr-8 focus-visible:ring-[var(--app-accent)]/50"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
              >
                Clear
              </button>
            )}
          </div>
          <Button 
            type="submit" 
            size="sm" 
            className="bg-[var(--app-accent)] hover:bg-[#0EA5E9] text-slate-950 font-bold h-9"
          >
            <Search className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>

      {/* Main Grid area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <RefreshCw className="w-12 h-12 text-[var(--app-accent)] animate-spin" />
          <p className="text-slate-400 font-mono text-sm animate-pulse">Scanning custom speedrun levels...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4 bg-white/[0.02] border border-white/5 rounded-xl">
          <AlertCircle className="w-12 h-12 text-red-400" />
          <p className="text-slate-300 font-mono text-sm">{error}</p>
          <Button onClick={fetchCustomLevels} variant="outline" className="border-white/10 text-slate-300 hover:text-white mt-2">
            Retry Connection
          </Button>
        </div>
      ) : levels.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4 bg-white/[0.02] border border-white/5 rounded-xl text-center">
          <HelpCircle className="w-12 h-12 text-slate-600" />
          <p className="text-slate-400 font-mono text-sm">No custom levels found.</p>
          {searchQuery && (
            <p className="text-slate-500 text-xs max-w-sm">
              We couldn't find levels matching "{searchQuery}". Try relaxing your search terms or clearing the filter.
            </p>
          )}
          <Button onClick={clearSearch} variant="outline" className="border-white/10 text-slate-300 hover:text-white mt-2">
            Reset Filters
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {page === 0 && !searchQuery && dailyLevelId && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-r from-violet-600/10 via-amber-500/10 to-[var(--app-accent)]/10 border border-amber-500/30 rounded-2xl p-6 shadow-2xl relative overflow-hidden"
            >
              {/* Subtle pulsing background glow */}
              <div className="absolute top-0 right-0 -translate-y-12 translate-x-12 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
              
              <div className="flex flex-col md:flex-row gap-6 relative z-10">
                {/* Image & Copy Column */}
                <div className="w-full md:w-56 h-36 bg-black/40 rounded-xl overflow-hidden shrink-0 border border-white/10 relative">
                  <img 
                    src={`https://api.narrowarrow.xyz/level-image/${dailyLevelId}.png`}
                    referrerPolicy="no-referrer"
                    alt={dailyLevelName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.src = "https://play.narrowarrow.xyz/assets/assets/images/placeholder_level.png";
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex justify-between items-center">
                    <ClickToCopy text={dailyLevelId} label="ID" className="text-slate-300 bg-black/60 border-white/10 h-5 text-[10px]" />
                    {dailyLevelDetail?.likes !== undefined && (
                      <span className="flex items-center gap-1 font-mono text-[10px] bg-black/60 px-1.5 py-0.5 rounded border border-white/5 text-white">
                        <Heart className="w-2.5 h-2.5 fill-current text-rose-500" />
                        {dailyLevelDetail.likes.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Details Column */}
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Badge className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-extrabold text-[9px] uppercase tracking-wider py-0.5 px-2 flex items-center gap-1">
                        <Flame className="w-3 h-3 fill-current animate-bounce" /> Daily Level Challenge
                      </Badge>
                      {dailyData?.streak !== undefined && (
                        <Badge variant="outline" className="bg-white/5 border-amber-500/20 text-amber-400 font-mono text-[9px] px-2 py-0.5">
                          Streak: {dailyData.streak} days 🔥
                        </Badge>
                      )}
                      {dailyData?.bestStreak !== undefined && (
                        <Badge variant="outline" className="bg-white/5 border-white/5 text-slate-400 font-mono text-[9px] px-2 py-0.5">
                          Best Streak: {dailyData.bestStreak}
                        </Badge>
                      )}
                    </div>

                    <h3 className="text-xl font-black text-white tracking-tight">{dailyLevelName}</h3>
                    <p className="text-slate-400 text-xs mt-1">
                      Created by <span className="text-teal-400 font-bold">{dailyCreator}</span>
                    </p>
                  </div>

                  {/* Level Info Summary block */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-black/30 border border-white/5 rounded-xl p-3 text-center my-4">
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold">Plays</p>
                      <p className="text-sm font-mono font-black text-slate-200 mt-0.5">
                        {dailyLevelDetail ? dailyLevelDetail.plays.toLocaleString() : "..."}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold">Likes</p>
                      <p className="text-sm font-mono font-black text-amber-400 mt-0.5">
                        {dailyLevelDetail ? dailyLevelDetail.likes.toLocaleString() : "..."}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold">World Record</p>
                      <p className="text-sm font-mono font-black text-[#2DD4BF] mt-0.5 flex items-center justify-center gap-1">
                        <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        {dailyLevelDetail?.worldRecord ? `${dailyLevelDetail.worldRecord.completion_time.toFixed(3)}s` : "N/A"}
                      </p>
                    </div>
                  </div>

                  {/* Actions row */}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => onSelectLevelId(dailyLevelId)}
                      className="bg-white/10 hover:bg-white/20 border border-white/10 text-white font-extrabold text-xs uppercase tracking-wider h-10 px-5 rounded-xl transition-all flex items-center gap-1.5"
                    >
                      <Trophy className="w-4 h-4 text-amber-400" /> View Leaderboard
                    </Button>
                    
                    <a
                      href={`https://narrowarrow.xyz/levelid=${dailyLevelId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-2 h-10 px-6 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Play Level <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {page === 0 && !searchQuery && dailyLevelId && (
            <div className="border-t border-white/5 pt-4">
              <h4 className="text-xs uppercase tracking-wider font-extrabold text-slate-400 mb-2 font-mono">Discover More Custom Levels</h4>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {levels.map((level, idx) => {
              const levelId = level.level_id || level.id || level.levelKey || level.levelId || "";
              if (!levelId) return null;
              const creatorName = level.creator_name || level.author || level.username || "Unknown";
              const levelName = level.name || level.title || `Level ${levelId}`;
              const plays = level.plays ?? level.totalPlays ?? level.total_plays ?? level.playCount ?? level.play_count ?? 0;
              const likes = level.likes ?? level.totalLikes ?? level.total_likes ?? level.likeCount ?? level.like_count ?? 0;
              const worldRecord = level.worldRecord;

              return (
                <motion.div
                  key={levelId + "-" + idx}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(idx * 0.03, 0.4) }}
                >
                  <Card className="h-full bg-white/5 border-white/10 hover:border-[var(--app-accent)]/40 transition-all duration-300 flex flex-col overflow-hidden group">
                    {/* Level embed image preview */}
                    <div className="relative h-40 bg-black/40 overflow-hidden shrink-0 border-b border-white/10">
                      <img 
                        src={`https://api.narrowarrow.xyz/level-image/${levelId}.png`}
                        referrerPolicy="no-referrer"
                        alt={levelName}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e) => {
                          e.currentTarget.src = "https://play.narrowarrow.xyz/assets/assets/images/placeholder_level.png";
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"></div>
                      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                        <ClickToCopy text={levelId} label="ID" className="text-slate-300 bg-black/60 border-white/10 h-5" />
                        <div className="flex gap-2 text-white">
                          <span className="flex items-center gap-1 font-mono text-[10px] bg-black/60 px-1.5 py-0.5 rounded border border-white/5">
                            <Heart className="w-2.5 h-2.5 fill-current text-rose-500" />
                            {likes.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <CardContent className="p-4 flex-1 flex flex-col justify-between space-y-4">
                      {/* Name & Creator */}
                      <div>
                        <h4 className="text-base font-bold text-slate-100 group-hover:text-[var(--app-accent)] transition-colors line-clamp-1">
                          {levelName}
                        </h4>
                        <p className="text-slate-400 text-xs mt-1 font-medium">
                          by <span className="text-teal-400">{creatorName}</span>
                        </p>
                      </div>

                      {/* Level Stats Block */}
                      <div className="grid grid-cols-2 gap-2 bg-black/30 border border-white/5 rounded-lg p-2 text-center">
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Plays</p>
                          <p className="text-xs font-mono font-bold text-slate-300 mt-0.5">{plays.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Likes</p>
                          <p className="text-xs font-mono font-bold text-amber-400 mt-0.5">{likes.toLocaleString()}</p>
                        </div>
                      </div>

                      {/* World Record Indicator */}
                      {worldRecord && typeof worldRecord.completion_time === "number" && (
                        <div className="flex items-center justify-between text-[11px] bg-[var(--app-accent)]/5 border border-[var(--app-accent)]/10 rounded-lg px-2.5 py-1.5">
                          <span className="text-slate-400 flex items-center gap-1 font-semibold">
                            <Trophy className="w-3.5 h-3.5 text-amber-400" /> World Record:
                          </span>
                          <span className="font-mono text-[var(--app-accent)] font-bold">
                            {worldRecord.completion_time.toFixed(3)}s
                          </span>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSelectLevelId(levelId)}
                          className="border-white/10 hover:bg-[var(--app-accent)] hover:text-slate-950 hover:border-transparent text-xs font-bold"
                        >
                          Leaderboard
                        </Button>
                        <a
                          href={`https://narrowarrow.xyz/levelid=${levelId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-lg transition-all duration-300 shadow-[0_0_10px_rgba(16,185,129,0.3)] text-center"
                        >
                          <Play className="w-3 h-3 fill-current text-slate-950" /> Play <ExternalLink className="w-3 h-3 text-slate-950" />
                        </a>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>

          {/* Pagination controls */}
          <div className="flex items-center justify-center pt-8 border-t border-white/10">
            <div className="inline-flex items-center gap-1 bg-white/5 border border-white/10 p-1.5 rounded-2xl shadow-xl">
              <Button
                variant="ghost"
                size="icon"
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
                className="h-9 w-9 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all"
                title="Previous Page"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              
              <div className="px-4 py-1.5 flex flex-col items-center justify-center select-none shrink-0 min-w-[100px]">
                <p className="text-[9px] uppercase tracking-wider text-slate-500 font-extrabold mb-0.5">Current Page</p>
                <p className="text-sm font-mono font-extrabold text-white leading-none">{page + 1}</p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                disabled={levels.length < 9}
                onClick={() => setPage(p => p + 1)}
                className="h-9 w-9 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all"
                title="Next Page"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple helper utility to conditionally merge classes
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}
