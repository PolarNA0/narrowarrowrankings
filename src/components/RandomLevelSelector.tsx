import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Dices, Check, X, ShieldAlert, Trophy, ArrowRight, RefreshCw, 
  Volume2, VolumeX, ChevronDown, Play, Sparkles, Heart, ExternalLink, 
  Star, Globe 
} from "lucide-react";
import { LevelPack, LevelInfo } from "../types";
import { capitalizeName } from "@/lib/utils";
import { ClickToCopy } from "./ClickToCopy";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface RandomLevelSelectorProps {
  packs: LevelPack[];
  levels: LevelInfo[];
  onSelectLevel: (levelId: string) => void;
  onSelectCustomLevel?: (levelId: string) => void;
  onBack: () => void;
}

export function RandomLevelSelector({ packs, levels, onSelectLevel, onSelectCustomLevel, onBack }: RandomLevelSelectorProps) {
  // Mode selection: 'campaign' (official levels wheel) or 'custom' (random custom level)
  const [randomizerMode, setRandomizerMode] = useState<'campaign' | 'custom'>('campaign');

  // Custom levels randomizer state
  const [customFilter, setCustomFilter] = useState<'discover' | 'popular' | 'new'>('discover');
  const [isRollingCustom, setIsRollingCustom] = useState(false);
  const [selectedCustomLevel, setSelectedCustomLevel] = useState<any | null>(null);
  const [customRollError, setCustomRollError] = useState<string | null>(null);

  // Inline Custom Leaderboard states
  const [showCustomLb, setShowCustomLb] = useState(false);
  const [customLbEntries, setCustomLbEntries] = useState<any[]>([]);
  const [customLbLoading, setCustomLbLoading] = useState(false);
  const [customLbError, setCustomLbError] = useState<string | null>(null);

  useEffect(() => {
    if (!showCustomLb || !selectedCustomLevel) {
      setCustomLbEntries([]);
      return;
    }
    
    const levelId = selectedCustomLevel.level_id || selectedCustomLevel.id || selectedCustomLevel.levelKey || selectedCustomLevel.levelId;
    if (!levelId) return;

    const fetchCustomLb = async () => {
      setCustomLbLoading(true);
      setCustomLbError(null);
      try {
        const response = await fetch(`/api/leaderboard/${encodeURIComponent(levelId)}?infiniteLeaderboard=true`);
        if (!response.ok) throw new Error("Failed to load leaderboard");
        const data = await response.json();
        setCustomLbEntries(Array.isArray(data) ? data : []);
      } catch (err: any) {
        setCustomLbError("Unable to retrieve leaderboard records.");
        console.error(err);
      } finally {
        setCustomLbLoading(false);
      }
    };

    fetchCustomLb();
  }, [showCustomLb, selectedCustomLevel]);

  const handleRollCustom = async () => {
    setIsRollingCustom(true);
    setCustomRollError(null);
    setSelectedCustomLevel(null);
    setShowCustomLb(false); // reset on roll
    
    try {
      // Pick a random page between 0 and 15 for variety
      const randomPage = Math.floor(Math.random() * 16);
      const url = `/api/published-levels?filter=${customFilter}&page=${randomPage}`;
      
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Failed to fetch custom levels from the API.");
      }
      
      const data = await res.json();
      let levelsList = data ? (Array.isArray(data) ? data : (data.levels || data.results || [])) : [];
      
      // If the page was empty and we were on page > 0, try page 0 as fallback
      if (levelsList.length === 0 && randomPage > 0) {
        const fallbackRes = await fetch(`/api/published-levels?filter=${customFilter}&page=0`);
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          levelsList = fallbackData ? (Array.isArray(fallbackData) ? fallbackData : (fallbackData.levels || fallbackData.results || [])) : [];
        }
      }
      
      if (levelsList.length === 0) {
        throw new Error("No custom levels found in this category.");
      }
      
      // Pick a random level from the list
      const randomItem = levelsList[Math.floor(Math.random() * levelsList.length)];
      const levelId = randomItem.level_id || randomItem.id || randomItem.levelKey || randomItem.levelId || "";
      
      if (!levelId) {
        throw new Error("Invalid level ID encountered.");
      }
      
      // Fetch full details for the chosen level to get the highest resolution stats!
      const detailRes = await fetch(`/api/level-details/${encodeURIComponent(levelId)}`);
      if (detailRes.ok) {
        const detailData = await detailRes.json();
        
        // Merge the original random item with the detailed response, ensuring all forms of properties are resolved
        const mergedObj = {
          ...randomItem,
          ...detailData,
          level_id: levelId,
          id: levelId,
          levelId: levelId,
          levelKey: levelId,
          name: detailData.name || detailData.level?.name || detailData.title || detailData.level?.title || detailData.data?.map_name || detailData.data?.name || randomItem.name || randomItem.title || "Untitled Level",
          creator_name: detailData.creator_name || detailData.level?.creator_name || detailData.author || detailData.level?.author || detailData.username || detailData.level?.username || randomItem.creator_name || randomItem.author || randomItem.username || "Unknown",
          plays: detailData.plays ?? detailData.level?.plays ?? detailData.totalPlays ?? detailData.total_plays ?? randomItem.plays ?? randomItem.totalPlays ?? randomItem.playCount ?? 0,
          likes: detailData.likes ?? detailData.level?.likes ?? detailData.totalLikes ?? detailData.total_likes ?? randomItem.likes ?? randomItem.totalLikes ?? randomItem.likeCount ?? 0,
          worldRecord: detailData.worldRecord || detailData.level?.worldRecord || randomItem.worldRecord || null,
          // Support any component checking for .level nested object
          level: {
            ...randomItem,
            ...(detailData.level || {}),
            id: levelId,
            level_id: levelId
          }
        };
        setSelectedCustomLevel(mergedObj);
      } else {
        // Fallback if detail fetch fails
        const fallbackObj = {
          ...randomItem,
          level_id: levelId,
          id: levelId,
          levelId: levelId,
          levelKey: levelId,
          name: randomItem.name || randomItem.title || "Untitled Level",
          creator_name: randomItem.creator_name || randomItem.author || randomItem.username || "Unknown",
          plays: randomItem.plays ?? randomItem.totalPlays ?? randomItem.playCount ?? 0,
          likes: randomItem.likes ?? randomItem.totalLikes ?? randomItem.likeCount ?? 0,
          level: {
            ...randomItem,
            id: levelId,
            level_id: levelId
          }
        };
        setSelectedCustomLevel(fallbackObj);
      }
    } catch (err: any) {
      console.error("Error rolling custom level:", err);
      setCustomRollError(err.message || "Failed to retrieve a random custom level. Please try again.");
    } finally {
      setIsRollingCustom(false);
    }
  };

  // Map individual level inclusion states
  const [selectedLevelIds, setSelectedLevelIds] = useState<Record<string, boolean>>({});
  const [expandedPacks, setExpandedPacks] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Initialize with all levels selected and packs expanded
  useEffect(() => {
    if (levels.length > 0 && Object.keys(selectedLevelIds).length === 0) {
      const initial: Record<string, boolean> = {};
      levels.forEach(l => {
        initial[l.id] = true;
      });
      setSelectedLevelIds(initial);

      // Expand first couple packs by default for quick view
      const expanded: Record<string, boolean> = {};
      packs.forEach((p, idx) => {
        if (idx < 2) {
          expanded[p.id] = true;
        }
      });
      setExpandedPacks(expanded);
    }
  }, [levels, packs]);

  // Helper to check pack selection status: 'all', 'some', 'none'
  const getPackSelectionStatus = (packId: string) => {
    const packLevels = levels.filter(l => l.packId === packId);
    if (packLevels.length === 0) return 'none';
    const selectedCount = packLevels.filter(l => selectedLevelIds[l.id]).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === packLevels.length) return 'all';
    return 'some';
  };

  const togglePack = (packId: string) => {
    const packLevels = levels.filter(l => l.packId === packId);
    const status = getPackSelectionStatus(packId);
    const targetValue = status !== 'all'; // Select all if not currently 'all' selected
    setSelectedLevelIds(prev => {
      const next = { ...prev };
      packLevels.forEach(l => {
        next[l.id] = targetValue;
      });
      return next;
    });
  };

  const togglePackExpanded = (packId: string) => {
    setExpandedPacks(prev => ({
      ...prev,
      [packId]: !prev[packId]
    }));
  };

  const selectAll = () => {
    const next: Record<string, boolean> = {};
    levels.forEach(l => {
      next[l.id] = true;
    });
    setSelectedLevelIds(next);
  };

  const deselectAll = () => {
    const next: Record<string, boolean> = {};
    levels.forEach(l => {
      next[l.id] = false;
    });
    setSelectedLevelIds(next);
  };

  // Filtered levels active in the pool
  const filteredLevels = useMemo(() => {
    return levels.filter(l => selectedLevelIds[l.id]);
  }, [levels, selectedLevelIds]);

  // Audio synthesis for the wheel tick sound
  const playTickSound = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);

      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      // Audio context might be blocked by browser policy until user gesture
    }
  };

  // Spinning states
  const [isSpinning, setIsSpinning] = useState(false);
  const [wheelLevels, setWheelLevels] = useState<LevelInfo[]>([]);
  const [rotation, setRotation] = useState(0);
  const [winningLevel, setWinningLevel] = useState<LevelInfo | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Lock the active wheel levels during spin, otherwise reflect real-time active selections
  const currentWheelLevels = useMemo(() => {
    if (isSpinning) {
      return wheelLevels;
    }
    return filteredLevels;
  }, [isSpinning, wheelLevels, filteredLevels]);

  const wheelItemCount = currentWheelLevels.length;

  const handleSpin = () => {
    if (isSpinning || filteredLevels.length === 0) return;

    // Snapshot current active levels pool
    const currentPool = [...filteredLevels];
    setWheelLevels(currentPool);
    setIsSpinning(true);
    setShowResult(false);
    setWinningLevel(null);

    // Pick a final winning level
    const winnerIndex = Math.floor(Math.random() * currentPool.length);
    const winner = currentPool[winnerIndex];

    // Align the middle of the selected segment with the top pointer (0 degrees in rotated coordinates)
    const segmentAngle = 360 / currentPool.length;
    const extraSpins = 5 + Math.floor(Math.random() * 3); // 5 to 7 full spins
    const targetRotation = rotation + (extraSpins * 360) + (360 - (winnerIndex * segmentAngle + segmentAngle / 2));

    setRotation(targetRotation);

    // Sound ticking simulation
    let ticksPlayed = 0;
    const totalDuration = 4000;
    const maxTicks = Math.min(50, currentPool.length * 2);

    const playTicks = (currentTick: number) => {
      if (currentTick >= maxTicks) return;
      const progress = currentTick / maxTicks;
      const delay = 40 + Math.pow(progress, 3.5) * 800;

      setTimeout(() => {
        playTickSound();
        playTicks(currentTick + 1);
      }, delay);
    };

    playTicks(0);

    // Wait for spin animation
    setTimeout(() => {
      setIsSpinning(false);
      setWinningLevel(winner);
      setShowResult(true);
    }, totalDuration);
  };

  // Color palette for wheel slices - beautiful neon-glowing color progression
  const sliceColors = [
    "#38BDF8", // Sky Blue
    "#22c55e", // Emerald Green
    "#3b82f6", // Neon Blue
    "#eab308", // Golden Yellow
    "#ec4899", // Magenta Pink
    "#f97316", // Bright Orange
    "#14b8a6", // Teal
    "#a855f7", // Deep Purple
    "#ef4444", // Ruby Red
  ];

  // Responsive font size and text rendering for dense segments
  const getSliceFontSize = (name: string) => {
    const L = name.length || 1;
    const angle = 360 / (wheelItemCount || 1);
    const halfAngleRad = (angle / 2) * Math.PI / 180;
    
    // Safety multiplier on the wedge width to avoid touching outer boundaries
    const safety = 0.78;
    const S = 2 * Math.sin(halfAngleRad) * safety;
    
    // Radial fit constraint: assuming average character width is 0.5 * fontSize
    const charWidth = 0.5;
    
    // Wedge height constraint solved formula:
    // fontSize <= (180 * S) / (1 + charWidth * L * S)
    const wedgeLimit = (180 * S) / (1 + charWidth * L * S);
    
    // Length limit: text must fit inside the outer edge (180 radius) and not cross inner hub (35 radius)
    // L * charWidth * fontSize <= 180 - 35 = 145 => fontSize <= 145 / (L * charWidth)
    const lengthLimit = 145 / (L * charWidth);
    
    // Set a gorgeous maximum font size when there are few items on the wheel
    const maxFontSize = wheelItemCount <= 6 ? 24 : (wheelItemCount <= 12 ? 20 : 16);
    
    // Minimum font size so it remains legible
    const minFontSize = 4.0;
    
    const calculated = Math.min(maxFontSize, wedgeLimit, lengthLimit);
    return Math.max(minFontSize, calculated);
  };

  const getSliceText = (level: LevelInfo) => {
    const name = level.name;
    const maxLen = wheelItemCount <= 6 ? 24 : (wheelItemCount <= 12 ? 18 : 14);
    if (name.length > maxLen) {
      return name.slice(0, maxLen - 2) + "..";
    }
    return name;
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/20 flex items-center justify-center text-[var(--app-accent)]">
            <Dices className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Random Level Generator</h1>
            <p className="text-slate-400 text-xs font-medium">Configure individual level pools and spin the wheel of fortune!</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="border-white/10 bg-white/5 text-slate-300 hover:text-white"
            title={soundEnabled ? "Disable Sound" : "Enable Sound"}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          </Button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="flex border border-white/10 p-1 bg-white/5 rounded-xl max-w-md">
        <button
          onClick={() => setRandomizerMode('campaign')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            randomizerMode === 'campaign'
              ? "bg-[var(--app-accent)] text-slate-950 font-black shadow-md"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Dices className="w-4 h-4" />
          Officials
        </button>
        <button
          onClick={() => setRandomizerMode('custom')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
            randomizerMode === 'custom'
              ? "bg-[#2DD4BF] text-slate-950 font-black shadow-md"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Custom Levels
        </button>
      </div>

      {randomizerMode === 'campaign' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Side: Pool Configurator */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="bg-white/5 border-white/10">
              <CardHeader className="p-4 border-b border-white/10 flex flex-col gap-3 bg-white/[0.01]">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold text-white">Configure Pool</CardTitle>
                    <CardDescription className="text-[11px] text-slate-500 mt-0.5">Select packs or single levels</CardDescription>
                  </div>
                  <div className="flex gap-2 text-[10px]">
                    <button onClick={selectAll} className="text-[var(--app-accent)] hover:underline font-bold">All</button>
                    <span className="text-slate-600">|</span>
                    <button onClick={deselectAll} className="text-slate-400 hover:underline">None</button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search levels..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[var(--app-accent)]/50 transition-colors"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-4 max-h-[420px] overflow-y-auto space-y-2">
                {searchQuery ? (
                  /* Flat search result view */
                  <div className="space-y-1.5">
                    {levels.filter(l => l.name.toLowerCase().includes(searchQuery.toLowerCase())).map(level => {
                      const isLevelSelected = !!selectedLevelIds[level.id];
                      const packName = packs.find(p => p.id === level.packId)?.name || capitalizeName(level.packId);
                      return (
                        <button
                          key={level.id}
                          onClick={() => {
                            setSelectedLevelIds(prev => ({
                              ...prev,
                              [level.id]: !prev[level.id]
                            }));
                          }}
                          className="w-full flex items-center justify-between p-2 rounded-lg border text-left text-xs transition-all bg-white/5 border-white/5 text-slate-300 hover:bg-white/[0.08]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all shrink-0 ${
                              isLevelSelected ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-white" : "border-slate-600 bg-transparent"
                            }`}>
                              {isLevelSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold truncate text-white">{level.name}</div>
                              <div className="text-[9px] text-slate-500 truncate">{packName}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* Grouped collapsible pack view */
                  packs.map(pack => {
                    const packLevels = levels.filter(l => l.packId === pack.id);
                    if (packLevels.length === 0) return null;
                    const status = getPackSelectionStatus(pack.id);
                    const isExpanded = !!expandedPacks[pack.id];
                    const countSelected = packLevels.filter(l => selectedLevelIds[l.id]).length;

                    return (
                      <div key={pack.id} className="border border-white/5 rounded-lg overflow-hidden bg-white/[0.01]">
                        {/* Pack Header Row */}
                        <div className="flex items-center justify-between p-2.5 hover:bg-white/[0.02] transition-colors">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <button
                              onClick={() => togglePack(pack.id)}
                              className="flex items-center justify-center shrink-0"
                            >
                              <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                                status === 'all' ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-white" :
                                status === 'some' ? "bg-[var(--app-accent)]/35 border-[var(--app-accent)] text-white" :
                                "border-slate-500 bg-transparent"
                              }`}>
                                {status === 'all' && <Check className="w-3 h-3 stroke-[3]" />}
                                {status === 'some' && <div className="w-1.5 h-0.5 bg-white rounded-full"></div>}
                              </div>
                            </button>
                            <span className="text-xs font-bold text-slate-200 truncate">{pack.name}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <Badge variant="outline" className={`font-mono text-[9px] px-1.5 py-0 ${
                              status !== 'none' ? "border-[var(--app-accent)]/30 text-[var(--app-accent)]" : "border-white/5 text-slate-500"
                            }`}>
                              {countSelected}/{packLevels.length}
                            </Badge>
                            <button
                              onClick={() => togglePackExpanded(pack.id)}
                              className="p-1 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                            >
                              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                            </button>
                          </div>
                        </div>

                        {/* Expanded Pack Levels list */}
                        {isExpanded && (
                          <div className="border-t border-white/5 bg-black/15 px-3 py-1.5 space-y-1.5 max-h-[200px] overflow-y-auto">
                            {packLevels.map(level => {
                              const isLevelSelected = !!selectedLevelIds[level.id];
                              return (
                                <button
                                  key={level.id}
                                  onClick={() => {
                                    setSelectedLevelIds(prev => ({
                                      ...prev,
                                      [level.id]: !prev[level.id]
                                    }));
                                  }}
                                  className="w-full flex items-center gap-2.5 py-1 px-1.5 rounded hover:bg-white/5 text-left text-[11px] text-slate-300 hover:text-white transition-all"
                                >
                                  <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                                    isLevelSelected ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-white" : "border-slate-600 bg-transparent"
                                  }`}>
                                    {isLevelSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                  </div>
                                  <span className="truncate flex-1 font-medium">{level.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card className="bg-white/5 border-white/10 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Active Pool Size</p>
                  <p className="text-xl font-mono font-bold text-white mt-1">
                    {filteredLevels.length} <span className="text-xs text-slate-500 font-normal">levels active</span>
                  </p>
                </div>
                <Dices className="w-8 h-8 text-[var(--app-accent)]/20" />
              </div>
            </Card>
          </div>

          {/* Right Side: Dynamic Wheel & Result View */}
          <div className="lg:col-span-8 flex flex-col items-center justify-center min-h-[460px] sm:min-h-[500px] bg-white/[0.02] border border-white/10 rounded-2xl p-3 sm:p-8 relative overflow-hidden">
            {/* Backdrop Radial Glowing Effects */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-[var(--app-accent)]/10 rounded-full blur-[100px] pointer-events-none z-0"></div>

            {filteredLevels.length === 0 ? (
              <div className="relative z-10 flex flex-col items-center justify-center text-center max-w-md">
                <ShieldAlert className="w-16 h-16 text-yellow-500/80 mb-4 animate-bounce" />
                <h3 className="text-lg font-bold text-white mb-2">No levels in pool</h3>
                <p className="text-slate-400 text-sm">
                  Please select at least one level or map pack on the left panel to populate the wheel.
                </p>
              </div>
            ) : (
              <div className="relative z-10 w-full flex flex-col items-center justify-center">
                {/* Wheel Container */}
                <div className="relative w-[280px] h-[280px] min-[370px]:w-[320px] min-[370px]:h-[320px] sm:w-[420px] sm:h-[420px] md:w-[480px] md:h-[480px] mb-8 select-none">
                  {/* Pointer (Ticker) at the very top */}
                  <div className="absolute top-[-10px] left-1/2 -translate-x-1/2 z-30 drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]">
                    <div className="w-0 h-0 border-l-[14px] border-r-[14px] border-t-[28px] border-l-transparent border-r-transparent border-t-red-500 animate-pulse"></div>
                    <div className="w-2.5 h-2.5 rounded-full bg-white absolute top-[2px] left-1/2 -translate-x-1/2 shadow-inner"></div>
                  </div>

                  {/* Animated Rotating Wheel Canvas */}
                  <motion.div
                    className="w-full h-full rounded-full border-[8px] border-[#1d1d1f] shadow-[0_15px_50px_rgba(0,0,0,0.8),_0_0_30px_rgba(56,189,248,0.2)] bg-[#111112] overflow-hidden relative"
                    animate={{ rotate: rotation }}
                    transition={{
                      duration: isSpinning ? 4 : 0,
                      ease: [0.1, 0.8, 0.3, 1]
                    }}
                  >
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 400 400">
                      <defs>
                        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
                          <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.5"/>
                        </filter>
                      </defs>
                      
                      {/* Slices of the wheel (dynamic matching 1:1 with pool) */}
                      {currentWheelLevels.map((level, i) => {
                        const angle = 360 / (wheelItemCount || 1);
                        const startAngle = i * angle;
                        const endAngle = (i + 1) * angle;

                        // Calculate SVG arc paths
                        const rad = Math.PI / 180;
                        const x1 = 200 + 200 * Math.cos(startAngle * rad);
                        const y1 = 200 + 200 * Math.sin(startAngle * rad);
                        const x2 = 200 + 200 * Math.cos(endAngle * rad);
                        const y2 = 200 + 200 * Math.sin(endAngle * rad);

                        const sliceColor = sliceColors[i % sliceColors.length];
                        const labelText = getSliceText(level);
                        const sliceFontSize = getSliceFontSize(labelText);

                        return (
                          <g key={`${level.id}-${i}`} className="group cursor-pointer">
                            {/* Segment Wedge */}
                            <path
                              d={`M 200 200 L ${x1} ${y1} A 200 200 0 0 1 ${x2} ${y2} Z`}
                              fill={sliceColor}
                              opacity={isSpinning ? 0.9 : 0.85}
                              className="transition-opacity hover:opacity-100"
                              stroke="#111"
                              strokeWidth="0.5"
                            />
                            {/* Dynamic SVG rotated text labels */}
                            {labelText && (
                              <text
                                x="380"
                                y="200"
                                dominantBaseline="middle"
                                transform={`rotate(${startAngle + angle / 2} 200 200)`}
                                fill="white"
                                fontSize={sliceFontSize}
                                fontWeight="800"
                                textAnchor="end"
                                filter="url(#shadow)"
                                letterSpacing="-0.15"
                                className="pointer-events-none uppercase tracking-tighter"
                              >
                                {labelText}
                              </text>
                            )}
                          </g>
                        );
                      })}
                      {/* Inner core hub */}
                      <circle cx="200" cy="200" r="32" fill="#18181b" stroke="#333" strokeWidth="2" />
                      <circle cx="200" cy="200" r="20" fill="#38BDF8" opacity="0.15" />
                    </svg>
                  </motion.div>
    
                  {/* Spin Button in Center */}
                  <button
                    onClick={handleSpin}
                    disabled={isSpinning}
                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 min-[370px]:w-20 min-[370px]:h-20 rounded-full flex items-center justify-center font-extrabold text-[10px] min-[370px]:text-xs uppercase tracking-wider transition-all z-20 shadow-xl ${
                      isSpinning
                        ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed scale-95"
                        : "bg-[var(--app-accent)] text-white border-2 border-white/20 hover:scale-105 active:scale-95 hover:shadow-[0_0_20px_rgba(56,189,248,0.6)]"
                    }`}
                  >
                    {isSpinning ? "Spin" : "SPIN"}
                  </button>
                </div>

                {/* Winner Result Modal */}
                <AnimatePresence>
                  {showResult && winningLevel && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: 15 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -15 }}
                      className="w-full max-w-md bg-gradient-to-b from-[#1c1c1e] to-[#121214] border border-[var(--app-accent)]/30 rounded-2xl p-5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] text-center relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.15),_transparent_70%)] pointer-events-none"></div>

                      <div className="inline-flex items-center gap-1 bg-[var(--app-accent)]/10 text-[var(--app-accent)] border border-[var(--app-accent)]/20 text-[10px] font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-full mb-3.5 shadow-sm">
                        <Trophy className="w-3 h-3" /> Selected Level
                      </div>

                      <div className="flex items-center gap-4 text-left bg-white/[0.02] border border-white/5 rounded-xl p-3.5 mb-5 group">
                        <img
                          src={`https://api.narrowarrow.xyz/level-image/${winningLevel.id}.png`}
                          referrerPolicy="no-referrer"
                          alt={winningLevel.name}
                          className="w-16 h-16 rounded-lg object-cover border border-white/10 shadow-md bg-black/40 group-hover:scale-105 transition-transform"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-[9px] uppercase font-bold tracking-widest text-[var(--app-accent)]">
                            {packs.find(p => p.id === winningLevel.packId)?.name || capitalizeName(winningLevel.packId)}
                          </span>
                          <h4 className="text-lg font-bold text-white tracking-tight mt-0.5 truncate">{winningLevel.name}</h4>
                          <div className="flex gap-2 items-center mt-1 text-[10px] font-mono text-slate-500">
                            <span>ID: {winningLevel.id}</span>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <Button
                            onClick={() => onSelectLevel(winningLevel.id)}
                            className="flex-1 bg-[var(--app-accent)] hover:bg-[#0284c7] text-white font-bold text-xs"
                          >
                            Leaderboard <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                          </Button>
                          <a
                            href={`https://narrowarrow.xyz/levelid=${winningLevel.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs px-3 py-2 rounded-md transition-colors shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                            id={`play-btn-random-result-${winningLevel.id}`}
                          >
                            <Play className="w-3.5 h-3.5 fill-current" /> Play Level
                          </a>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={handleSpin}
                            variant="outline"
                            className="flex-1 border-white/10 text-white bg-white/5 hover:bg-white/10 text-xs"
                          >
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Roll Again
                          </Button>
                          <Button
                            onClick={() => {
                              if (winningLevel) {
                                setSelectedLevelIds(prev => ({
                                  ...prev,
                                  [winningLevel.id]: false
                                }));
                                setWinningLevel(null);
                                setShowResult(false);
                              }
                            }}
                            variant="outline"
                            className="flex-1 border-red-500/20 text-red-400 bg-red-500/5 hover:bg-red-500/10 hover:text-red-300 text-xs font-bold"
                          >
                            <X className="w-3.5 h-3.5 mr-1.5" /> Remove from Pool
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Custom levels randomizer */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Left Side: Custom Configurator */}
          <div className="lg:col-span-4 space-y-6">
            <Card className="bg-white/5 border-white/10">
              <CardHeader className="p-4 border-b border-white/10 bg-white/[0.01]">
                <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
                  <Globe className="w-4 h-4 text-teal-400" />
                  Custom Randomizer Pool
                </CardTitle>
                <CardDescription className="text-[11px] text-slate-500 mt-0.5">
                  Select a category to draw random levels from
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Category</label>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { id: 'discover', label: 'Discover Feed', desc: 'Curated/trending custom levels' },
                      { id: 'popular', label: 'Most Popular', desc: 'Highest plays and likes' },
                      { id: 'new', label: 'Newest Releases', desc: 'Recently published by creators' }
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setCustomFilter(opt.id as any)}
                        className={`flex flex-col text-left p-3 rounded-lg border transition-all ${
                          customFilter === opt.id
                            ? "bg-teal-500/10 border-teal-400/50 text-white"
                            : "bg-white/5 border-white/5 text-slate-300 hover:bg-white/[0.08]"
                        }`}
                      >
                        <span className={`text-xs font-bold ${customFilter === opt.id ? "text-teal-400" : "text-white"}`}>
                          {opt.label}
                        </span>
                        <span className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={handleRollCustom}
                    disabled={isRollingCustom}
                    className="w-full bg-[#2DD4BF] hover:bg-[#14b8a6] text-slate-950 font-extrabold shadow-lg shadow-teal-500/20 py-5 text-sm"
                  >
                    {isRollingCustom ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Rolling...
                      </>
                    ) : (
                      <>
                        <Dices className="w-4 h-4 mr-2" />
                        Roll Custom Level
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/5 border-white/10 p-4">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-400 space-y-1">
                  <p className="font-bold text-slate-300">How it works</p>
                  <p>Our generator queries the live custom levels database, selects a random page, and chooses a random creation from other players.</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Side: Results Panel */}
          <div className="lg:col-span-8 flex flex-col items-center justify-center min-h-[460px] bg-white/[0.02] border border-white/10 rounded-2xl p-4 sm:p-8 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-teal-500/5 rounded-full blur-[100px] pointer-events-none z-0"></div>

            <div className="relative z-10 w-full flex flex-col items-center justify-center">
              {isRollingCustom ? (
                /* Beautiful loading state */
                <div className="flex flex-col items-center justify-center text-center py-16 space-y-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-teal-500/20 border border-teal-400/40 flex items-center justify-center text-teal-400 animate-pulse">
                      <RefreshCw className="w-8 h-8 animate-spin" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-teal-400 animate-ping"></div>
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Searching Database...</h3>
                    <p className="text-slate-500 text-xs mt-1 font-mono">Fetching a level from {customFilter} catalog...</p>
                  </div>
                </div>
              ) : customRollError ? (
                /* Error state */
                <div className="flex flex-col items-center justify-center text-center max-w-md py-12 space-y-4">
                  <ShieldAlert className="w-12 h-12 text-red-500" />
                  <div>
                    <h4 className="text-sm font-bold text-white">Rolling Failed</h4>
                    <p className="text-slate-400 text-xs mt-1">{customRollError}</p>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={handleRollCustom}
                    className="border-white/10 text-white hover:bg-white/5"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-2" /> Retry Roll
                  </Button>
                </div>
              ) : selectedCustomLevel ? (
                /* Rolled Level Card Display */
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="w-full max-w-lg bg-gradient-to-b from-[#1c1c1e] to-[#121214] border border-teal-500/30 rounded-2xl shadow-[0_15px_40px_rgba(0,0,0,0.5)] overflow-hidden"
                >
                  {/* Image Preview Header */}
                  <div className="relative h-48 bg-black/60 border-b border-white/5">
                    <img 
                      src={`https://api.narrowarrow.xyz/level-image/${selectedCustomLevel.level_id || selectedCustomLevel.id || selectedCustomLevel.levelKey || selectedCustomLevel.levelId}.png`}
                      referrerPolicy="no-referrer"
                      alt={selectedCustomLevel.name || selectedCustomLevel.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "https://play.narrowarrow.xyz/assets/assets/images/placeholder_level.png";
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
                    <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                      <div>
                        <ClickToCopy text={selectedCustomLevel.level_id || selectedCustomLevel.id || selectedCustomLevel.levelKey || selectedCustomLevel.levelId} label="ID" className="text-teal-400 bg-teal-400/15 border border-teal-400/20" />
                        <h3 className="text-xl font-extrabold text-white tracking-tight mt-1.5">
                          {selectedCustomLevel.name || selectedCustomLevel.title || selectedCustomLevel.data?.map_name || selectedCustomLevel.data?.name || "Untitled Level"}
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-5">
                    {showCustomLb ? (
                      /* Custom Level Leaderboard Content */
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-white/5 pb-2">
                          <h4 className="text-xs font-extrabold uppercase tracking-widest text-[#2DD4BF] flex items-center gap-1.5">
                            <Trophy className="w-3.5 h-3.5 text-amber-400" /> Top Speedruns
                          </h4>
                          <span className="text-[10px] text-slate-500 font-mono">({customLbEntries.length} runs)</span>
                        </div>

                        {customLbLoading ? (
                          <div className="flex flex-col items-center justify-center py-10 space-y-2">
                            <RefreshCw className="w-6 h-6 text-[#2DD4BF] animate-spin" />
                            <p className="text-xs text-slate-400 font-medium">Retrieving leaderboard...</p>
                          </div>
                        ) : customLbError ? (
                          <div className="text-center py-8 text-red-400 text-xs font-semibold">{customLbError}</div>
                        ) : customLbEntries.length === 0 ? (
                          <div className="text-center py-8 text-slate-500 text-xs font-medium">No speedruns recorded yet on this custom level.</div>
                        ) : (
                          <div className="max-h-60 overflow-y-auto border border-white/5 rounded-lg bg-black/20">
                            <Table>
                              <TableHeader className="bg-white/[0.01]">
                                <TableRow className="border-white/5 hover:bg-transparent">
                                  <TableHead className="w-10 text-center font-mono text-[9px] uppercase text-slate-500 py-2">#</TableHead>
                                  <TableHead className="font-mono text-[9px] uppercase text-slate-500 py-2">Player</TableHead>
                                  <TableHead className="font-mono text-[9px] uppercase text-slate-500 text-right py-2">Time</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {customLbEntries.slice(0, 50).map((entry, index) => (
                                  <TableRow key={entry.run_id || index} className="border-white/5 hover:bg-white/[0.02]">
                                    <TableCell className="text-center font-mono text-xs text-slate-500 py-2">{index + 1}</TableCell>
                                    <TableCell className="font-semibold text-xs text-slate-300 py-2 truncate max-w-[120px]">{entry.username}</TableCell>
                                    <TableCell className="font-mono text-xs text-teal-400 text-right font-bold py-2">{entry.completion_time.toFixed(3)}s</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Creator & World Record info block */
                      <>
                        <div className="flex items-center justify-between border-b border-white/5 pb-3">
                          <div>
                            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Designer</p>
                            <p className="text-sm text-slate-200 font-semibold mt-0.5">
                              {selectedCustomLevel.creator_name || selectedCustomLevel.author || selectedCustomLevel.username || selectedCustomLevel.data?.creator_name || selectedCustomLevel.creator?.username || "Unknown"}
                            </p>
                          </div>
                          <div className="flex gap-4">
                            <div className="text-right">
                              <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Plays</p>
                              <p className="text-xs font-mono font-bold text-slate-300 mt-0.5">
                                {(selectedCustomLevel.plays ?? selectedCustomLevel.totalPlays ?? selectedCustomLevel.total_plays ?? selectedCustomLevel.playCount ?? selectedCustomLevel.play_count ?? 0).toLocaleString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Likes</p>
                              <p className="text-xs font-mono font-bold text-amber-400 mt-0.5 flex items-center justify-end gap-1">
                                <Heart className="w-3 h-3 text-rose-500 fill-current" />
                                {(selectedCustomLevel.likes ?? selectedCustomLevel.totalLikes ?? selectedCustomLevel.total_likes ?? selectedCustomLevel.likeCount ?? selectedCustomLevel.like_count ?? 0).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>

                        {selectedCustomLevel.worldRecord && typeof selectedCustomLevel.worldRecord.completion_time === "number" && (
                          <div className="flex items-center justify-between text-xs bg-teal-400/5 border border-teal-400/10 rounded-xl px-3 py-2">
                            <span className="text-slate-400 flex items-center gap-1.5 font-bold">
                              <Trophy className="w-4 h-4 text-amber-400" /> World Record Holder: <span className="text-slate-200">{selectedCustomLevel.worldRecord.username || "Anonymous"}</span>
                            </span>
                            <span className="font-mono text-teal-400 font-extrabold">
                              {selectedCustomLevel.worldRecord.completion_time.toFixed(3)}s
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Action buttons */}
                    <div className="space-y-2">
                      <div className="flex gap-2.5">
                        <Button
                          onClick={() => setShowCustomLb(!showCustomLb)}
                          className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold text-xs animate-duration-200"
                        >
                          {showCustomLb ? (
                            <>Back to Details</>
                          ) : (
                            <><Trophy className="w-3.5 h-3.5 mr-1.5 text-amber-400" /> Leaderboard</>
                          )}
                        </Button>
                        <a
                          href={`https://narrowarrow.xyz/levelid=${selectedCustomLevel.level_id || selectedCustomLevel.id || selectedCustomLevel.levelKey || selectedCustomLevel.levelId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs px-3 py-2 rounded-md transition-colors shadow-[0_0_15px_rgba(16,185,129,0.4)]"
                        >
                          <Play className="w-3.5 h-3.5 fill-current text-slate-950" /> Play Level
                        </a>
                      </div>
                      
                      <Button
                        onClick={handleRollCustom}
                        variant="outline"
                        className="w-full border-teal-500/20 text-teal-400 bg-teal-500/5 hover:bg-teal-500/15 hover:text-teal-300 text-xs font-bold"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Roll Another Level
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ) : (
                /* Initial state */
                <div className="flex flex-col items-center justify-center text-center py-12 max-w-sm space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-teal-500/15 border border-teal-500/20 flex items-center justify-center text-teal-400 animate-bounce">
                    <Sparkles className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Find your next custom challenge</h3>
                    <p className="text-slate-400 text-xs mt-1">
                      Choose a category catalog on the left and draw a random custom level from the thousands of community-made designs.
                    </p>
                  </div>
                  <Button
                    onClick={handleRollCustom}
                    className="bg-[#2DD4BF] hover:bg-[#14b8a6] text-slate-950 font-extrabold shadow-md"
                  >
                    <Dices className="w-3.5 h-3.5 mr-1.5" /> Roll Random Level
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
