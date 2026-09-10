/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Search, 
  Trophy, 
  ChevronDown, 
  ArrowUpDown, 
  Clock, 
  User, 
  Target,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Settings,
  Palette,
  LayoutDashboard,
  Users,
  TrendingUp,
  ArrowLeft,
  Globe,
  Filter,
  CheckCircle2,
  XCircle,
  Timer,
  ListOrdered,
  Medal,
  History,
  Star,
  Dices,
  Info,
  Play,
  X,
  Download,
  UserRound,
  Sparkles

} from "lucide-react";
import { doc, onSnapshot, collection, getDocs, setDoc, db, OperationType, handleFirestoreError } from "./lib/cloud-db";
import { ClickToCopy } from "./components/ClickToCopy";
import { NarrowScoreView } from "./components/NarrowScoreView";
import { CustomCompletionsView } from "./components/CustomCompletionsView";
import { RankPointsView } from "./components/RankPointsView";
import { PlayerVotingView } from "./components/PlayerVotingView";
import { LevelRatingView } from "./components/LevelRatingView";
import { PositionPointsView } from "./components/PositionPointsView";
import { LevelInsightsView } from "./components/LevelInsightsView";
import { RivalriesView } from "./components/RivalriesView";
import { HallOfFameView } from "./components/HallOfFameView";
import { ImprovementTargetsView } from "./components/ImprovementTargetsView";
import { MilestoneClubsView } from "./components/MilestoneClubsView";
import { RecordTracker } from "./components/RecordTracker";
import { CommandPalette } from "./components/CommandPalette";
import { ProfileHub } from "./components/ProfileHub";
import { usePlayerProfiles } from "./hooks/usePlayerProfiles";

import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import { LeaderboardEntry, LevelInfo, LevelPack, RankInfo, LevelRankConfig, PlayerStats, PlayerLevelStats, LegacyRun } from "./types";
import { 
  LEVELS, 
  DEFAULT_RANKS, 
  RANK_ORDER, 
  DEFAULT_OVERALL_RANKS,
  THEORETICAL_MAX_DEFAULTS,
  HUMAN_LIMIT_DEFAULTS,
  LEVEL_PACKS
} from "./constants";
import {
  fetchLeaderboard,
  runWithConcurrency,
  fetchAllLeaderboards,
  persistLeaderboards,
  hydratePersistedLeaderboards,
} from "./services/api";

import { assignRank } from "./lib/ranking";
import { cn, capitalizeName } from "@/lib/utils";
import { AdminPanel } from "./components/AdminPanel";
import { ArrowIcon } from "./components/ArrowIcon";
import { PlayerProfile } from "./components/PlayerProfile";
import { ComparePlayers } from "./components/ComparePlayers";
import { RandomLevelSelector } from "./components/RandomLevelSelector";
import { CustomsView } from "./components/CustomsView";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { useRemovedRuns, removeRun } from "./hooks/useRemovedRuns";
import { removedRunKey } from "./lib/removedRuns";
import { computeMedals } from "./lib/medals";
import { useAppSettings } from "./hooks/useAppSettings";
import { SettingsPanel } from "./components/SettingsPanel";
import { toast } from "sonner";
import { ArrowRecordsView } from "@/components/ArrowRecordsView";

export default function App() {
  const { isAdmin, user: adminUser } = useAdminAuth();
  const { removedKeys } = useRemovedRuns();
  const [dynamicPacks, setDynamicPacks] = useState<LevelPack[]>(LEVEL_PACKS);
  const [dynamicLevels, setDynamicLevels] = useState<LevelInfo[]>(LEVELS);
  const [selectedLevel, setSelectedLevel] = useState<string>(LEVELS[0]?.id || "");
  const [selectedPack, setSelectedPack] = useState<string>("all");
  const [selectedAveragePack, setSelectedAveragePack] = useState<string>("all");
  const [averageSearchQuery, setAverageSearchQuery] = useState<string>("");

  const [selectedCustomLevelId, setSelectedCustomLevelId] = useState<string | null>(null);
  const [fetchedLevelDetails, setFetchedLevelDetails] = useState<Record<string, { name: string; author?: string; packId?: string }>>({});
  const [legacyRuns, setLegacyRuns] = useState<LegacyRun[]>([]);
  const [nameChanges, setNameChanges] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "legacyRuns"), (snapshot) => {
      const runs: LegacyRun[] = [];
      snapshot.forEach(doc => {
        runs.push({ id: doc.id, ...doc.data() } as LegacyRun);
      });
      setLegacyRuns(runs);
    }, (err) => {
      console.error("Error loading legacy runs:", err);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "nameChanges"), (snapshot) => {
      const changes: any[] = [];
      snapshot.forEach(doc => {
        changes.push({ id: doc.id, ...doc.data() });
      });
      setNameChanges(changes);
    }, (err) => {
      console.error("Error loading name changes:", err);
    });
    return unsub;
  }, []);

  const mappedLegacyRuns = useMemo(() => {
    return legacyRuns.map(run => {
      let currentUsername = run.username;
      let changed = true;
      let limit = 0;
      while (changed && limit < 10) {
        changed = false;
        const mapping = nameChanges.find(nc => nc.oldName.toLowerCase() === currentUsername.toLowerCase());
        if (mapping) {
          currentUsername = mapping.newName;
          changed = true;
          limit++;
        }
      }
      return {
        ...run,
        username: currentUsername
      };
    });
  }, [legacyRuns, nameChanges]);

  // Manually added levels (admin > Levels) merge in alongside the API packs.
  const allLevelsWithCustoms = useMemo(() => {
    if (!extraLevels.length) return dynamicLevels;
    const merged = [...dynamicLevels];
    extraLevels.forEach(l => {
      if (!merged.some(existing => existing.id.toLowerCase() === l.id.toLowerCase())) merged.push(l);
    });
    return merged;
  }, [dynamicLevels, extraLevels]);

  const dynamicPacksWithCustom = dynamicPacks;

  const handleLevelClick = async (levelId: string) => {
    if (!levelId) return;
    const isMapPack = dynamicLevels.some(l => l.id.toLowerCase() === levelId.toLowerCase());
    if (isMapPack) {
      const item = dynamicLevels.find(l => l.id.toLowerCase() === levelId.toLowerCase());
      if (item) {
        setSelectedPack(item.packId);
        setSelectedLevel(item.id);
      } else {
        setSelectedLevel(levelId);
      }
      setView('leaderboard');
    } else {
      setSelectedCustomLevelId(levelId);
      setView('customs');
    }
  };

  // Fetch dynamic map packs and levels from API on mount
  useEffect(() => {
    let isMounted = true;
    const loadPacksAndLevels = async () => {
      try {
        const res = await fetch("/api/packs");
        if (!res.ok) {
          throw new Error(`Failed to fetch packs: ${res.status}`);
        }
        const packsData = await res.json();
        
        const mappedPacks: LevelPack[] = packsData.map((p: any) => ({
          id: p.slug,
          name: capitalizeName(p.name)
        }));
        
        if (isMounted && mappedPacks.length >= LEVEL_PACKS.length) {
          setDynamicPacks(mappedPacks);
        }

        const packPositions: Record<string, number> = {};
        packsData.forEach((p: any) => {
          packPositions[p.slug] = p.position !== undefined ? p.position : 99;
        });

        const allLevels: LevelInfo[] = [];
        const publishLevels = () => {
          const sourceLevels = allLevels.length >= LEVELS.length ? allLevels : LEVELS;
          const sorted = [...sourceLevels].sort((a, b) => {
            const packDiff = (packPositions[a.packId] || 0) - (packPositions[b.packId] || 0);
            if (packDiff !== 0) return packDiff;
            return a.gameOrder - b.gameOrder;
          });

          if (isMounted) {
            setDynamicLevels(sorted);
            setSelectedLevel(prev => prev || sorted[0]?.id || "");
          }
        };

        const sortedPacksData = [...packsData].sort((a: any, b: any) => {
          const posA = a.position !== undefined ? a.position : 99;
          const posB = b.position !== undefined ? b.position : 99;
          return posA - posB;
        });

        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

        // Upstream rate-limits bursts, so each pack gets its own retry loop.
        const fetchPackDetails = async (slug: string) => {
          let lastStatus = 0;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const res = await fetch(`/api/packs/${slug}`);
              if (res.ok) return await res.json();
              lastStatus = res.status;
              if (res.status !== 502 && res.status !== 429 && res.status < 500) break;
            } catch {
              // network hiccup — retry
            }
            await wait(600 * 2 ** attempt + Math.random() * 300);
          }
          throw new Error(`Failed to fetch pack details: ${lastStatus}`);
        };

        const addPackLevels = (slug: string, details: any) => {
          const packLevels = details?.levels || [];
          packLevels.forEach((l: any) => {
            const id = l.level_id || String(l.id);
            if (allLevels.some(existing => existing.id === id)) return;
            allLevels.push({
              id,
              name: capitalizeName(l.name),
              packId: slug,
              gameOrder: l.position !== undefined ? l.position : 0
            });
          });
          publishLevels();
        };

        // Load pack details one at a time and publish after each pack so the UI
        // never sits with an empty level selector while later packs are pending.
        const failedPacks: string[] = [];
        for (const p of sortedPacksData) {
          if (!isMounted) return;
          try {
            addPackLevels(p.slug, await fetchPackDetails(p.slug));
          } catch (e) {
            console.warn(`Pack ${p.slug} failed on first pass, will retry:`, e);
            failedPacks.push(p.slug);
          }
        }

        // Second sweep after the burst has cooled down so no pack is dropped.
        for (const slug of failedPacks) {
          if (!isMounted) return;
          await wait(1500);
          try {
            addPackLevels(slug, await fetchPackDetails(slug));
          } catch (e) {
            console.error(`Failed to fetch pack details for ${slug}:`, e);
          }
        }

      } catch (err) {
        console.error("Error loading packs and levels from API:", err);
      }
    };

    loadPacksAndLevels();
    return () => {
      isMounted = false;
    };
  }, []);
  const [data, setData] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [arrowFilter, setArrowFilter] = useState<"all" | "Narrow Arrow" | "Speedy Arrow" | "Energy Arrow">("all");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileHub, setShowProfileHub] = useState(false);
  const { settings, update: updateSetting, reset: resetSettings } = useAppSettings();
  const { byUsername: playerProfiles, reload: reloadProfiles, myProfile: myLinkedProfile, saveMyProfile } = usePlayerProfiles(adminUser?.id);


  const [view, setView] = useState<'leaderboard' | 'profile' | 'compare' | 'average' | 'wrs' | 'random' | 'customs' | 'score' | 'completions' | 'tracker' | 'points' | 'voting' | 'rating' | 'position' | 'insights' | 'rivalries' | 'fame' | 'targets' | 'clubs'>('leaderboard');
  const [showRankLegend, setShowRankLegend] = useState(false);
  const [wrsTab, setWrsTab] = useState<'wrs' | 'hof' | 'history' | 'arrows'>('wrs');
  const [randomLevelSuggestion, setRandomLevelSuggestion] = useState<LevelInfo | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [player2ToCompare, setPlayer2ToCompare] = useState<string | null>(null);
  const [allLevelsData, setAllLevelsData] = useState<Record<string, LeaderboardEntry[]>>(
    () => hydratePersistedLeaderboards(),
  );

  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const [leaderboardLoadStatus, setLeaderboardLoadStatus] = useState({ loaded: 0, total: LEVELS.length, failed: 0 });
  const allLeaderboardFetchId = React.useRef(0);
  const [allRankConfigs, setAllRankConfigs] = useState<Record<string, LevelRankConfig>>({});
  const [globalRankConfig, setGlobalRankConfig] = useState<Record<string, RankInfo>>(DEFAULT_RANKS);
  const [activeLevelData, setActiveLevelData] = useState<LevelRankConfig | null>(null);
  const [theoreticalMax, setTheoreticalMax] = useState<number | null>(null);
  const [humanLimit, setHumanLimit] = useState<number | null>(null);
  const [overallRankConfig, setOverallRankConfig] = useState<Record<string, RankInfo>>(DEFAULT_OVERALL_RANKS);
  const [allPackOverallConfigs, setAllPackOverallConfigs] = useState<Record<string, Record<string, RankInfo>>>({});
  const [allMapsPlayedFilter, setAllMapsPlayedFilter] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof LeaderboardEntry | 'rank', direction: 'asc' | 'desc' }>({
    key: 'completion_time',
    direction: 'asc'
  });

  const formatTime = (seconds: number, forceMode?: 'seconds' | 'minutes') => {
    const mode = forceMode || settings.timeFormat;
    if (mode === 'seconds') {
      return `${seconds.toFixed(3)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(3);
    return `${mins}:${secs.padStart(6, '0')}m`;
  };

  const fetchData = async (levelId: string, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      // deep = merge every arrow board so players beyond the top 150 appear.
      const result = await fetchLeaderboard(levelId, forceRefresh, true);

      setData(result);
      
      // Also fetch details from the API if we don't already have them, or on forceRefresh
      if (forceRefresh || !fetchedLevelDetails[levelId]) {
        try {
          const detailRes = await fetch(`/api/level-details/${encodeURIComponent(levelId)}`);
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            const resolvedName = detailData.name || detailData.level?.name || detailData.title || detailData.level?.title || detailData.data?.map_name || detailData.data?.name || `Level ${levelId}`;
            const resolvedAuthor = detailData.creator_name || detailData.level?.creator_name || detailData.author || detailData.level?.author || detailData.username || detailData.level?.username || detailData.creator?.username || "Unknown";
            setFetchedLevelDetails(prev => ({
              ...prev,
              [levelId]: {
                name: resolvedName,
                author: resolvedAuthor,
                packId: detailData.packId || detailData.level?.packId || ""
              }
            }));
          }
        } catch (err) {
          console.error("Error fetching level details for leaderboard:", err);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Fetch API level details/leaderboard when selectedLevel changes
  useEffect(() => {
    if (!selectedLevel) {
      setLoading(false);
      return;
    }
    fetchData(selectedLevel);
  }, [selectedLevel]);

  // Listen for static/global configs once on mount
  useEffect(() => {
    // Listen for ALL rank configs for profiles
    const configsRef = collection(db, "levelConfigs");
    const unsubConfigs = onSnapshot(configsRef, (snap) => {
      const configs: Record<string, LevelRankConfig> = {};
      snap.forEach(doc => {
        configs[doc.id] = doc.data() as LevelRankConfig;
      });
      setAllRankConfigs(configs);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, "levelConfigs");
    });

    // Listen for configs collection (global ranks, overall, and pack-specific overall)
    const configsColRef = collection(db, "configs");
    const unsubConfigsCol = onSnapshot(configsColRef, (snapshot) => {
      let gRanks = DEFAULT_RANKS;
      let oRanks = DEFAULT_OVERALL_RANKS;
      const packOverall: Record<string, Record<string, RankInfo>> = {};

      snapshot.forEach(doc => {
        const data = doc.data() as LevelRankConfig;
        if (doc.id === "ranks") {
          gRanks = data.ranks || DEFAULT_RANKS;
        } else if (doc.id === "overallRanks") {
          oRanks = data.ranks || DEFAULT_OVERALL_RANKS;
        } else if (doc.id.startsWith("overallRanks_")) {
          const packId = doc.id.substring("overallRanks_".length);
          if (data.ranks) {
            packOverall[packId] = data.ranks;
          }
        }
      });

      setGlobalRankConfig(gRanks);
      setOverallRankConfig(oRanks);
      setAllPackOverallConfigs(packOverall);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, "configs");
    });

    return () => {
      unsubConfigsCol();
      unsubConfigs();
    };
  }, []);

  // Listen to the specific active level config when selectedLevel changes
  useEffect(() => {
    if (!selectedLevel) {
      setActiveLevelData(null);
      setTheoreticalMax(null);
      setHumanLimit(null);
      return;
    }

    const levelRef = doc(db, "levelConfigs", selectedLevel);
    const unsubscribe = onSnapshot(levelRef, (levelSnap) => {
      const levelData = levelSnap.exists() ? (levelSnap.data() as LevelRankConfig) : null;
      setActiveLevelData(levelData);
      setTheoreticalMax(levelData?.theoreticalMax ?? null);
      setHumanLimit(levelData?.humanLimit ?? null);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `levelConfigs/${selectedLevel}`);
    });

    return () => {
      unsubscribe();
    };
  }, [selectedLevel]);

  // Rank cutoffs follow the selected arrow board when per-arrow times exist.
  const hasLevelRanks = React.useMemo(
    () => !!(activeLevelData?.ranks && Object.keys(activeLevelData.ranks).length > 0),
    [activeLevelData],
  );

  const usingArrowRanks = React.useMemo(
    () =>
      arrowFilter !== "all" &&
      !!activeLevelData?.arrowRanks?.[arrowFilter] &&
      Object.values(activeLevelData.arrowRanks[arrowFilter] || {}).some((v) => Number(v) > 0),
    [activeLevelData, arrowFilter],
  );

  const activeRankConfig = React.useMemo(() => {
    const levelRanks = activeLevelData?.ranks || {};
    const arrowOverrides =
      arrowFilter !== "all" ? activeLevelData?.arrowRanks?.[arrowFilter] || {} : {};
    const merged: Record<string, RankInfo> = {};
    const safeRankOrder = Array.isArray(RANK_ORDER) ? RANK_ORDER : [];
    safeRankOrder.forEach(id => {
      const gRank = globalRankConfig[id] || DEFAULT_RANKS[id];
      const override = Number(arrowOverrides[id] ?? 0);
      merged[id] = {
        ...gRank,
        timeCutoff: override > 0
          ? override
          : (hasLevelRanks ? (levelRanks[id]?.timeCutoff ?? 0) : 0),
      };
    });
    return merged;
  }, [activeLevelData, globalRankConfig, arrowFilter, hasLevelRanks]);


  const fetchAllLevels = async (forceRefresh = false) => {
    const levelsToFetch = dynamicLevels.length >= LEVELS.length ? dynamicLevels : LEVELS;
    const existingLoaded = levelsToFetch.filter(l => allLevelsData[l.id]?.length > 0).length;
    if (!forceRefresh && existingLoaded === levelsToFetch.length) {
      setLeaderboardLoadStatus({ loaded: existingLoaded, total: levelsToFetch.length, failed: 0 });
      return;
    }

    const requestId = ++allLeaderboardFetchId.current;
    setIsFetchingAll(true);
    setLeaderboardLoadStatus({ loaded: existingLoaded, total: levelsToFetch.length, failed: 0 });
    try {
      const newData: Record<string, LeaderboardEntry[]> = { ...allLevelsData };

      // One warmed bulk request covers every official board in a single trip.
      try {
        const bulk = await fetchAllLeaderboards(true);
        for (const [id, entries] of Object.entries(bulk)) {
          if (entries?.length) newData[id] = entries;
        }
        if (requestId === allLeaderboardFetchId.current) {
          setAllLevelsData({ ...newData });
          persistLeaderboards(newData);
        }
      } catch (error) {
        console.error("bulk leaderboard fetch failed, falling back", error);
      }

      let pending = levelsToFetch.filter(l => !newData[l.id] || newData[l.id].length === 0);

      for (let attempt = 0; attempt < 4 && pending.length > 0; attempt++) {
        if (attempt > 0) {
          await new Promise(r => setTimeout(r, 900 * attempt));
        }


        const results = await runWithConcurrency(
          pending.map((level) => async () => {
            try {
              return { level, entries: await fetchLeaderboard(level.id, forceRefresh && attempt === 0, true) };
            } catch (error) {
              console.error(`Failed to fetch leaderboard for level ${level.id}:`, error);
              return { level, entries: null as LeaderboardEntry[] | null };
            }
          }),
          2,
        );

        results.forEach(({ level, entries }) => {
          if (entries && entries.length > 0) {
            newData[level.id] = entries;
          }
        });

        pending = pending.filter(level => !newData[level.id] || newData[level.id].length === 0);
        if (requestId === allLeaderboardFetchId.current) {
          setAllLevelsData({ ...newData });
          setLeaderboardLoadStatus({
            loaded: levelsToFetch.length - pending.length,
            total: levelsToFetch.length,
            failed: pending.length,
          });
        }
      }

      if (requestId !== allLeaderboardFetchId.current) return;
      setAllLevelsData({ ...newData });
      persistLeaderboards(newData);
      setLeaderboardLoadStatus({
        loaded: levelsToFetch.filter(l => newData[l.id]?.length > 0).length,
        total: levelsToFetch.length,
        failed: levelsToFetch.filter(l => !newData[l.id] || newData[l.id].length === 0).length,
      });

    } catch (err) {
      console.error("Failed to fetch all levels", err);
    } finally {
      if (requestId === allLeaderboardFetchId.current) {
        setIsFetchingAll(false);
      }
    }
  };

  useEffect(() => {
    if (dynamicLevels.length > 0) {
      fetchAllLevels();
    }
  }, [dynamicLevels]);

  const getPlayerStats = (username: string): PlayerStats | null => {
    if (!username) return null;

    const playerLevels: Record<string, PlayerLevelStats> = {};
    
    allLevelsWithCustoms.forEach(level => {
      const levelData = processedAllLevelsData[level.id] || [];
      const entry = levelData.find(e => e.username === username);
      
      if (entry) {
        const config = allRankConfigs[level.id];
        const hasConfig = !!(config && config.ranks && Object.keys(config.ranks).length > 0);
        const levelRanks = config?.ranks || {};
        
        // Merge with global ranks for consistent names/colors
        const merged: Record<string, RankInfo> = {};
        RANK_ORDER.forEach(id => {
          const gRank = globalRankConfig[id] || DEFAULT_RANKS[id];
          const lRank = levelRanks[id];
          
          // Robustly get time cutoff (handle legacy number-only format)
          let timeCutoff: number;
          if (typeof lRank === 'number') {
            timeCutoff = lRank;
          } else if (lRank && typeof lRank.timeCutoff === 'number') {
            timeCutoff = lRank.timeCutoff;
          } else {
            timeCutoff = 0;
          }

          merged[id] = {
            ...gRank,
            timeCutoff
          };
        });

        const rankId = hasConfig ? assignRank(entry, merged, RANK_ORDER) : "";
        
        playerLevels[level.id] = {
          levelId: level.id,
          levelName: level.name,
          bestTime: entry.completion_time,
          rankId,
          arrowName: entry.arrow_name,
          date: entry.created_at
        };
      }
    });

    const levelEntries = Object.values(playerLevels);

    return {
      username,
      levels: playerLevels,
      averageTime: levelEntries.length > 0 ? levelEntries.reduce((a, b) => a + b.bestTime, 0) / levelEntries.length : 0,
      totalLevels: levelEntries.length,
      bestRank: "Beginner" // Calculated in component
    };
  };

  const handlePlayerClick = async (username: string) => {
    setSelectedPlayer(username);
    setView('profile');
    await fetchAllLevels();
  };

  const handleCompareClick = async (username: string) => {
    setSelectedPlayer(username);
    setView('compare');
    await fetchAllLevels();
  };

  const assignOverallRank = (totalTime: number, config: Record<string, RankInfo>, order: string[]) => {
    const safeOrder = order || RANK_ORDER || [];
    const safeConfig = config || DEFAULT_OVERALL_RANKS || {};
    for (const rankId of safeOrder) {
      const rank = safeConfig[rankId];
      if (rank && totalTime <= rank.timeCutoff) {
        return rankId;
      }
    }
    return safeOrder[safeOrder.length - 1] || "Beginner";
  };

  const applyLegacyRunsToLeaderboard = (
    levelId: string, 
    apiEntries: LeaderboardEntry[], 
    legacyRunsList: LegacyRun[]
  ): LeaderboardEntry[] => {
    const levelLegacyRuns = legacyRunsList.filter(r => r.levelId === levelId);
    if (levelLegacyRuns.length === 0) return apiEntries;

    const mergedEntries = [...apiEntries];

    levelLegacyRuns.forEach(legacy => {
      const existingIndex = mergedEntries.findIndex(
        e => e.username.toLowerCase() === legacy.username.toLowerCase()
      );

      if (existingIndex !== -1) {
        const existing = mergedEntries[existingIndex];
        // Only overwrite if the legacy run is better (lower completion time)
        if (legacy.completionTime < existing.completion_time) {
          mergedEntries[existingIndex] = {
            ...existing,
            completion_time: legacy.completionTime,
            created_at: legacy.createdAt || existing.created_at,
            arrow_name: legacy.arrow_name || legacy.arrowId || existing.arrow_name || "Narrow Arrow",
            isLegacy: true,
            run_id: -Math.abs(legacy.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) || -Math.floor(Math.random() * 100000)
          };
        }
      } else {
        mergedEntries.push({
          run_id: -Math.abs(legacy.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) || -Math.floor(Math.random() * 100000),
          completion_time: legacy.completionTime,
          username: legacy.username,
          arrow_name: legacy.arrow_name || legacy.arrowId || "Narrow Arrow",
          created_at: legacy.createdAt || new Date().toISOString().split('T')[0],
          isLegacy: true
        });
      }
    });

    return mergedEntries.sort((a, b) => a.completion_time - b.completion_time);
  };

  const stripRemoved = (entries: LeaderboardEntry[], levelId: string) =>
    removedKeys.size === 0
      ? entries
      : entries.filter(e => !removedKeys.has(removedRunKey(levelId, e.username, e.completion_time)));

  const processedData = useMemo(() => {
    return stripRemoved(
      applyLegacyRunsToLeaderboard(selectedLevel, data, mappedLegacyRuns),
      selectedLevel,
    );
  }, [selectedLevel, data, mappedLegacyRuns, removedKeys]);

  const processedAllLevelsData = useMemo(() => {
    const result: Record<string, LeaderboardEntry[]> = {};
    Object.keys(allLevelsData).forEach(levelId => {
      result[levelId] = stripRemoved(
        applyLegacyRunsToLeaderboard(levelId, allLevelsData[levelId], mappedLegacyRuns),
        levelId,
      );
    });
    return result;
  }, [allLevelsData, mappedLegacyRuns, removedKeys]);


  const allUsernames = useMemo(() => {
    const usernames = new Set<string>();
    Object.values(processedAllLevelsData).forEach((levelData: LeaderboardEntry[]) => {
      levelData.forEach(entry => usernames.add(entry.username));
    });
    return Array.from(usernames);
  }, [processedAllLevelsData]);

  // Automatic legacy player rename check
  useEffect(() => {
    if (legacyRuns.length === 0 || allUsernames.length === 0) return;

    const autoCheckRenames = async () => {
      // Find usernames in legacyRuns that are NOT in allUsernames AND NOT already mapped as oldName in nameChanges
      const unmappedLegacyUsernames = Array.from(new Set(legacyRuns.map(r => r.username)))
        .filter((username: string) => {
          const lowerName = username.toLowerCase();
          const inActive = allUsernames.some(u => u.toLowerCase() === lowerName);
          const inMappings = nameChanges.some(nc => nc.oldName.toLowerCase() === lowerName);
          return !inActive && !inMappings;
        }) as string[];

      if (unmappedLegacyUsernames.length === 0) return;

      // Check one username at a time to avoid rate limits
      for (const oldName of unmappedLegacyUsernames) {
        try {
          const res = await fetch(`/api/user/${encodeURIComponent(oldName)}`);
          if (res.ok) {
            const profileData = await res.json();
            const apiUsername = profileData?.user?.username || profileData?.username;
            if (apiUsername && apiUsername.toLowerCase() !== oldName.toLowerCase()) {
              console.log(`[Auto-Rename] Detected name change for ${oldName} -> ${apiUsername}`);
              
              const nameChangeSlug = `${oldName.toLowerCase()}_to_${apiUsername.toLowerCase()}`.replace(/[^a-z0-9_]/g, '_');
              await setDoc(doc(db, "nameChanges", nameChangeSlug), {
                oldName,
                newName: apiUsername,
                timestamp: new Date().toISOString()
              });
              
              // Only do one per pass to allow snapshots to process cleanly
              break;
            }
          }
        } catch (err) {
          console.error(`Failed to auto-detect name change for ${oldName}:`, err);
        }
      }
    };

    const timer = setTimeout(() => {
      autoCheckRenames();
    }, 5000);

    return () => clearTimeout(timer);
  }, [legacyRuns, allUsernames, nameChanges]);

  const averageLeaderboard = useMemo(() => {
    if (Object.keys(processedAllLevelsData).length === 0) return [];

    const packLevels = selectedAveragePack === "all" 
      ? dynamicLevels 
      : dynamicLevels.filter(l => l.packId === selectedAveragePack);

    if (packLevels.length === 0) return [];

    const players: Record<string, { username: string, totalPosition: number, count: number, totalTime: number }> = {};
    
    allUsernames.forEach(username => {
      packLevels.forEach(level => {
        const levelData = processedAllLevelsData[level.id] || [];
        const entryIndex = levelData.findIndex(e => e.username === username);
        
        if (entryIndex !== -1) {
          const entry = levelData[entryIndex];
          
          if (!players[username]) {
            players[username] = { username, totalPosition: 0, count: 0, totalTime: 0 };
          }
          players[username].totalPosition += (entryIndex + 1);
          players[username].count += 1;
          players[username].totalTime += entry.completion_time;
        }
      });
    });

    let result = Object.values(players).map(p => ({
      ...p,
      avgPosition: p.totalPosition / p.count,
      avgTime: p.totalTime / p.count
    }));

    if (allMapsPlayedFilter) {
      result = result.filter(p => p.count === packLevels.length);
    }

    result.sort((a, b) => a.avgPosition - b.avgPosition || a.avgTime - b.avgTime);

    const scaleFactor = packLevels.length / (dynamicLevels.length || 1);

    return result.map(p => {
      const getScaledOverallRank = (totalTime: number) => {
        const safeOrder = RANK_ORDER || [];
        const safeConfig = overallRankConfig || DEFAULT_OVERALL_RANKS || {};
        for (const rankId of safeOrder) {
          const rank = safeConfig[rankId];
          if (rank) {
            const cutoff = rank.timeCutoff * scaleFactor;
            if (totalTime <= cutoff) {
              return rankId;
            }
          }
        }
        return safeOrder[safeOrder.length - 1] || "Beginner";
      };

      return {
        ...p,
        overallRankId: getScaledOverallRank(p.totalTime)
      };
    });
  }, [processedAllLevelsData, allUsernames, allMapsPlayedFilter, overallRankConfig, dynamicLevels, selectedAveragePack]);

  const selectedPlayerMedals = useMemo(() => {
    if (!selectedPlayer) return undefined;
    return computeMedals(selectedPlayer, dynamicLevels.map(l => l.id), processedAllLevelsData);
  }, [selectedPlayer, dynamicLevels, processedAllLevelsData]);

  const worldRecords = useMemo(() => {
    return dynamicLevels.map(level => {
      const levelData = processedAllLevelsData[level.id] || [];
      const wr = levelData.length > 0 ? levelData[0] : null;
      return {
        levelId: level.id,
        levelName: level.name,
        wr
      };
    });
  }, [processedAllLevelsData, dynamicLevels]);

  const worldRecordHistories = useMemo(() => {
    return dynamicLevels.map(level => {
      const datedEntries = [...(processedAllLevelsData[level.id] || [])]
        .filter(entry => entry.created_at && Number.isFinite(new Date(entry.created_at).getTime()))
        .sort((a, b) => {
          const dateDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          return dateDiff || a.completion_time - b.completion_time;
        });

      let bestTime = Number.POSITIVE_INFINITY;
      const history: Array<LeaderboardEntry & { previousTime: number | null; improvement: number | null }> = [];

      datedEntries.forEach(entry => {
        if (entry.completion_time < bestTime) {
          history.push({
            ...entry,
            previousTime: Number.isFinite(bestTime) ? bestTime : null,
            improvement: Number.isFinite(bestTime) ? bestTime - entry.completion_time : null,
          });
          bestTime = entry.completion_time;
        }
      });

      return {
        levelId: level.id,
        levelName: level.name,
        packId: level.packId,
        history: history.reverse(),
      };
    });
  }, [processedAllLevelsData, dynamicLevels]);

  const recentWorldRecords = useMemo(() => {
    return worldRecordHistories
      .map(record => ({ ...record, latest: record.history[0] }))
      .filter((record): record is typeof record & { latest: LeaderboardEntry & { previousTime: number | null; improvement: number | null } } => !!record.latest)
      .sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime())
      .slice(0, 12);
  }, [worldRecordHistories]);

  const sortedLevels = useMemo(() => {
    return [...allLevelsWithCustoms].sort((a, b) => {
      const idxA = dynamicPacksWithCustom.findIndex(p => p.id === a.packId);
      const idxB = dynamicPacksWithCustom.findIndex(p => p.id === b.packId);
      if (idxA !== idxB) return idxA - idxB;
      return (a.gameOrder || 0) - (b.gameOrder || 0);
    });
  }, [allLevelsWithCustoms, dynamicPacksWithCustom]);

  const filteredLevelsForSelect = useMemo(() => {
    if (selectedPack === "all") return sortedLevels;
    return sortedLevels.filter(l => l.packId === selectedPack);
  }, [selectedPack, sortedLevels]);

  useEffect(() => {
    if (allLevelsWithCustoms.length === 0) return;
    if (!selectedLevel) return;

    // Skip auto-reset if selectedLevel is not in campaign levels (meaning it is a custom/randomized level)
    const isCampaignLevel = allLevelsWithCustoms.some(l => l.id === selectedLevel);
    if (!isCampaignLevel) {
      return;
    }

    // 1. If selectedLevel is not in allLevelsWithCustoms at all, reset it to the first level of the current pack or first level overall
    const levelExists = allLevelsWithCustoms.some(l => l.id === selectedLevel);
    if (!levelExists) {
      const packLevels = selectedPack === "all" ? allLevelsWithCustoms : allLevelsWithCustoms.filter(l => l.packId === selectedPack);
      if (packLevels.length > 0) {
        setSelectedLevel(packLevels[0].id);
      } else {
        setSelectedLevel(allLevelsWithCustoms[0].id);
        setSelectedPack("all"); // fallback to all packs if the pack is empty
      }
      return;
    }

    // 2. If we are in a specific pack, and selectedLevel's packId does not match the selectedPack, reset selectedLevel to the first level of that pack
    if (selectedPack !== "all") {
      const currentLevelObj = allLevelsWithCustoms.find(l => l.id === selectedLevel);
      if (currentLevelObj && currentLevelObj.packId !== selectedPack) {
        const packLevels = allLevelsWithCustoms.filter(l => l.packId === selectedPack);
        if (packLevels.length > 0) {
          setSelectedLevel(packLevels[0].id);
        } else {
          // If the selected pack has no levels, fall back to "all" packs or first available level
          setSelectedPack("all");
          setSelectedLevel(allLevelsWithCustoms[0].id);
        }
      }
    }
  }, [selectedPack, allLevelsWithCustoms, selectedLevel]);

  const sortedAndFilteredData = useMemo(() => {
    // "All" shows one row per player (their best run); each arrow board shows
    // every player who has a time with that arrow, even if it isn't their best.
    const source =
      arrowFilter === "all"
        ? (() => {
            const best = new Map<string, LeaderboardEntry>();
            processedData.forEach(entry => {
              const key = entry.username.toLowerCase();
              const current = best.get(key);
              if (!current || entry.completion_time < current.completion_time) best.set(key, entry);
            });
            return [...best.values()].sort((a, b) => a.completion_time - b.completion_time);
          })()
        : processedData.filter(
            entry => (entry.arrow_name || "").toLowerCase() === arrowFilter.toLowerCase(),
          );

    const result = source
      .map((entry, idx) => ({ ...entry, originalRank: idx + 1 }))
      .filter(entry => entry.username.toLowerCase().includes(searchQuery.toLowerCase()));



    result.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      if (sortConfig.key === 'rank') {
        const safeRankOrder = RANK_ORDER || [];
        const aRankId = hasLevelRanks ? assignRank(a, activeRankConfig || DEFAULT_RANKS, safeRankOrder) : "Beginner";
        const bRankId = hasLevelRanks ? assignRank(b, activeRankConfig || DEFAULT_RANKS, safeRankOrder) : "Beginner";
        aValue = safeRankOrder.indexOf(aRankId);
        bValue = safeRankOrder.indexOf(bRankId);
      } else {
        aValue = a[sortConfig.key as keyof LeaderboardEntry];
        bValue = b[sortConfig.key as keyof LeaderboardEntry];
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [processedData, searchQuery, arrowFilter, sortConfig, activeRankConfig, hasLevelRanks]);

  const handleSort = (key: keyof LeaderboardEntry | 'rank') => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const exportLeaderboardCsv = () => {
    const levelName = sortedLevels.find(l => l.id === selectedLevel)?.name || selectedLevel || "leaderboard";
    const rows = [
      ["rank", "player", "time", "arrow", "date", "legacy"],
      ...processedData.map((e, i) => [
        String(i + 1),
        e.username,
        String(e.completion_time),
        e.arrow_name || "",
        e.created_at || "",
        e.isLegacy ? "yes" : "no",
      ]),
    ];
    const csv = rows
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${levelName.toLowerCase().replace(/\s+/g, "-")}-leaderboard.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };


  return (
    <div className="na-shell min-h-screen text-slate-200 font-sans selection:bg-[var(--app-accent)]/30">
      <SettingsPanel
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        update={updateSetting}
        reset={resetSettings}
      />
      <CommandPalette
        levels={dynamicLevels}
        players={allUsernames}
        onSelectLevel={handleLevelClick}
        onSelectPlayer={handlePlayerClick}
        onNavigate={async (next) => {
          setView(next as any);
          if (['average', 'wrs', 'score', 'tracker'].includes(next)) await fetchAllLevels();
        }}
      />
      <ProfileHub
        open={showProfileHub}
        onOpenChange={setShowProfileHub}
        onProfilesChanged={reloadProfiles}
      />
      {settings.starfield && (
        <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" style={{ opacity: settings.glow }}>
          <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-[var(--app-accent)]/10 blur-[120px]" />
          <div className="absolute bottom-0 right-1/4 h-96 w-96 rounded-full bg-[var(--app-accent)]/5 blur-[140px]" />
        </div>
      )}
      {/* Header */}
      <header className="border-b border-white/10 bg-[var(--app-accent)]/5 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <ArrowIcon name="Narrow" className="w-8 h-8 md:w-10 md:h-10 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base md:text-xl font-bold tracking-tight text-white truncate">Narrow Arrow</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-mono block">NA Rankings</p>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 md:gap-4 shrink-0">
            {/* Desktop Navigation */}
            <nav className="hidden sm:flex items-center bg-black/20 rounded-lg p-0.5 md:p-1 border border-white/5">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setView('leaderboard')}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", 
                  view === 'leaderboard' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Levels
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={async () => {
                  setView('average');
                  await fetchAllLevels();
                }}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", 
                  view === 'average' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Average
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={async () => {
                  setView('wrs');
                  await fetchAllLevels();
                }}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", 
                  view === 'wrs' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                WRs
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setView('random')}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", 
                  view === 'random' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Randomizer
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setView('customs')}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", 
                  view === 'customs' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Customs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  setView('score');
                  await fetchAllLevels();
                }}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'score' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                NarrowScore
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('completions')}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'completions' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Completions
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  setView('tracker');
                  await fetchAllLevels();
                }}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'tracker' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Tracker
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  setView('points');
                  await fetchAllLevels();
                }}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'points' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Rank Points
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('voting')}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'voting' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Voting
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView('rating')}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'rating' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Level Rating
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  setView('position');
                  await fetchAllLevels();
                }}
                className={cn(
                  "text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0",
                  view === 'position' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)]" : "text-slate-400 hover:text-white"
                )}
              >
                Position Points
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { setView('insights'); await fetchAllLevels(); }}
                className={cn("text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", view === 'insights' ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400 hover:text-white")}
              >
                Insights
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { setView('rivalries'); await fetchAllLevels(); }}
                className={cn("text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", view === 'rivalries' ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400 hover:text-white")}
              >
                Rivalries
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { setView('fame'); await fetchAllLevels(); }}
                className={cn("text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", view === 'fame' ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400 hover:text-white")}
              >
                Hall of Fame
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { setView('targets'); await fetchAllLevels(); }}
                className={cn("text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", view === 'targets' ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400 hover:text-white")}
              >
                Targets
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => { setView('clubs'); await fetchAllLevels(); }}
                className={cn("text-[8px] md:text-[10px] uppercase tracking-widest h-6 md:h-8 px-1.5 md:px-3 shrink-0", view === 'clubs' ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400 hover:text-white")}
              >
                Clubs
              </Button>
            </nav>


            {/* Mobile Dropdown Navigation */}
            <div className="block sm:hidden w-[110px] xs:w-[140px] shrink-0">
              <Select 
                value={['leaderboard', 'average', 'wrs', 'random', 'customs', 'score', 'completions', 'tracker', 'points', 'voting', 'rating', 'position', 'insights', 'rivalries', 'fame', 'targets', 'clubs'].includes(view) ? view : 'leaderboard'} 
                onValueChange={async (val: any) => {
                  setView(val);
                  if (['average', 'wrs', 'score', 'tracker', 'points', 'position', 'insights', 'rivalries', 'fame', 'targets', 'clubs'].includes(val)) {
                    await fetchAllLevels();
                  }
                }}
              >
                <SelectTrigger className="bg-black/40 border-white/10 h-8 text-[9px] uppercase font-bold tracking-wider text-white px-2 focus:ring-[var(--app-accent)]/50">
                  <SelectValue placeholder="Navigate" />
                </SelectTrigger>
                <SelectContent className="bg-[#121212] border-white/10 text-slate-200">
                  <SelectItem value="leaderboard" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Levels
                  </SelectItem>
                  <SelectItem value="average" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Average
                  </SelectItem>
                  <SelectItem value="wrs" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    World Records
                  </SelectItem>
                  <SelectItem value="random" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Randomizer
                  </SelectItem>
                  <SelectItem value="customs" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Custom Levels
                  </SelectItem>
                  <SelectItem value="score" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    NarrowScore
                  </SelectItem>
                  <SelectItem value="completions" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Custom Completions
                  </SelectItem>
                  <SelectItem value="tracker" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Record Tracker
                  </SelectItem>
                  <SelectItem value="points" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Rank Points
                  </SelectItem>
                  <SelectItem value="voting" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Player Voting
                  </SelectItem>
                  <SelectItem value="rating" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Level Rating
                  </SelectItem>
                  <SelectItem value="position" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Position Points
                  </SelectItem>
                  <SelectItem value="insights" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Level Insights
                  </SelectItem>
                  <SelectItem value="rivalries" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Rivalries
                  </SelectItem>
                  <SelectItem value="fame" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Hall of Fame
                  </SelectItem>
                  <SelectItem value="targets" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Improvement Targets
                  </SelectItem>
                  <SelectItem value="clubs" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2.5 cursor-pointer text-[10px] uppercase font-mono font-bold">
                    Milestone Clubs
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <Button
              variant="ghost"
              size="icon"
              title="Your profile"
              onClick={() => setShowProfileHub(true)}
              className="text-slate-400 hover:text-white hover:bg-white/5 h-8 w-8 md:h-10 md:w-10"
            >
              <UserRound className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Appearance settings"
              onClick={() => setShowSettings(true)}
              className="text-slate-400 hover:text-white hover:bg-white/5 h-8 w-8 md:h-10 md:w-10"
            >
              <Palette className="w-4 h-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setShowAdmin(!showAdmin)}
              className={cn("text-slate-400 hover:text-white hover:bg-white/5 h-8 w-8 md:h-10 md:w-10", showAdmin && "text-[#6366F1]")}
            >
              {showAdmin ? <LayoutDashboard className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
            </Button>
            {view === 'leaderboard' && (
              <Button
                variant="ghost"
                size="icon"
                title="Export current leaderboard as CSV"
                onClick={exportLeaderboardCsv}
                className="text-slate-400 hover:text-white hover:bg-white/5 h-8 w-8 md:h-10 md:w-10"
              >
                <Download className="w-4 h-4" />
              </Button>
            )}
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => fetchData(selectedLevel, true)}
              className="text-slate-400 hover:text-white hover:bg-white/5 h-8 w-8 md:h-10 md:w-10"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </Button>

          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
         {showAdmin ? (
          <AdminPanel 
            levels={dynamicLevels} 
            levelPacks={dynamicPacks} 
            allUsernames={allUsernames} 
            isFetchingAll={isFetchingAll} 
          />
        ) : view === 'profile' && selectedPlayer ? (
          isFetchingAll ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <RefreshCw className="w-12 h-12 text-[var(--app-accent)] animate-spin" />
              <p className="text-slate-500 font-mono text-sm animate-pulse">Analyzing player performance across all levels...</p>
            </div>
          ) : getPlayerStats(selectedPlayer) ? (
            <PlayerProfile 
              stats={getPlayerStats(selectedPlayer)!} 
              levels={sortedLevels}
              packs={dynamicPacks}
              rankConfigs={allRankConfigs}
              globalRankConfig={globalRankConfig}
              overallRankConfig={overallRankConfig}
              packOverallConfigs={allPackOverallConfigs}
              onBack={() => setView('leaderboard')}
              onCompare={(u) => {
                setPlayer2ToCompare(null);
                setView('compare');
              }}
              onLevelClick={handleLevelClick}
              worldRecords={worldRecords}
              computedMedals={selectedPlayerMedals}
              levelStandings={processedAllLevelsData}
              legacyRuns={mappedLegacyRuns}
              profile={playerProfiles[selectedPlayer.toLowerCase()]}
              canEditProfile={!!myLinkedProfile && myLinkedProfile.username?.toLowerCase() === selectedPlayer.toLowerCase()}
              onSaveProfile={async (patch) => { await saveMyProfile(patch); }}
              onRequestSignIn={() => setShowProfileHub(true)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <AlertCircle className="w-12 h-12 text-red-500" />
              <p className="text-slate-500 font-mono text-sm">Player data not found.</p>
              <Button onClick={() => setView('leaderboard')} variant="outline">Back to Leaderboard</Button>
            </div>
          )
        ) : view === 'compare' && selectedPlayer ? (
          isFetchingAll ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <RefreshCw className="w-12 h-12 text-[var(--app-accent)] animate-spin" />
              <p className="text-slate-500 font-mono text-sm animate-pulse">Preparing comparison data...</p>
            </div>
          ) : getPlayerStats(selectedPlayer) ? (
            <ComparePlayers 
              initialPlayer={getPlayerStats(selectedPlayer)!}
              allUsernames={allUsernames}
              levels={sortedLevels}
              packs={dynamicPacks}
              onBack={() => setView('leaderboard')}
              getPlayerStats={getPlayerStats}
              onLevelClick={handleLevelClick}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <AlertCircle className="w-12 h-12 text-red-500" />
              <p className="text-slate-500 font-mono text-sm">Player data not found.</p>
              <Button onClick={() => setView('leaderboard')} variant="outline">Back to Leaderboard</Button>
            </div>
          )
        ) : view === 'average' ? (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Globe className="w-6 h-6 text-[var(--app-accent)]" />
                  Average Rankings
                </h2>
                <p className="text-slate-500 text-sm">Overall performance based on average leaderboard position and rank.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {/* Search Player */}
                <div className="relative w-48 sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input 
                    placeholder="Search player..." 
                    className="bg-white/5 border-white/10 h-10 pl-10 pr-10 focus-visible:ring-[var(--app-accent)]/50 text-white text-xs"
                    value={averageSearchQuery}
                    onChange={(e) => setAverageSearchQuery(e.target.value)}
                  />
                  {averageSearchQuery && (
                    <button 
                      onClick={() => setAverageSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Pack Selector */}
                <div className="w-48">
                  <Select value={selectedAveragePack} onValueChange={setSelectedAveragePack}>
                    <SelectTrigger className="bg-white/5 border-white/10 h-10 focus:ring-[var(--app-accent)]/50 hover:bg-white/10 transition-all text-white text-xs">
                      <SelectValue placeholder="All Map Packs">
                        {selectedAveragePack === "all" ? "All Map Packs" : (dynamicPacks.find(p => p.id === selectedAveragePack)?.name || capitalizeName(selectedAveragePack))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 text-xs">
                      <SelectItem value="all" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2 cursor-pointer">
                        All Map Packs
                      </SelectItem>
                      {dynamicPacks.map(pack => (
                        <SelectItem key={pack.id} value={pack.id} className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-2 cursor-pointer">
                          {pack.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-1 self-start">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setAllMapsPlayedFilter(false)}
                    className={cn("text-[10px] uppercase tracking-widest h-8 px-3", !allMapsPlayedFilter ? "bg-white/10 text-white" : "text-slate-400")}
                  >
                    Any Map
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setAllMapsPlayedFilter(true)}
                    className={cn("text-[10px] uppercase tracking-widest h-8 px-3", allMapsPlayedFilter ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400")}
                  >
                    All Maps Only
                  </Button>
                </div>
              </div>
            </div>

            {/* Average Stats Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Ranked Players", value: averageLeaderboard.length, icon: Users },
                { 
                  label: "Avg Completion", 
                  value: `${(averageLeaderboard.reduce((acc, curr) => acc + curr.count, 0) / (averageLeaderboard.length || 1)).toFixed(1)} / ${selectedAveragePack === "all" ? dynamicLevels.length : dynamicLevels.filter(l => l.packId === selectedAveragePack).length}`, 
                  icon: Target 
                },
                { 
                  label: "Perfect Scores", 
                  value: averageLeaderboard.filter(p => p.count === (selectedAveragePack === "all" ? dynamicLevels.length : dynamicLevels.filter(l => l.packId === selectedAveragePack).length)).length, 
                  icon: CheckCircle2 
                },
                { 
                  label: "Top Average Pos", 
                  value: averageLeaderboard.length > 0 ? `#${averageLeaderboard[0].avgPosition.toFixed(1)}` : "N/A", 
                  icon: Trophy,
                  imgSrc: "https://play.narrowarrow.xyz/assets/assets/images/trophy.svg"
                },
              ].map((stat, i) => (
                <Card key={i} className="bg-white/5 border-white/10 overflow-hidden group">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{stat.label}</p>
                      <div className="text-lg md:text-xl font-mono font-bold text-white">{stat.value}</div>
                    </div>
                    {stat.imgSrc ? (
                      <img 
                        src={stat.imgSrc} 
                        alt={stat.label} 
                        className="w-6 h-6 md:w-8 md:h-8 opacity-25 group-hover:opacity-40 transition-opacity shrink-0"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : (
                      <stat.icon className="w-6 h-6 md:w-8 md:h-8 text-white/5 group-hover:text-[var(--app-accent)]/20 transition-colors shrink-0" />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="bg-white/5 border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/[0.02]">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="w-16 text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">#</TableHead>
                      <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Player</TableHead>
                      <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500 whitespace-nowrap">Avg Pos (LB)</TableHead>
                      <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500 whitespace-nowrap">Avg Time</TableHead>
                      <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500 whitespace-nowrap">Total Time</TableHead>
                      <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500 whitespace-nowrap">Overall Rank</TableHead>
                      <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500 whitespace-nowrap">Maps Played</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const filtered = averageLeaderboard
                        .map((p, idx) => ({ ...p, originalRank: idx + 1 }))
                        .filter(p => p.username.toLowerCase().includes(averageSearchQuery.toLowerCase()));

                      if (filtered.length === 0) {
                        return (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center py-8 text-slate-500 font-mono text-xs">
                              No players found matching "{averageSearchQuery}"
                            </TableCell>
                          </TableRow>
                        );
                      }

                      return filtered.map((p) => {
                        const maxLevelsInFilter = selectedAveragePack === "all" ? dynamicLevels.length : dynamicLevels.filter(l => l.packId === selectedAveragePack).length;
                        return (
                          <TableRow key={p.username} className="border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={() => handlePlayerClick(p.username)}>
                            <TableCell className="text-center font-mono text-slate-500">{p.originalRank}</TableCell>
                            <TableCell className="font-bold text-white whitespace-nowrap">{p.username}</TableCell>
                            <TableCell className="text-center font-mono text-white">
                              <span className="text-[var(--app-accent)]">#</span>{p.avgPosition.toFixed(1)}
                            </TableCell>
                            <TableCell className="text-center font-mono text-[#2DD4BF] whitespace-nowrap">{formatTime(p.avgTime, 'seconds')}</TableCell>
                            <TableCell className="text-center font-mono text-[#6366F1] whitespace-nowrap">{formatTime(p.totalTime, 'minutes')}</TableCell>
                            <TableCell className="text-center">
                              {(() => {
                                const rankInfo = overallRankConfig[p.overallRankId] || DEFAULT_OVERALL_RANKS[p.overallRankId];
                                return (
                                  <Badge variant="outline" className={cn("text-[10px] font-bold uppercase whitespace-nowrap", rankInfo.color, rankInfo.bgColor, rankInfo.borderColor)}>
                                    {rankInfo.name}
                                  </Badge>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-right font-mono text-slate-500 whitespace-nowrap">
                              {p.count} / {maxLevelsInFilter}
                              {p.count === maxLevelsInFilter && <CheckCircle2 className="w-3 h-3 text-green-500 inline ml-2" />}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        ) : view === 'wrs' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  <img 
                    src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
                    alt="Trophy" 
                    className="w-6 h-6 object-contain"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  Records & Hall of Fame
                </h2>
                <p className="text-slate-500 text-sm">The fastest times and top performers.</p>
              </div>
              <div className="flex bg-white/5 border border-white/10 rounded-lg p-1 w-full sm:w-[420px]">
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={() => setWrsTab('wrs')}
                  className={cn(
                    "flex-1 h-8 text-xs font-medium rounded-md transition-all",
                    wrsTab === 'wrs' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                  )}
                >
                  World Records
                </Button>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={() => setWrsTab('hof')}
                  className={cn(
                    "flex-1 h-8 text-xs font-medium rounded-md transition-all",
                    wrsTab === 'hof' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                  )}
                >
                  Hall of Fame
                </Button>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={() => setWrsTab('history')}
                  className={cn(
                    "flex-1 h-8 text-xs font-medium rounded-md transition-all",
                    wrsTab === 'history' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                  )}
                >
                  History
                </Button>
                <Button 
                  variant="ghost"
                  size="sm"
                  onClick={() => setWrsTab('arrows')}
                  className={cn(
                    "flex-1 h-8 text-xs font-medium rounded-md transition-all",
                    wrsTab === 'arrows' ? "bg-[var(--app-accent)] text-slate-950 font-bold shadow-lg" : "text-slate-400 hover:text-white"
                  )}
                >
                  Arrow WRs
                </Button>
              </div>
            </div>

            {wrsTab === 'arrows' ? (
              <ArrowRecordsView
                levels={sortedLevels.filter(l => l.packId !== 'custom')}
                data={processedAllLevelsData}
                onLevelClick={(levelId) => { setSelectedLevel(levelId); setView('leaderboard'); }}
                onPlayerClick={handlePlayerClick}
              />
            ) : wrsTab === 'wrs' ? (
              <div className="space-y-10">
                {dynamicPacks.map(pack => {
                  const packLevels = sortedLevels.filter(l => l.packId === pack.id);
                  if (packLevels.length === 0) return null;

                  return (
                    <div key={pack.id} className="space-y-4">
                      <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] border-b border-white/10 pb-2 flex items-center gap-2">
                        <span className="w-2 h-4 bg-[var(--app-accent)] rounded shadow-[0_0_8px_rgba(56,189,248,0.6)]"></span>
                        {pack.name}
                        <span className="text-[10px] text-slate-500 font-mono font-normal lowercase">({packLevels.length} levels)</span>
                      </h3>

                      <Card className="bg-white/5 border-white/10 overflow-hidden">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader className="bg-white/[0.02]">
                              <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500 w-1/3">Level</TableHead>
                                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500 w-1/3">Holder</TableHead>
                                <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">Arrow</TableHead>
                                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">Time</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {packLevels.map(level => {
                                const wr = worldRecords.find(r => r.levelId === level.id);
                                return (
                                  <TableRow key={level.id} className="border-white/5 hover:bg-white/[0.02]">
                                    <TableCell className="whitespace-nowrap py-2.5">
                                      <div className="flex items-center gap-3">
                                        <img 
                                          src={`https://api.narrowarrow.xyz/level-image/${level.id}.png`}
                                          referrerPolicy="no-referrer"
                                          alt=""
                                          className="w-8 h-8 rounded border border-white/10 object-cover bg-black/40 shrink-0"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                          }}
                                        />
                                        <div className="flex items-center gap-2">
                                          <span 
                                            className="font-bold text-[var(--app-accent)] hover:underline cursor-pointer transition-colors"
                                            onClick={() => {
                                              setSelectedLevel(level.id);
                                              setView('leaderboard');
                                            }}
                                          >
                                            {level.name}
                                          </span>
                                          <a
                                            href={`https://narrowarrow.xyz/levelid=${level.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-slate-500 hover:text-emerald-400 p-1 rounded hover:bg-white/5 transition-colors shrink-0"
                                            title="Play Level"
                                            id={`play-btn-overview-${level.id}`}
                                          >
                                            <Play className="w-3.5 h-3.5 fill-current" />
                                          </a>
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell 
                                      className="text-white hover:text-[var(--app-accent)] cursor-pointer transition-colors whitespace-nowrap"
                                      onClick={() => wr?.wr && handlePlayerClick(wr.wr.username)}
                                    >
                                      {wr?.wr?.username || "---"}
                                    </TableCell>
                                    <TableCell className="text-center">
                                      {wr?.wr && <ArrowIcon name={wr.wr.arrow_name} className={cn(
                                        "w-5 h-5 mx-auto",
                                        wr.wr.arrow_name.toLowerCase().includes("energy") ? "text-[#22c55e]" :
                                        wr.wr.arrow_name.toLowerCase().includes("speedy") ? "text-[#3b82f6]" :
                                        "text-[var(--app-accent)]"
                                      )} />}
                                    </TableCell>
                                    <TableCell className="text-right font-mono font-bold text-yellow-400 whitespace-nowrap">
                                      {wr?.wr ? formatTime(wr.wr.completion_time) : "---"}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </Card>
                    </div>
                  );
                })}
              </div>
            ) : wrsTab === 'history' ? (
              <div className="space-y-8">
                <Card className="bg-white/5 border-white/10 overflow-hidden">
                  <CardHeader className="border-b border-white/10 bg-white/[0.02]">
                    <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
                      <History className="w-5 h-5 text-[var(--app-accent)]" />
                      Recent World Records
                    </CardTitle>
                    <CardDescription className="text-slate-500 text-xs">
                      Latest record-setting runs across loaded official maps.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-white/[0.02]">
                          <TableRow className="border-white/10 hover:bg-transparent">
                            <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Level</TableHead>
                            <TableHead className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Player</TableHead>
                            <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">Time</TableHead>
                            <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">Set</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {recentWorldRecords.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-8 text-slate-500 font-mono text-xs">
                                {isFetchingAll ? `Loading leaderboards ${leaderboardLoadStatus.loaded} / ${leaderboardLoadStatus.total}...` : "No record history loaded yet."}
                              </TableCell>
                            </TableRow>
                          ) : recentWorldRecords.map(record => (
                            <TableRow key={record.levelId} className="border-white/5 hover:bg-white/[0.02]">
                              <TableCell className="font-bold text-[var(--app-accent)] whitespace-nowrap cursor-pointer hover:underline" onClick={() => { setSelectedLevel(record.levelId); setView('leaderboard'); }}>
                                {record.levelName}
                              </TableCell>
                              <TableCell className="text-white whitespace-nowrap cursor-pointer hover:text-[var(--app-accent)]" onClick={() => handlePlayerClick(record.latest.username)}>
                                {record.latest.username}
                              </TableCell>
                              <TableCell className="text-right font-mono font-bold text-yellow-400 whitespace-nowrap">
                                {formatTime(record.latest.completion_time)}
                              </TableCell>
                              <TableCell className="text-right text-slate-500 text-xs font-mono whitespace-nowrap">
                                {formatDate(record.latest.created_at)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-10">
                  {dynamicPacks.map(pack => {
                    const packHistories = worldRecordHistories.filter(record => record.packId === pack.id);
                    if (packHistories.length === 0) return null;

                    return (
                      <div key={pack.id} className="space-y-4">
                        <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] border-b border-white/10 pb-2 flex items-center gap-2">
                          <span className="w-2 h-4 bg-[var(--app-accent)] rounded shadow-[0_0_8px_rgba(56,189,248,0.6)]"></span>
                          {pack.name}
                          <span className="text-[10px] text-slate-500 font-mono font-normal lowercase">({packHistories.length} histories)</span>
                        </h3>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {packHistories.map(record => (
                            <Card key={record.levelId} className="bg-white/5 border-white/10 overflow-hidden">
                              <CardHeader className="bg-white/[0.02] border-b border-white/10 py-3">
                                <div className="flex items-center justify-between gap-3">
                                  <CardTitle className="text-sm font-bold text-[var(--app-accent)] truncate cursor-pointer hover:underline" onClick={() => { setSelectedLevel(record.levelId); setView('leaderboard'); }}>
                                    {record.levelName}
                                  </CardTitle>
                                  <Badge variant="outline" className="bg-yellow-400/10 text-yellow-400 border-yellow-400/30 font-mono text-[10px] whitespace-nowrap">
                                    {record.history.length} WR{record.history.length === 1 ? "" : "s"}
                                  </Badge>
                                </div>
                              </CardHeader>
                              <CardContent className="p-0">
                                <Table>
                                  <TableBody>
                                    {record.history.slice(0, 6).map((entry, index) => (
                                      <TableRow key={`${record.levelId}-${entry.run_id}-${index}`} className="border-white/5 hover:bg-white/[0.02]">
                                        <TableCell className="py-2 text-xs font-bold text-white cursor-pointer hover:text-[var(--app-accent)]" onClick={() => handlePlayerClick(entry.username)}>
                                          {entry.username}
                                        </TableCell>
                                        <TableCell className="py-2 text-right font-mono text-xs text-yellow-400 whitespace-nowrap">
                                          {formatTime(entry.completion_time)}
                                        </TableCell>
                                        <TableCell className="py-2 text-right font-mono text-[10px] text-slate-500 whitespace-nowrap">
                                          {formatDate(entry.created_at)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                    {record.history.length === 0 && (
                                      <TableRow className="border-white/5">
                                        <TableCell colSpan={3} className="py-4 text-center text-slate-500 text-xs font-mono">
                                          Loading history...
                                        </TableCell>
                                      </TableRow>
                                    )}
                                  </TableBody>
                                </Table>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-12">
                {dynamicPacks.map(pack => {
                  const packLevels = sortedLevels.filter(l => l.packId === pack.id);
                  if (packLevels.length === 0) return null;

                  return (
                    <div key={pack.id} className="space-y-4">
                      <h3 className="text-sm font-extrabold uppercase tracking-widest text-[var(--app-accent)] border-b border-white/10 pb-2 flex items-center gap-2">
                        <span className="w-2 h-4 bg-[var(--app-accent)] rounded shadow-[0_0_8px_rgba(56,189,248,0.6)]"></span>
                        {pack.name}
                        <span className="text-[10px] text-slate-500 font-mono font-normal lowercase">({packLevels.length} levels)</span>
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {packLevels.map(level => {
                          const top3 = (processedAllLevelsData[level.id] || []).slice(0, 3);
                          return (
                            <Card key={level.id} className="bg-white/5 border-white/10 overflow-hidden hover:border-[var(--app-accent)]/30 transition-all group flex flex-col">
                              <div className="bg-white/[0.02] border-b border-white/10 p-3 flex items-center gap-3">
                                <img 
                                  src={`https://api.narrowarrow.xyz/level-image/${level.id}.png`}
                                  referrerPolicy="no-referrer"
                                  alt=""
                                  className="w-10 h-10 rounded-md border border-white/10 object-cover bg-black/40 shrink-0 group-hover:scale-105 transition-transform"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                 animate-duration-300 />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-1.5">
                                    <h4 
                                      className="text-sm font-bold text-[var(--app-accent)] truncate hover:underline cursor-pointer"
                                      onClick={() => {
                                        setSelectedLevel(level.id);
                                        setView('leaderboard');
                                      }}
                                    >
                                      {level.name}
                                    </h4>
                                    <a
                                      href={`https://narrowarrow.xyz/levelid=${level.id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-slate-500 hover:text-emerald-400 p-1 rounded hover:bg-white/5 transition-colors shrink-0"
                                      title="Play Level"
                                      id={`play-btn-card-${level.id}`}
                                    >
                                      <Play className="w-3.5 h-3.5 fill-current" />
                                    </a>
                                  </div>
                                  <ClickToCopy text={level.id} label="ID" className="mt-1" />
                                </div>
                              </div>
                              <CardContent className="p-0 flex-1 flex flex-col justify-between">
                                <Table>
                                  <TableBody>
                                    {[0, 1, 2].map(i => {
                                      const entry = top3[i];
                                      return (
                                        <TableRow key={i} className="border-white/5 hover:bg-white/[0.02]">
                                          <TableCell className="w-8 text-center py-2">
                                            {i === 0 ? (
                                              <img 
                                                src="https://play.narrowarrow.xyz/assets/assets/images/trophy.svg" 
                                                alt="1st" 
                                                className="w-3.5 h-3.5 object-contain mx-auto"
                                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                              />
                                            ) : 
                                             i === 1 ? <Medal className="w-3 h-3 text-slate-300 mx-auto" /> :
                                             <Medal className="w-3 h-3 text-amber-600 mx-auto" />}
                                          </TableCell>
                                          <TableCell className="py-2">
                                            <span 
                                              className="text-xs font-medium text-white hover:text-[var(--app-accent)] cursor-pointer truncate block max-w-[120px]"
                                              onClick={() => entry && handlePlayerClick(entry.username)}
                                            >
                                              {entry ? entry.username : "---"}
                                            </span>
                                          </TableCell>
                                          <TableCell className="text-right py-2 font-mono text-[10px] text-[#2DD4BF]">
                                            {entry ? formatTime(entry.completion_time, 'seconds') : "---"}
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : view === 'customs' ? (
          <CustomsView
            selectedLevelId={selectedCustomLevelId}
            onSelectLevelId={setSelectedCustomLevelId}
            onSelectPlayer={handlePlayerClick}
            onBack={() => {
              setSelectedCustomLevelId(null);
              setView('leaderboard');
            }}
          />
        ) : view === 'random' ? (
          <RandomLevelSelector
            packs={dynamicPacks}
            levels={sortedLevels}
            onSelectLevel={(levelId) => {
              setSelectedLevel(levelId);
              setView('leaderboard');
            }}
            onSelectCustomLevel={(customLevelId) => {
              setSelectedCustomLevelId(customLevelId);
              setView('customs');
            }}
            onBack={() => setView('leaderboard')}
          />
        ) : view === 'voting' ? (
          <PlayerVotingView
            usernames={allUsernames}
            signedIn={Boolean(adminUser?.id)}
            userId={adminUser?.id ?? null}
            onSelectPlayer={handlePlayerClick}
            onRequestSignIn={() => setShowProfileHub(true)}
          />
        ) : view === 'rating' ? (
          <LevelRatingView
            levels={sortedLevels}
            packs={dynamicPacks}
            signedIn={Boolean(adminUser?.id)}
            userId={adminUser?.id ?? null}
            onRequestSignIn={() => setShowProfileHub(true)}
            onSelectLevel={(levelId) => {
              setSelectedLevel(levelId);
              setView('leaderboard');
            }}
          />
        ) : view === 'insights' ? (
          <LevelInsightsView
            levels={dynamicLevels}
            data={processedAllLevelsData}
            onLevelClick={(levelId) => { setSelectedLevel(levelId); setView('leaderboard'); }}
            formatTime={(seconds) => formatTime(seconds)}
          />
        ) : view === 'rivalries' ? (
          <RivalriesView
            levels={dynamicLevels}
            data={processedAllLevelsData}
            usernames={allUsernames}
            onPlayerClick={handlePlayerClick}
          />
        ) : view === 'fame' ? (
          <HallOfFameView
            levels={dynamicLevels}
            data={processedAllLevelsData}
            onPlayerClick={handlePlayerClick}
          />
        ) : view === 'targets' ? (
          <ImprovementTargetsView
            levels={dynamicLevels}
            data={processedAllLevelsData}
            usernames={allUsernames}
            onLevelClick={(levelId) => { setSelectedLevel(levelId); setView('leaderboard'); }}
          />
        ) : view === 'clubs' ? (
          <MilestoneClubsView
            levels={dynamicLevels}
            data={processedAllLevelsData}
            onPlayerClick={handlePlayerClick}
          />

        ) : view === 'position' ? (
          isFetchingAll && Object.keys(processedAllLevelsData).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <RefreshCw className="w-12 h-12 text-[var(--app-accent)] animate-spin" />
              <p className="text-slate-500 font-mono text-sm animate-pulse">Counting leaderboard positions...</p>
            </div>
          ) : (
            <PositionPointsView
              levels={dynamicLevels}
              data={processedAllLevelsData}
              onPlayerClick={handlePlayerClick}
              onLevelClick={(levelId) => {
                setSelectedLevel(levelId);
                setView('leaderboard');
              }}
            />
          )
        ) : view === 'points' ? (
          isFetchingAll && Object.keys(processedAllLevelsData).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <RefreshCw className="w-12 h-12 text-[var(--app-accent)] animate-spin" />
              <p className="text-slate-500 font-mono text-sm animate-pulse">Adding up rank points across every level...</p>
            </div>
          ) : (
            <RankPointsView
              levels={dynamicLevels}
              data={processedAllLevelsData}
              rankConfigs={allRankConfigs}
              onPlayerClick={handlePlayerClick}
              onLevelClick={(levelId) => {
                setSelectedLevel(levelId);
                setView('leaderboard');
              }}
              formatTime={(seconds) => formatTime(seconds)}
            />
          )
        ) : view === 'completions' ? (
          <CustomCompletionsView usernames={allUsernames} onSelectPlayer={handlePlayerClick} />
        ) : view === 'tracker' ? (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Record Tracker</h2>
              <p className="text-slate-500 text-sm">Every recent run across all official levels, newest first.</p>
            </div>
            <RecordTracker
              levels={dynamicLevels}
              data={processedAllLevelsData}
              onSelectPlayer={handlePlayerClick}
              onSelectLevel={handleLevelClick}
              formatTime={(t) => formatTime(t, 'seconds')}
            />
          </div>
        ) : view === 'score' ? (
          isFetchingAll && Object.keys(processedAllLevelsData).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <RefreshCw className="w-12 h-12 text-[var(--app-accent)] animate-spin" />
              <p className="text-slate-500 font-mono text-sm animate-pulse">Crunching NarrowScores across every level...</p>
            </div>
          ) : (
            <NarrowScoreView
              levels={dynamicLevels}
              packs={dynamicPacks}
              data={processedAllLevelsData}
              profiles={playerProfiles}
              onPlayerClick={handlePlayerClick}
              onLevelClick={(levelId) => {
                setSelectedLevel(levelId);
                setView('leaderboard');
              }}
              formatTime={(seconds) => formatTime(seconds)}
            />
          )
        ) : (
          <>
         {/* Controls */}
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
           <div className="space-y-2">
             <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Select Pack</label>
             <Select value={selectedPack} onValueChange={setSelectedPack}>
               <SelectTrigger className="bg-white/5 border-white/10 h-12 focus:ring-[var(--app-accent)]/50 hover:bg-white/10 transition-all text-white">
                 <SelectValue placeholder="All">
                   {selectedPack === "all" ? "All" : (dynamicPacksWithCustom.find(p => p.id === selectedPack)?.name || capitalizeName(selectedPack))}
                 </SelectValue>
               </SelectTrigger>
               <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                 <SelectItem value="all" className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-3 cursor-pointer">
                   All
                 </SelectItem>
                 {dynamicPacksWithCustom.map(pack => (
                   <SelectItem key={pack.id} value={pack.id} className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-3 cursor-pointer">
                     {pack.name}
                   </SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>

           <div className="space-y-2">
             <div className="flex items-center justify-between ml-1">
               <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Select Level</label>
             </div>
             <Select value={selectedLevel} onValueChange={setSelectedLevel}>
               <SelectTrigger className="bg-white/5 border-white/10 h-12 focus:ring-[var(--app-accent)]/50 hover:bg-white/10 transition-all text-white">
                 <SelectValue>
                   {allLevelsWithCustoms.find(l => l.id === selectedLevel)?.name || fetchedLevelDetails[selectedLevel]?.name || selectedLevel}
                 </SelectValue>
               </SelectTrigger>
               <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-[400px]">
                 {filteredLevelsForSelect.map(level => (
                   <SelectItem key={level.id} value={level.id} className="focus:bg-[var(--app-accent)] focus:text-slate-950 py-3 cursor-pointer">
                     <span className="font-medium">{level.name}</span>
                   </SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>

           <div className="space-y-2">
             <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Search Players</label>
             <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
               <Input 
                 placeholder="Search by username..." 
                 className="bg-white/5 border-white/10 h-12 pl-10 focus-visible:ring-[var(--app-accent)]/50"
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
               />
             </div>
           </div>

           <div className="space-y-2">
             <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Legacy Records</label>
             <div className="w-full h-12 rounded-xl text-xs font-mono uppercase tracking-wider border border-amber-500/20 bg-amber-500/10 text-amber-400 flex items-center justify-between px-4">
               <div className="flex items-center gap-2">
                 <History className="w-4 h-4 text-amber-400" />
                 <span>Legacy: Always On</span>
               </div>
               <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
             </div>
           </div>

           <div className="space-y-2 md:col-span-2 lg:col-span-3">
             <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold ml-1">Arrow Filter</label>
             <div className="flex flex-wrap gap-2">
               {([
                 { key: "all", label: "All Arrows" },
                 { key: "Narrow Arrow", label: "Narrow" },
                 { key: "Speedy Arrow", label: "Speedy" },
                 { key: "Energy Arrow", label: "Energy" },
               ] as const).map(option => (
                 <button
                   key={option.key}
                   type="button"
                   onClick={() => setArrowFilter(option.key)}
                   className={cn(
                     "h-12 px-4 rounded-xl border text-xs font-mono uppercase tracking-wider flex items-center gap-2 transition-colors",
                     arrowFilter === option.key
                       ? "border-[var(--app-accent)]/50 bg-[var(--app-accent)]/15 text-[var(--app-accent)]"
                       : "border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                   )}
                 >
                   {option.key !== "all" && <ArrowIcon name={option.key} className="w-4 h-4" />}
                   {option.label}
                 </button>
               ))}
               {usingArrowRanks && (
                 <span className="h-12 px-3 rounded-xl border border-[var(--app-accent)]/40 bg-[var(--app-accent)]/10 text-[10px] uppercase tracking-widest text-[var(--app-accent)] flex items-center">
                   Arrow rank times
                 </span>
               )}
             </div>

           </div>

         </div>

        {/* Level Hero Card */}
        {selectedLevel && (
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-black/80 via-black/40 to-transparent p-6 mb-8 flex flex-col md:flex-row gap-6 items-center justify-between shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
            {/* Backdrop Blur Level Image */}
            <div className="absolute inset-0 z-0 opacity-15 pointer-events-none blur-xl">
              <img 
                src={`https://api.narrowarrow.xyz/level-image/${selectedLevel}.png`}
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
                  src={`https://api.narrowarrow.xyz/level-image/${selectedLevel}.png`}
                  referrerPolicy="no-referrer"
                  alt={allLevelsWithCustoms.find(l => l.id === selectedLevel)?.name || fetchedLevelDetails[selectedLevel]?.name || "Level image"}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
                  <Badge variant="outline" className="bg-[var(--app-accent)]/15 text-[var(--app-accent)] border-[var(--app-accent)]/30 uppercase font-mono tracking-wider text-[9px]">
                    {dynamicPacksWithCustom.find(p => p.id === (allLevelsWithCustoms.find(l => l.id === selectedLevel)?.packId || fetchedLevelDetails[selectedLevel]?.packId))?.name || 'Custom Level'}
                  </Badge>
                  <ClickToCopy text={selectedLevel} label="ID" className="h-5" />
                </div>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                  <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
                    {allLevelsWithCustoms.find(l => l.id === selectedLevel)?.name || fetchedLevelDetails[selectedLevel]?.name || selectedLevel}
                  </h2>
                  <a
                    href={`https://narrowarrow.xyz/levelid=${selectedLevel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs rounded-lg transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                    id={`play-btn-selected-${selectedLevel}`}
                  >
                    <Play className="w-3 h-3 fill-current" /> Play
                  </a>
                </div>
              </div>
            </div>

            <div className="relative z-10 w-full md:w-auto flex flex-col sm:flex-row md:flex-col gap-4 bg-white/[0.02] border border-white/10 rounded-xl p-4 backdrop-blur-md shrink-0">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">Theoretical Max</p>
                  <p className="text-sm font-mono font-bold text-red-400">
                    {theoreticalMax !== null ? formatTime(theoreticalMax, 'seconds') : "---"}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">Human Limit</p>
                  <p className="text-sm font-mono font-bold text-blue-400">
                    {humanLimit !== null ? formatTime(humanLimit, 'seconds') : "---"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Active Players", value: new Set(processedData.map(d => d.username)).size, icon: Users, color: "text-[var(--app-accent)]" },
            { 
              label: "Top Time", 
              value: processedData.length > 0 ? formatTime(processedData[0].completion_time, 'seconds') : "N/A", 
              icon: Trophy, 
              color: "text-yellow-400",
              imgSrc: "https://play.narrowarrow.xyz/assets/assets/images/trophy.svg"
            },
            { label: "Average Time", value: processedData.length > 0 ? formatTime(processedData.reduce((acc, curr) => acc + curr.completion_time, 0) / processedData.length, 'seconds') : "N/A", icon: Target, color: "text-[#2DD4BF]" },
            { label: "Total Time", value: processedData.length > 0 ? formatTime(processedData.reduce((acc, curr) => acc + curr.completion_time, 0), 'minutes') : "N/A", icon: Clock, color: "text-[#6366F1]" },
          ].map((stat, i) => (
            <Card key={i} className="bg-white/5 border-white/10 overflow-hidden group hover:border-white/20 transition-all">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{stat.label}</p>
                  <div className="text-xl md:text-2xl font-mono font-bold text-white">{loading ? <Skeleton className="h-8 w-16 bg-white/10" /> : stat.value}</div>
                </div>
                <div className={cn("w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform", stat.color)}>
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

        {/* Leaderboard Table */}
        <Card className="bg-white/5 border-white/10 overflow-hidden">
          <CardHeader className="border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold text-white">Leaderboard</CardTitle>
                <CardDescription className="text-slate-500 text-xs">
                  Showing rankings for {allLevelsWithCustoms.find(l => l.id === selectedLevel)?.name}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {hasLevelRanks && (
                  <Button
                    onClick={() => setShowRankLegend(true)}
                    variant="outline"
                    size="sm"
                    className="bg-[var(--app-accent)]/10 hover:bg-[var(--app-accent)]/20 text-[var(--app-accent)] border-[var(--app-accent)]/20 text-[10px] h-7 font-bold uppercase tracking-wider px-2.5"
                  >
                    <Trophy className="w-3 h-3 mr-1 fill-current" /> View Ranks
                  </Button>
                )}
                <Badge variant="outline" className="bg-[var(--app-accent)]/10 text-[var(--app-accent)] border-[var(--app-accent)]/20 font-mono text-[10px]">
                  LIVE DATA
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!loading && (theoreticalMax !== null || humanLimit !== null) && (
              <div className="p-4 border-b border-white/10 bg-white/[0.01] flex flex-wrap gap-4 items-center justify-between">
                <div className="flex flex-wrap gap-6">
                  {theoreticalMax !== null && (
                    <div className="flex items-center gap-3">
                      <div className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/30 text-red-400 text-[10px] font-bold uppercase tracking-tighter">Theoretical Max</div>
                      <span className="text-sm font-mono font-bold text-red-400">{formatTime(theoreticalMax, 'seconds')}</span>
                    </div>
                  )}
                  {humanLimit !== null && (
                    <div className="flex items-center gap-3">
                      <div className="px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-400 text-[10px] font-bold uppercase tracking-tighter">Human Limit</div>
                      <span className="text-sm font-mono font-bold text-blue-400">{formatTime(humanLimit, 'seconds')}</span>
                    </div>
                  )}
                </div>
                <div className="text-[9px] text-slate-600 italic flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Note: These values are estimations.
                </div>
              </div>
            )}
            {error ? (
              <div className="p-12 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">Failed to load data</h3>
                <p className="text-slate-400 max-w-md mb-6">{error}</p>
                <Button onClick={() => fetchData(selectedLevel, true)} variant="outline" className="border-white/10 hover:bg-white/5">
                  Try Again
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/[0.02]">
                    <TableRow className="border-white/10 hover:bg-transparent">
                      <TableHead className="w-12 sm:w-16 text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">#</TableHead>
                      <TableHead 
                        className="cursor-pointer hover:text-white transition-colors font-mono text-[10px] uppercase tracking-widest text-slate-500"
                        onClick={() => handleSort('rank')}
                      >
                        <div className="flex items-center gap-2">
                          Player <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead 
                        className="cursor-pointer hover:text-white transition-colors font-mono text-[10px] uppercase tracking-widest text-slate-500"
                        onClick={() => handleSort('completion_time')}
                      >
                        <div className="flex items-center gap-2">
                          Time <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </TableHead>
                      <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">PB-WR</TableHead>
                      <TableHead className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">Compare</TableHead>
                      <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-slate-500">Date</TableHead>
                      {isAdmin && (
                        <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-red-400/70">Remove</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence mode="popLayout">
                      {loading ? (
                        Array.from({ length: 10 }).map((_, i) => (
                          <TableRow key={`skeleton-${i}`} className="border-white/5">
                            <TableCell><Skeleton className="h-4 w-4 bg-white/5 mx-auto" /></TableCell>
                            <TableCell><Skeleton className="h-6 w-32 sm:w-48 bg-white/5" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-12 sm:w-16 bg-white/5" /></TableCell>
                            <TableCell className="text-center"><Skeleton className="h-4 w-12 sm:w-16 bg-white/5 mx-auto" /></TableCell>
                            <TableCell className="text-center"><Skeleton className="h-4 w-8 bg-white/5 mx-auto" /></TableCell>
                            <TableCell className="text-right"><Skeleton className="h-4 w-16 sm:w-20 bg-white/5 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : sortedAndFilteredData.length > 0 ? (
                        sortedAndFilteredData.map((entry, index) => {
                          const wrTime = processedData.length > 0 ? Math.min(...processedData.map(e => e.completion_time)) : entry.completion_time;
                          const pbWrDiff = entry.completion_time - wrTime;
                          const actualRank = entry.originalRank || (index + 1);

                          return (
                            <motion.tr
                              key={entry.run_id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.5) }}
                              className="border-white/5 hover:bg-white/[0.03] transition-colors group"
                            >
                              <TableCell className="text-center font-mono text-slate-500 group-hover:text-white transition-colors">
                                {actualRank}
                              </TableCell>
                              <TableCell 
                                className="cursor-pointer"
                                onClick={() => handlePlayerClick(entry.username)}
                              >
                                <div className="flex items-center gap-2 sm:gap-3">
                                  {hasLevelRanks && (() => {
                                    const rankId = assignRank(entry, activeRankConfig, RANK_ORDER);
                                    const rankInfo = activeRankConfig[rankId] || DEFAULT_RANKS[rankId];
                                    return (
                                      <Badge 
                                        variant="outline" 
                                        className={cn(
                                          "font-bold text-[9px] sm:text-[10px] uppercase tracking-tighter px-1.5 sm:px-2 py-0.5 shrink-0",
                                          rankInfo.bgColor,
                                          rankInfo.color,
                                          rankInfo.borderColor
                                        )}
                                      >
                                        {rankInfo.name}
                                      </Badge>
                                    );
                                  })()}
                                  <ArrowIcon name={entry.arrow_name} className={cn(
                                    "w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0",
                                    entry.arrow_name.toLowerCase().includes("energy") ? "text-[#22c55e]" :
                                    entry.arrow_name.toLowerCase().includes("speedy") ? "text-[#3b82f6]" :
                                    "text-[var(--app-accent)]"
                                  )} />
                                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                    <img 
                                      src="https://play.narrowarrow.xyz/assets/assets/images/account.svg" 
                                      alt="" 
                                      className="w-3 h-3 sm:w-3.5 sm:h-3.5 object-contain opacity-50 group-hover:opacity-100 transition-opacity shrink-0"
                                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                    />
                                    <span className="font-bold text-slate-200 group-hover:text-[var(--app-accent)] transition-colors text-xs sm:text-sm truncate">
                                      {entry.username}
                                    </span>
                                    {entry.isLegacy && (
                                      <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[8px] sm:text-[9px] uppercase font-mono tracking-wider shrink-0 px-1 sm:px-1.5 py-0 select-none">
                                        Legacy
                                      </Badge>
                                    )}
                                    <ExternalLink className="w-2.5 h-2.5 sm:w-3 sm:h-3 opacity-0 group-hover:opacity-50 shrink-0" />
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono font-bold text-[#2DD4BF] text-xs sm:text-sm">
                                {formatTime(entry.completion_time, 'seconds')}
                              </TableCell>
                              <TableCell className="text-center font-mono text-[10px]">
                                {pbWrDiff === 0 ? (
                                  <Badge className="bg-yellow-400/20 text-yellow-400 border-yellow-400/30 text-[9px] py-0 px-1.5">WR</Badge>
                                ) : (
                                  <span className="text-slate-500">+{pbWrDiff.toFixed(3)}s</span>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCompareClick(entry.username);
                                  }}
                                  className="text-slate-500 hover:text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10 h-8 w-8 mx-auto"
                                >
                                  <TrendingUp className="w-4 h-4" />
                                </Button>
                              </TableCell>
                              <TableCell className="text-right text-slate-500 text-xs font-mono">
                                {formatDate(entry.created_at)}
                              </TableCell>
                              {isAdmin && (
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    title="Remove run from leaderboard"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const reason = window.prompt(`Remove ${entry.username}'s ${entry.completion_time}s run?\n\nOptional reason:`, "");
                                      if (reason === null) return;
                                      try {
                                        await removeRun({
                                          levelId: selectedLevel,
                                          username: entry.username,
                                          completionTime: entry.completion_time,
                                          reason,
                                          removedBy: adminUser?.email,
                                        });
                                        toast.success(`Removed ${entry.username}'s run`);
                                      } catch (err) {
                                        console.error("Failed to remove run:", err);
                                        toast.error(err instanceof Error ? err.message : "Failed to remove run.");
                                      }
                                    }}
                                    className="text-slate-600 hover:text-red-400 hover:bg-red-500/10 h-8 w-8"
                                  >
                                    <X className="w-4 h-4" />
                                  </Button>
                                </TableCell>
                              )}

                            </motion.tr>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={8} className="h-32 text-center text-slate-500 italic">
                            No results found matching your search.
                          </TableCell>
                        </TableRow>
                      )}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer Info */}
        {!showAdmin && view === 'leaderboard' && hasLevelRanks && (
          <div className="mt-8 border-t border-white/5 pt-6 text-slate-500 text-xs leading-relaxed max-w-2xl">
            <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-2">About the Rankings</h4>
            <p>
              NA Rankings is a community-driven project to track the best times across all levels in Narrow Arrow. 
              Ranks are calculated based on specific time cutoffs defined for each map. Click the <strong>View Ranks</strong> button above the leaderboard to inspect the cutoff requirements.
            </p>
          </div>
        )}

        {/* Rank Requirements Modal Overlay */}
        <AnimatePresence>
          {showRankLegend && hasLevelRanks && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0" onClick={() => setShowRankLegend(false)} />
              
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="bg-[#121212] border border-white/10 rounded-xl w-full max-w-md overflow-hidden shadow-2xl relative z-10"
              >
                <div className="p-4 border-b border-white/10 bg-white/[0.02] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white">
                    <Trophy className="w-5 h-5 text-amber-500 fill-current" />
                    <h3 className="font-bold text-sm uppercase tracking-wider font-mono">Rank Requirements</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowRankLegend(false)}
                    className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="p-4">
                  <p className="text-xs text-slate-400 mb-4">
                    Earn badges by completing the level <strong>{allLevelsWithCustoms.find(l => l.id === selectedLevel)?.name}</strong> below these target times:
                  </p>
                  
                  <div className="border border-white/5 rounded-lg overflow-hidden bg-black/20">
                    <Table>
                      <TableHeader className="bg-white/[0.02]">
                        <TableRow className="border-white/5 hover:bg-transparent h-8">
                          <TableHead className="font-mono text-[9px] uppercase tracking-widest text-slate-500 h-8 pl-4">Rank Badge</TableHead>
                          <TableHead className="text-right font-mono text-[9px] uppercase tracking-widest text-slate-500 h-8 pr-4">Target Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {RANK_ORDER.map(rankId => {
                          const r = activeRankConfig[rankId] || DEFAULT_RANKS[rankId];
                          return (
                            <TableRow key={rankId} className="border-white/5 hover:bg-white/[0.01] h-9">
                              <TableCell className="py-1 pl-4">
                                <Badge 
                                  variant="outline" 
                                  className={cn(
                                    "text-[9px] font-bold uppercase tracking-tighter px-2.5 py-0.5",
                                    r.bgColor,
                                    r.color,
                                    r.borderColor
                                  )}
                                >
                                  {r.name}
                                </Badge>
                              </TableCell>
                              <TableCell className={cn("text-right font-mono text-[11px] font-bold py-1 pr-4", r.color)}>
                                {!hasLevelRanks ? "---" : (r.timeCutoff >= 9999 ? "None (Uncapped)" : `< ${r.timeCutoff.toFixed(3)}s`)}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                
                <div className="p-3 bg-white/[0.02] border-t border-white/10 text-center">
                  <Button
                    onClick={() => setShowRankLegend(false)}
                    className="bg-[var(--app-accent)] hover:bg-[var(--app-accent)]/90 text-slate-950 font-bold text-xs uppercase tracking-wider py-1.5 h-8 px-6"
                  >
                    Got it!
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
          </>
        )}
      </main>
    </div>
  );
}
