import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { 
  User, 
  Trophy, 
  Clock, 
  Target, 
  ChevronLeft, 
  TrendingUp, 
  Calendar,
  ArrowRight,
  Medal,
  Star,
  ArrowUpDown,
  Shield,
  Zap,
  Award,
  Flame,
  Crown,
  Gamepad2,
  Activity,
  Play,
  Heart,
  RefreshCw
} from "lucide-react";
import { motion } from "motion/react";
import { PlayerStats, LevelInfo, RankInfo, LevelRankConfig, LevelPack } from "../types";
import { RANK_ORDER, DEFAULT_RANKS } from "../constants";
import { getLevelDefaultRanks } from "../lib/rankDefaults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowIcon } from "./ArrowIcon";
import { cn, capitalizeName } from "@/lib/utils";
import { LevelHistoryDetail } from "./LevelHistoryDetail";
import { ProfileIdentityCard } from "./ProfileIdentityCard";
import { PlayerBadges } from "./PlayerBadges";
import { useOfficialCreators } from "@/hooks/useProfileSummaries";
import type { LeaderboardEntry, LegacyRun } from "../types";
import type { PlayerProfileRow } from "@/hooks/usePlayerProfiles";

interface PlayerProfileProps {
  stats: PlayerStats;
  levels: LevelInfo[];
  packs: LevelPack[];
  rankConfigs: Record<string, LevelRankConfig>;
  globalRankConfig: Record<string, RankInfo>;
  overallRankConfig: Record<string, RankInfo>;
  packOverallConfigs?: Record<string, Record<string, RankInfo>>;
  onBack: () => void;
  onCompare: (username: string) => void;
  onLevelClick: (levelId: string) => void;
  worldRecords?: { levelId: string; levelName: string; wr: any }[];
  computedMedals?: { first: number; second: number; third: number; top10: number; wrLevelIds: string[] };
  levelStandings?: Record<string, LeaderboardEntry[]>;
  legacyRuns?: LegacyRun[];
  profile?: PlayerProfileRow | null;
  canEditProfile?: boolean;
  onSaveProfile?: (patch: Partial<PlayerProfileRow>) => Promise<void>;
  onRequestSignIn?: () => void;
}

export function PlayerProfile({ 
  stats, 
  levels, 
  packs,
  rankConfigs, 
  globalRankConfig,
  overallRankConfig, 
  packOverallConfigs,
  onBack, 
  onCompare, 
  onLevelClick,
  worldRecords,
  computedMedals,
  levelStandings,
  legacyRuns,
  profile,
  canEditProfile,
  onSaveProfile,
  onRequestSignIn
}: PlayerProfileProps) {
  const [expandedLevel, setExpandedLevel] = useState<string | null>(null);
  const [extraData, setExtraData] = useState<any>(null);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [profileTab, setProfileTab] = useState<'performance' | 'creator'>('performance');
  const [creatorLevels, setCreatorLevels] = useState<any[]>([]);
  const [loadingCreatorLevels, setLoadingCreatorLevels] = useState(false);
  const [creatorLevelsFilter, setCreatorLevelsFilter] = useState<'popular' | 'new'>('popular');
  const [levelSort, setLevelSort] = useState<'default' | 'easiest_to_improve'>('default');

  const getLeagueIconUrl = (league: string) => {
    if (!league) return "";
    let normalized = league.trim().toLowerCase();
    
    // Replace roman numerals at the end of the string with standard digits
    if (normalized.endsWith(" iii") || normalized.endsWith("-iii") || normalized.endsWith("_iii")) {
      normalized = normalized.slice(0, -4) + "3";
    } else if (normalized.endsWith(" ii") || normalized.endsWith("-ii") || normalized.endsWith("_ii")) {
      normalized = normalized.slice(0, -3) + "2";
    } else if (normalized.endsWith(" i") || normalized.endsWith("-i") || normalized.endsWith("_i")) {
      normalized = normalized.slice(0, -2) + "1";
    }
    
    // Remove all remaining spaces or underscores or dashes
    normalized = normalized.replace(/[\s\-_]+/g, "");
    
    return `https://play.narrowarrow.xyz/assets/assets/images/leagues/${normalized}.svg`;
  };

  useEffect(() => {
    if (!stats.username) return;
    let isMounted = true;
    setLoadingExtra(true);
    setExtraData(null);
    setProfileTab('performance');

    fetch(`/api/user/${encodeURIComponent(stats.username)}`)
      .then(res => {
        if (!res.ok) throw new Error("User not found in API");
        return res.json();
      })
      .then(data => {
        if (isMounted) {
          setExtraData(data);
        }
      })
      .catch(err => {
        console.error("Error fetching extra user data:", err);
      })
      .finally(() => {
        if (isMounted) {
          setLoadingExtra(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [stats.username]);

  useEffect(() => {
    if (!stats.username || !extraData?.creator || extraData.creator.levels_published === 0) return;
    
    let isMounted = true;
    setLoadingCreatorLevels(true);
    
    fetch(`/api/published-levels?filter=${creatorLevelsFilter}&page=0&search=by:${encodeURIComponent(stats.username)}`)
      .then(res => {
        if (!res.ok) throw new Error("Could not fetch creator levels");
        return res.json();
      })
      .then(data => {
        if (isMounted) {
          const levelList = data ? (Array.isArray(data) ? data : (data.levels || data.results || [])) : [];
          setCreatorLevels(levelList.filter(Boolean));
        }
      })
      .catch(err => {
        console.error("Error fetching creator levels:", err);
      })
      .finally(() => {
        if (isMounted) {
          setLoadingCreatorLevels(false);
        }
      });
      
    return () => {
      isMounted = false;
    };
  }, [stats.username, extraData?.creator, creatorLevelsFilter]);

  const formatFlightTime = (seconds: number) => {
    if (!seconds) return "0s";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}h ${mins}m`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
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

  const aggregateStats = useMemo(() => {
    const levelEntries = Object.values(stats.levels);
    if (levelEntries.length === 0) return null;

    const totalTime = levelEntries.reduce((acc, curr) => acc + curr.bestTime, 0);
    const avgTime = totalTime / levelEntries.length;
    
    // Find best rank
    const safeRankOrder = Array.isArray(RANK_ORDER) ? RANK_ORDER : [];
    let bestRankIndex = safeRankOrder.length;
    let bestRankId = "Beginner";
    
    levelEntries.forEach(l => {
      const idx = safeRankOrder.indexOf(l.rankId);
      if (idx !== -1 && idx < bestRankIndex) {
        bestRankIndex = idx;
        bestRankId = l.rankId;
      }
    });

    // Calculate overall rank
    let overallRankId = "";
    const safeOverallConfig = overallRankConfig || {};
    const isOverallConfigured = Object.values(safeOverallConfig).some(r => r.timeCutoff > 0);
    
    if (isOverallConfigured) {
      for (const rankId of safeRankOrder) {
        const rInfo = safeOverallConfig[rankId];
        if (rInfo && rInfo.timeCutoff > 0 && totalTime <= rInfo.timeCutoff) {
          overallRankId = rankId;
          break;
        }
      }
    }

    return {
      avgTime,
      totalTime,
      bestRankId,
      overallRankId,
      totalCompleted: levelEntries.length
    };
  }, [stats, overallRankConfig]);

  const packBreakdowns = useMemo(() => {
    const packsMap: Record<string, { id: string; name: string; levels: LevelInfo[]; completed: number; totalTime: number; overallRankId?: string }> = {};
    
    levels.forEach(level => {
      const packId = level.packId || "unknown";
      if (!packsMap[packId]) {
        const packName = packs.find(p => p.id === packId)?.name || capitalizeName(level.packId) || "Unknown Pack";
        packsMap[packId] = {
          id: packId,
          name: packName,
          levels: [],
          completed: 0,
          totalTime: 0
        };
      }
      packsMap[packId].levels.push(level);
    });

    Object.values(packsMap).forEach(pack => {
      pack.levels.forEach(level => {
        const lStats = stats.levels[level.id];
        if (lStats) {
          pack.completed += 1;
          pack.totalTime += lStats.bestTime;
        }
      });

      // Calculate pack overall rank if configured
      const packConfig = packOverallConfigs?.[pack.id];
      if (packConfig) {
        const isConfigured = Object.values(packConfig).some(r => r.timeCutoff > 0);
        if (isConfigured && pack.completed === pack.levels.length) {
          const safeRankOrder = Array.isArray(RANK_ORDER) ? RANK_ORDER : [];
          for (const rankId of safeRankOrder) {
            const rInfo = packConfig[rankId];
            if (rInfo && rInfo.timeCutoff > 0 && pack.totalTime <= rInfo.timeCutoff) {
              pack.overallRankId = rankId;
              break;
            }
          }
        }
      }
    });

    return Object.values(packsMap).sort((a, b) => {
      const idxA = packs.findIndex(p => p.id === a.id);
      const idxB = packs.findIndex(p => p.id === b.id);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return a.name.localeCompare(b.name);
    });
  }, [levels, stats, packs, packOverallConfigs]);

  const completedSortedLevels = useMemo(() => {
    const sortedLevels = [...levels].filter(l => stats.levels[l.id]);

    if (levelSort === 'easiest_to_improve') {
      const levelWithDiffs = sortedLevels.map(level => {
        const levelStats = stats.levels[level.id];
        const bestTime = levelStats?.bestTime || 0;
        
        // Find world record for this level
        const wrObj = worldRecords?.find(r => r.levelId === level.id);
        const wrTime = wrObj?.wr?.completion_time ?? bestTime;
        
        const timeDiff = bestTime - wrTime;
        const isWR = timeDiff <= 0.0001;

        return {
          level,
          timeDiff,
          isWR
        };
      });

      // Sort by timeDiff desc (larger diff means further away from WR, which is easiest to improve)
      // Absolute best runs (isWR is true) go to the bottom
      levelWithDiffs.sort((a, b) => {
        if (a.isWR && !b.isWR) return 1;
        if (!a.isWR && b.isWR) return -1;
        return b.timeDiff - a.timeDiff;
      });

      return levelWithDiffs.map(item => item.level);
    }

    sortedLevels.sort((a, b) => {
      const idxA = packs.findIndex(p => p.id === a.packId);
      const idxB = packs.findIndex(p => p.id === b.packId);
      if (idxA !== idxB) return idxA - idxB;
      return a.gameOrder - b.gameOrder;
    });
    return sortedLevels;
  }, [levels, stats.levels, packs, levelSort, worldRecords]);

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
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-[var(--app-accent)]/20 rounded-2xl flex items-center justify-center border border-[var(--app-accent)]/30 shadow-[0_0_30px_rgba(56,189,248,0.15)] overflow-hidden">
              <img 
                src="https://play.narrowarrow.xyz/assets/assets/images/account.svg" 
                alt="Account" 
                className="w-10 h-10 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-3xl font-bold text-white tracking-tight">{stats.username}</h2>
                {extraData?.league && (
                  <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2.5 py-1">
                    <img 
                      src={getLeagueIconUrl(extraData.league)} 
                      alt="" 
                      className="w-5 h-5 object-contain shrink-0"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                    <span className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                      {extraData.league}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-400">
                <Badge variant="outline" className="bg-[var(--app-accent)]/10 text-[var(--app-accent)] border-[var(--app-accent)]/20 py-0 px-1.5 text-[10px]">
                  Player Profile
                </Badge>
                {extraData?.user?.joined && (
                  <span className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
                    <Calendar className="w-3.5 h-3.5" /> Joined {new Date(extraData.user.joined).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                  </span>
                )}
              </div>
              {extraData?.user?.bio && (
                <p className="text-slate-300 text-xs md:text-sm mt-2 italic bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 max-w-md">
                  "{extraData.user.bio}"
                </p>
              )}
            </div>
          </div>
        </div>
        <Button 
          onClick={() => onCompare(stats.username)}
          className="bg-[var(--app-accent)] text-white hover:bg-[var(--app-accent)]/80 font-bold shadow-[0_0_15px_rgba(56,189,248,0.2)]"
        >
          <TrendingUp className="w-4 h-4 mr-2" />
          Compare Player
        </Button>
      </div>

      <ProfileIdentityCard
        username={stats.username}
        profile={profile}
        canEdit={canEditProfile}
        onSave={onSaveProfile}
        onRequestSignIn={onRequestSignIn}
        badges={
          <PlayerBadges
            username={stats.username}
            verified={profile?.verified}
            medals={computedMedals}
            officialCreators={officialCreators}
            summary={{
              username: stats.username,
              found: true,
              customCompleted: extraData?.custom_levels_completed ?? 0,
              customMedals: extraData?.custom_medals ?? {},
              officialMedals: extraData?.official_medals ?? {},
              packMedals: extraData?.pack_medals ?? {},
              mapsCompleted: extraData?.maps_completed ?? 0,
              totalRuns: extraData?.total_runs ?? 0,
              league: extraData?.league ?? null,
              trophies: extraData?.trophies ?? 0,
              levelsPublished: extraData?.creator?.levels_published ?? 0,
              totalLikes: extraData?.creator?.total_likes ?? 0,
              totalPlays: extraData?.creator?.total_plays ?? 0,
              joined: extraData?.user?.joined ?? null,
              bio: extraData?.user?.bio ?? null,
              dailyBestFinish: extraData?.daily_stats?.best_finish ?? null,
            }}
          />
        }
      />




      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
      {[
        { label: "Levels Completed", value: aggregateStats?.totalCompleted || 0, icon: Target, color: "text-[var(--app-accent)]" },
        { label: "Average Time", value: aggregateStats ? formatTime(aggregateStats.avgTime, 'seconds') : "N/A", icon: Clock, color: "text-[#2DD4BF]" },
        { label: "Total Time", value: aggregateStats ? formatTime(aggregateStats.totalTime, 'minutes') : "N/A", icon: Clock, color: "text-[#6366F1]" },
        { label: "Overall Rank", value: aggregateStats?.overallRankId ? (overallRankConfig[aggregateStats.overallRankId]?.name || aggregateStats.overallRankId) : "---", icon: Star, color: "text-yellow-400", isRank: true },
        { label: "Completion Rate", value: `${((aggregateStats?.totalCompleted || 0) / (levels.length || 1) * 100).toFixed(1)}%`, icon: Medal, color: "text-green-400" },
        { label: "World Records", value: computedMedals?.first ?? 0, icon: Trophy, color: "text-yellow-400" },
      ].map((stat, i) => (
          <Card key={i} className="bg-white/5 border-white/10 group hover:border-[var(--app-accent)]/30 transition-all duration-300">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{stat.label}</p>
                {stat.isRank && aggregateStats ? (
                  aggregateStats.overallRankId ? (
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "font-bold text-[10px] uppercase tracking-tighter px-2 py-0.5 mt-1",
                        overallRankConfig[aggregateStats.overallRankId]?.bgColor || "bg-white/5",
                        overallRankConfig[aggregateStats.overallRankId]?.color || "text-white",
                        overallRankConfig[aggregateStats.overallRankId]?.borderColor || "border-white/10"
                      )}
                    >
                      {stat.value}
                    </Badge>
                  ) : (
                    <div className="text-xl font-mono font-bold text-slate-500">---</div>
                  )
                ) : (
                  <div className="text-xl font-mono font-bold text-white">{stat.value}</div>
                )}
              </div>
              <stat.icon className={cn("w-8 h-8 opacity-10 group-hover:opacity-30 transition-opacity", stat.color)} />
            </CardContent>
          </Card>
        ))}
      </div>

      {loadingExtra && (
        <div className="space-y-4 animate-pulse">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-slate-500 pb-2 border-b border-white/10 flex items-center gap-2">
            <span className="w-1.5 h-3 bg-slate-600 rounded"></span>
            Loading Stats...
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-24 bg-white/5 rounded-xl border border-white/5"></div>
            ))}
          </div>
        </div>
      )}

      {extraData && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] border-b border-white/10 pb-2 flex items-center gap-2">
            <span className="w-1.5 h-3 bg-[var(--app-accent)] rounded"></span>
            Stats
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Trophies Card */}
            <Card className="bg-white/5 border-white/10 hover:border-amber-500/20 transition-all">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Trophy Rating</p>
                  <div className="text-2xl font-mono font-bold text-amber-400 flex items-baseline gap-1.5">
                    {extraData.trophies?.toLocaleString() ?? 0}
                    {extraData.max_trophies && (
                      <span className="text-xs text-slate-500 font-normal">/ {extraData.max_trophies} max</span>
                    )}
                  </div>
                  {extraData.trophy_percentile !== undefined && (
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-semibold">
                      <Crown className="w-3 h-3 text-amber-400" /> Top {extraData.trophy_percentile}% Percentile
                    </div>
                  )}
                </div>
                <img 
                  src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
                  alt="Trophy" 
                  className="w-10 h-10 object-contain opacity-25 shrink-0"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </CardContent>
            </Card>

            {/* Activity Card */}
            <Card className="bg-white/5 border-white/10 hover:border-blue-500/20 transition-all">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Total Runs</p>
                  <div className="text-2xl font-mono font-bold text-blue-400">
                    {extraData.total_runs?.toLocaleString() ?? 0}
                    <span className="text-xs text-slate-500 font-normal ml-1">runs</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-semibold">
                    <Activity className="w-3 h-3 text-blue-400" /> {extraData.cups_played?.toLocaleString() ?? 0} Cups Played
                  </div>
                </div>
                <Gamepad2 className="w-10 h-10 text-blue-500/25 shrink-0" />
              </CardContent>
            </Card>

            {/* Flight Time Card */}
            <Card className="bg-white/5 border-white/10 hover:border-emerald-500/20 transition-all">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Playtime</p>
                  <div className="text-2xl font-mono font-bold text-emerald-400">
                    {formatFlightTime(extraData.flight_time_seconds ?? 0)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-semibold">
                    <Clock className="w-3 h-3 text-emerald-400" /> {extraData.custom_levels_completed ?? 0} Customs Completed
                  </div>
                </div>
                <Flame className="w-10 h-10 text-emerald-500/25 shrink-0" />
              </CardContent>
            </Card>

            {/* Streaks Card */}
            <Card className="bg-white/5 border-white/10 hover:border-violet-500/20 transition-all">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Win Streaks</p>
                  <div className="text-2xl font-mono font-bold text-violet-400">
                    {extraData.win_streak ?? 0}
                    <span className="text-xs text-slate-500 font-normal ml-1">current</span>
                  </div>
                  {extraData.max_win_streak !== undefined && (
                    <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-semibold">
                      <Zap className="w-3 h-3 text-violet-400" /> {extraData.max_win_streak} Max Win Streak
                    </div>
                  )}
                </div>
                <Award className="w-10 h-10 text-violet-500/25 shrink-0" />
              </CardContent>
            </Card>
          </div>

          {/* Medal Case */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Official Medals */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h4 className="text-xs font-extrabold text-[var(--app-accent)] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Medal className="w-4 h-4 text-amber-400" /> Official Medals
              </h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-black/30 rounded-lg p-2 text-center border border-yellow-500/10">
                  <div className="w-6 h-6 rounded-full bg-yellow-400 text-black flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">1st</div>
                  <div className="text-lg font-mono font-bold text-yellow-400 mt-1">{computedMedals?.first ?? extraData.official_medals?.first ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2 text-center border border-slate-400/10">
                  <div className="w-6 h-6 rounded-full bg-slate-300 text-black flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">2nd</div>
                  <div className="text-lg font-mono font-bold text-slate-300 mt-1">{computedMedals?.second ?? extraData.official_medals?.second ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2 text-center border border-amber-600/10">
                  <div className="w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">3rd</div>
                  <div className="text-lg font-mono font-bold text-amber-500 mt-1">{computedMedals?.third ?? extraData.official_medals?.third ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2 text-center border border-blue-400/10">
                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">T10</div>
                  <div className="text-lg font-mono font-bold text-blue-400 mt-1">{computedMedals?.top10 ?? extraData.official_medals?.top10 ?? 0}</div>
                </div>
              </div>
            </div>

            {/* Custom Medals */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <h4 className="text-xs font-extrabold text-[#2DD4BF] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-[#2DD4BF]" /> Custom Medals
              </h4>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-black/30 rounded-lg p-2 text-center border border-yellow-500/10">
                  <div className="w-6 h-6 rounded-full bg-yellow-400 text-black flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">1st</div>
                  <div className="text-lg font-mono font-bold text-yellow-400 mt-1">{extraData.custom_medals?.first ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2 text-center border border-slate-400/10">
                  <div className="w-6 h-6 rounded-full bg-slate-300 text-black flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">2nd</div>
                  <div className="text-lg font-mono font-bold text-slate-300 mt-1">{extraData.custom_medals?.second ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2 text-center border border-amber-600/10">
                  <div className="w-6 h-6 rounded-full bg-amber-600 text-white flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">3rd</div>
                  <div className="text-lg font-mono font-bold text-amber-500 mt-1">{extraData.custom_medals?.third ?? 0}</div>
                </div>
                <div className="bg-black/30 rounded-lg p-2 text-center border border-blue-400/10">
                  <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center mx-auto text-[10px] font-extrabold shadow-lg">T10</div>
                  <div className="text-lg font-mono font-bold text-blue-400 mt-1">{extraData.custom_medals?.top10 ?? 0}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab Selectors if they are a creator */}
      {extraData?.creator && extraData.creator.levels_published > 0 && (
        <div className="flex border-b border-white/10 gap-2 mt-8">
          <button
            onClick={() => setProfileTab('performance')}
            className={cn(
              "px-4 py-2.5 text-xs uppercase tracking-wider font-extrabold border-b-2 transition-all duration-300",
              profileTab === 'performance' 
                ? "border-[var(--app-accent)] text-white bg-white/5" 
                : "border-transparent text-slate-400 hover:text-white"
            )}
          >
            Map Performance
          </button>
          <button
            onClick={() => setProfileTab('creator')}
            className={cn(
              "px-4 py-2.5 text-xs uppercase tracking-wider font-extrabold border-b-2 transition-all duration-300 flex items-center gap-2",
              profileTab === 'creator' 
                ? "border-teal-400 text-teal-300 bg-teal-500/5" 
                : "border-transparent text-slate-400 hover:text-white"
            )}
          >
            <Star className="w-3.5 h-3.5" /> Published Levels ({extraData.creator.levels_published})
          </button>
        </div>
      )}

      {profileTab === 'performance' ? (
        <>
          {/* Map Pack Breakdown section */}
          <div className="space-y-4">
            <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] border-b border-white/10 pb-2 flex items-center gap-2">
              <span className="w-1.5 h-3 bg-[var(--app-accent)] rounded"></span>
              Map Pack Performance
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {packBreakdowns.map(pb => (
                <Card key={pb.id} className="bg-white/5 border-white/10 hover:border-[var(--app-accent)]/20 transition-all">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-white uppercase tracking-wider">{pb.name}</span>
                      <div className="flex items-center gap-1.5">
                        {pb.overallRankId && (
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "font-extrabold text-[8px] uppercase tracking-tighter px-1.5 py-0.5",
                              packOverallConfigs?.[pb.id]?.[pb.overallRankId]?.bgColor || "bg-white/5",
                              packOverallConfigs?.[pb.id]?.[pb.overallRankId]?.color || "text-white",
                              packOverallConfigs?.[pb.id]?.[pb.overallRankId]?.borderColor || "border-white/10"
                            )}
                          >
                            {packOverallConfigs?.[pb.id]?.[pb.overallRankId]?.name || pb.overallRankId}
                          </Badge>
                        )}
                        <Badge className="bg-white/5 text-slate-300 border-white/10 text-[9px] font-mono">
                          {pb.completed} / {pb.levels.length}
                        </Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5">
                      <div className="space-y-0.5">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Total Time</div>
                        <div className="text-xs font-mono font-bold text-[#6366F1]">
                          {pb.completed > 0 ? formatTime(pb.totalTime, 'seconds') : "---"}
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="text-[9px] text-slate-500 uppercase tracking-wider font-bold">Avg Time</div>
                        <div className="text-xs font-mono font-bold text-[#2DD4BF]">
                          {pb.completed > 0 ? formatTime(pb.totalTime / pb.completed, 'seconds') : "---"}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Level Performance Table */}
          <Card className="bg-white/5 border-white/10 overflow-hidden">
            <CardHeader className="border-b border-white/10 bg-white/[0.02] flex flex-row items-center justify-between py-3">
              <CardTitle className="text-lg font-bold text-white">Level Performance</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider inline">Sort:</span>
                <Select value={levelSort} onValueChange={(val: any) => setLevelSort(val)}>
                  <SelectTrigger className="bg-black/40 border-white/10 h-8 text-xs text-white w-44">
                    <SelectValue placeholder="Sort order" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 text-xs">
                    <SelectItem value="default" className="cursor-pointer">Default</SelectItem>
                    <SelectItem value="easiest_to_improve" className="cursor-pointer">Easiest To Improve</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/[0.02]">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Level</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Rank</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Best Time</TableHead>
                      {levelSort === 'easiest_to_improve' && (
                        <TableHead className="font-mono text-[10px] uppercase tracking-widest text-[var(--app-accent)] font-bold">To World Record</TableHead>
                      )}
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500 text-center">Arrow</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500 text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedSortedLevels.map((level) => {
                      const levelStats = stats.levels[level.id];
                      
                      // Resolve rank info with proper fallback and merging
                      const config = rankConfigs[level.id];
                      const levelRanks = config?.ranks || getLevelDefaultRanks(level.id, globalRankConfig);
                      
                      const merged: Record<string, RankInfo> = {};
                      const safeRankOrder = Array.isArray(RANK_ORDER) ? RANK_ORDER : [];
                      safeRankOrder.forEach(id => {
                        const gRank = globalRankConfig[id] || DEFAULT_RANKS[id];
                        const lRank = levelRanks[id];
                        
                        // Robustly get time cutoff (handle legacy number-only format)
                        let timeCutoff: number;
                        if (typeof lRank === 'number') {
                          timeCutoff = lRank;
                        } else if (lRank && typeof lRank.timeCutoff === 'number') {
                          timeCutoff = lRank.timeCutoff;
                        } else {
                          timeCutoff = gRank.timeCutoff;
                        }

                        merged[id] = {
                          ...gRank,
                          timeCutoff
                        };
                      });

                      const rankInfo = merged[levelStats.rankId] || DEFAULT_RANKS[levelStats.rankId] || DEFAULT_RANKS["Beginner"];

                      return (
                        <React.Fragment key={level.id}>
                        <motion.tr 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          onClick={() => setExpandedLevel(expandedLevel === level.id ? null : level.id)}
                          className="border-white/5 hover:bg-white/[0.03] transition-colors group cursor-pointer"
                        >
                          <TableCell 
                            className="font-medium text-slate-200 group-hover:text-[var(--app-accent)] cursor-pointer transition-colors"
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
                                    id={`play-btn-profile-${level.id}`}
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
                          <TableCell>
                            {levelStats.rankId ? (
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "font-bold text-[10px] uppercase tracking-tighter px-2 py-0.5",
                                  rankInfo.bgColor,
                                  rankInfo.color,
                                  rankInfo.borderColor
                                )}
                              >
                                {rankInfo.name}
                              </Badge>
                            ) : (
                              <span className="text-slate-500 font-mono text-xs">---</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono font-bold text-[#2DD4BF]">
                            {formatTime(levelStats.bestTime, 'seconds')}
                          </TableCell>
                          {levelSort === 'easiest_to_improve' && (
                            <TableCell className="font-mono py-1.5">
                              {(() => {
                                const bestTime = levelStats.bestTime;
                                const wrObj = worldRecords?.find(r => r.levelId === level.id);
                                const wrTime = wrObj?.wr?.completion_time;

                                if (wrTime === undefined) {
                                  return <span className="text-slate-500 font-mono text-xs">---</span>;
                                }

                                const diff = bestTime - wrTime;

                                if (diff <= 0.0001) {
                                  return (
                                    <span className="text-amber-400 font-bold uppercase tracking-tight text-[10px] bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded inline-block w-fit">
                                      ★ World Record
                                    </span>
                                  );
                                }

                                return (
                                  <div className="flex flex-col">
                                    <span className="text-emerald-400 font-bold text-xs font-mono">
                                      -{diff.toFixed(3)}s
                                    </span>
                                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter px-1.5 py-0.5 mt-0.5 rounded border border-white/5 bg-white/5 inline-block w-fit">
                                      to WR ({wrTime.toFixed(3)}s)
                                    </span>
                                  </div>
                                );
                              })()}
                            </TableCell>
                          )}
                          <TableCell className="text-center">
                            <ArrowIcon name={levelStats.arrowName} className={cn(
                              "w-5 h-5",
                              levelStats.arrowName.toLowerCase().includes("energy") ? "text-[#22c55e]" :
                              levelStats.arrowName.toLowerCase().includes("speedy") ? "text-[#3b82f6]" :
                              "text-[var(--app-accent)]"
                            )} />
                          </TableCell>
                          <TableCell className="text-right text-slate-500 text-xs font-mono">
                            {new Date(levelStats.date).toLocaleDateString()}
                          </TableCell>
                        </motion.tr>
                        {expandedLevel === level.id && (
                          <LevelHistoryDetail
                            levelId={level.id}
                            username={stats.username}
                            bestTime={levelStats.bestTime}
                            bestDate={levelStats.date}
                            standings={levelStandings?.[level.id]}
                            legacyRuns={legacyRuns}
                            colSpan={levelSort === 'easiest_to_improve' ? 6 : 5}
                          />
                        )}
                        </React.Fragment>
                      );

                    })}
                    {Object.keys(stats.levels).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={levelSort === 'easiest_to_improve' ? 6 : 5} className="h-32 text-center text-slate-500 italic">
                          No records found for this player.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : extraData?.creator ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Creator stats overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="bg-teal-500/5 border-teal-500/20">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-teal-400/70 font-bold mb-1">Levels Designed</p>
                  <div className="text-2xl font-mono font-bold text-teal-300">{extraData.creator.levels_published}</div>
                </div>
                <Star className="w-8 h-8 text-teal-400/20" />
              </CardContent>
            </Card>
            <Card className="bg-emerald-500/5 border-emerald-500/20">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-emerald-400/70 font-bold mb-1">Total Plays</p>
                  <div className="text-2xl font-mono font-bold text-emerald-300">
                    {extraData.creator.total_plays?.toLocaleString() ?? 0}
                  </div>
                </div>
                <Gamepad2 className="w-8 h-8 text-emerald-400/20" />
              </CardContent>
            </Card>
            <Card className="bg-amber-500/5 border-amber-500/20">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-amber-400/70 font-bold mb-1">Total Likes</p>
                  <div className="text-2xl font-mono font-bold text-amber-300">
                    ♥ {extraData.creator.total_likes?.toLocaleString() ?? 0}
                  </div>
                </div>
                <img 
                  src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
                  alt="Trophy" 
                  className="w-8 h-8 object-contain opacity-20 shrink-0"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Creator Levels List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="text-sm font-extrabold uppercase tracking-widest text-[#2DD4BF] flex items-center gap-2">
                <span className="w-1.5 h-3 bg-[#2DD4BF] rounded"></span>
                Levels Designed by {stats.username}
              </h3>
              
              {/* Popular / New Sub-Tab Switcher */}
              <div className="flex bg-white/5 p-1 rounded-lg border border-white/10 shrink-0">
                <button
                  onClick={() => setCreatorLevelsFilter('popular')}
                  className={cn(
                    "px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all duration-200",
                    creatorLevelsFilter === 'popular'
                      ? "bg-teal-500 text-slate-950 font-black shadow"
                      : "text-slate-400 hover:text-white"
                  )}
                >
                  Most Popular
                </button>
                <button
                  onClick={() => setCreatorLevelsFilter('new')}
                  className={cn(
                    "px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all duration-200",
                    creatorLevelsFilter === 'new'
                      ? "bg-teal-500 text-slate-950 font-black shadow"
                      : "text-slate-400 hover:text-white"
                  )}
                >
                  Newest
                </button>
              </div>
            </div>

            {loadingCreatorLevels ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4 bg-white/[0.02] border border-white/5 rounded-xl">
                <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
                <p className="text-slate-400 font-mono text-xs animate-pulse">Loading creator levels...</p>
              </div>
            ) : creatorLevels.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {creatorLevels.map((level, idx) => {
                  const levelId = level.level_id || level.id || level.levelKey || level.levelId || "";
                  if (!levelId) return null;
                  const levelName = level.name || level.title || level.data?.map_name || level.data?.name || `Level ${levelId}`;
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
                      <Card className="h-full bg-white/5 border-white/10 hover:border-teal-400/40 transition-all duration-300 flex flex-col overflow-hidden group">
                        {/* Level image preview */}
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
                            <Badge className="bg-black/60 text-slate-300 border-white/10 font-mono text-[10px] uppercase">
                              {levelId}
                            </Badge>
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
                            <h4 className="text-base font-bold text-slate-100 group-hover:text-teal-400 transition-colors line-clamp-1">
                              {levelName}
                            </h4>
                            <p className="text-slate-400 text-xs mt-1 font-medium">
                              by <span className="text-teal-400">{stats.username}</span>
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
                            <div className="flex items-center justify-between text-[11px] bg-teal-400/5 border border-teal-400/10 rounded-lg px-2.5 py-1.5">
                              <span className="text-slate-400 flex items-center gap-1 font-semibold">
                                <Trophy className="w-3.5 h-3.5 text-amber-400" /> WR:
                              </span>
                              <span className="font-mono text-teal-400 font-bold">
                                {worldRecord.completion_time.toFixed(3)}s
                              </span>
                            </div>
                          )}

                          {/* Action buttons */}
                          <div className="grid grid-cols-2 gap-2 pt-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onLevelClick(levelId)}
                              className="border-white/10 hover:bg-teal-400 hover:text-slate-950 hover:border-transparent text-xs font-bold"
                            >
                              Leaderboard
                            </Button>
                            <a
                              href={`https://narrowarrow.xyz/levelid=${levelId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold text-xs rounded-lg transition-all duration-300 shadow-[0_0_10px_rgba(16,185,129,0.3)] text-center"
                            >
                              <Play className="w-3 h-3 fill-current text-slate-950" /> Play <ArrowRight className="w-3 h-3 text-slate-950" />
                            </a>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 space-y-4 bg-white/[0.02] border border-white/5 rounded-xl text-center">
                <Star className="w-8 h-8 text-slate-600" />
                <p className="text-slate-400 font-mono text-xs">No levels found with this filter.</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-slate-500 font-mono text-xs">
          Loading creator stats...
        </div>
      )}
    </div>
  );
}
