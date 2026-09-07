import * as React from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Settings, 
  Save, 
  RotateCcw, 
  ChevronRight, 
  Palette, 
  Percent, 
  Clock,
  Type,
  ShieldCheck,
  LogOut,
  LogIn,
  RefreshCw,
  CheckCircle2,
  XCircle,
  History,
  Plus,
  Trash2,
  UserCheck,
  Edit2,
  X,
  Search
} from "lucide-react";
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  serverTimestamp,
  deleteDoc,
  collection,
  db,
  OperationType,
  handleFirestoreError
} from "../lib/cloud-db";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { AdminBadgeManager } from "./AdminBadgeManager";
import { AdminDiscordTracker } from "./AdminDiscordTracker";
import { useRemovedRuns, restoreRun } from "../hooks/useRemovedRuns";


import { 
  LEVELS, 
  DEFAULT_RANKS, 
  RANK_ORDER, 
  DEFAULT_OVERALL_RANKS,
  THEORETICAL_MAX_DEFAULTS,
  HUMAN_LIMIT_DEFAULTS,
  LEVEL_PACKS
} from "../constants";
import { LevelRankConfig, RankInfo, LevelInfo, LevelPack, LegacyRun } from "../types";
import { ArrowIcon } from "./ArrowIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn, capitalizeName } from "@/lib/utils";

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

interface AdminPanelProps {
  levels: LevelInfo[];
  levelPacks: LevelPack[];
  allUsernames?: string[];
  isFetchingAll?: boolean;
}

export function AdminPanel({ levels, levelPacks, allUsernames = [], isFetchingAll = false }: AdminPanelProps) {
  const { user, isAdmin, loading, error: authError, login: handleLogin, logout: handleLogout } = useAdminAuth();
  const { removedRuns, } = useRemovedRuns();
  const [selectedLevel, setSelectedLevel] = useState<string>(levels[0]?.id || "");
  const [selectedPack, setSelectedPack] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<'maps' | 'general' | 'overall' | 'legacy' | 'removed' | 'badges' | 'discord'>('maps');
  const [rankConfig, setRankConfig] = useState<Record<string, RankInfo>>(DEFAULT_RANKS);
  const [theoreticalMax, setTheoreticalMax] = useState<number | undefined>(undefined);
  const [humanLimit, setHumanLimit] = useState<number | undefined>(undefined);
  const [globalConfig, setGlobalConfig] = useState<Record<string, RankInfo>>(DEFAULT_RANKS);
  const [overallConfig, setOverallConfig] = useState<Record<string, RankInfo>>(DEFAULT_OVERALL_RANKS);
  const [selectedOverallScope, setSelectedOverallScope] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Legacy Runs State
  const [legacyRuns, setLegacyRuns] = useState<LegacyRun[]>([]);
  const [legacyLevelId, setLegacyLevelId] = useState<string>(levels[0]?.id || "");
  const [legacyPlayerSelect, setLegacyPlayerSelect] = useState<string>("");
  const [legacyPlayerQuery, setLegacyPlayerQuery] = useState<string>("");
  const [showPlayerSuggestions, setShowPlayerSuggestions] = useState<boolean>(false);
  const [legacyTime, setLegacyTime] = useState<string>("");
  const [legacyCreatedAt, setLegacyCreatedAt] = useState<string>("");
  const [legacyArrow, setLegacyArrow] = useState<string>("Narrow Arrow");
  const [addingLegacy, setAddingLegacy] = useState(false);

  // Legacy Runs Sorting
  const [legacySortKey, setLegacySortKey] = useState<'level' | 'player' | 'time' | 'date'>('level');
  const [legacySortOrder, setLegacySortOrder] = useState<'asc' | 'desc'>('asc');

  // Legacy Runs Searching & Filtering
  const [legacySearchQuery, setLegacySearchQuery] = useState<string>("");
  const [legacyLevelFilter, setLegacyLevelFilter] = useState<string>("all");
  const [legacyPackFilter, setLegacyPackFilter] = useState<string>("all");

  // Legacy Runs Editing State
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [editingLevelId, setEditingLevelId] = useState<string>("");
  const [editingUsername, setEditingUsername] = useState<string>("");
  const [editingCompletionTime, setEditingCompletionTime] = useState<string>("");
  const [editingCreatedAt, setEditingCreatedAt] = useState<string>("");
  const [editingArrow, setEditingArrow] = useState<string>("Narrow Arrow");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // Auto-clear toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Keep selected level valid in AdminPanel
  useEffect(() => {
    if (levels.length === 0) return;

    const levelExists = levels.some(l => l.id === selectedLevel);
    if (!levelExists) {
      const packLevels = selectedPack === "all" ? levels : levels.filter(l => l.packId === selectedPack);
      if (packLevels.length > 0) {
        setSelectedLevel(packLevels[0].id);
      } else {
        setSelectedLevel(levels[0].id);
        setSelectedPack("all");
      }
      return;
    }

    if (selectedPack !== "all") {
      const currentLevelObj = levels.find(l => l.id === selectedLevel);
      if (currentLevelObj && currentLevelObj.packId !== selectedPack) {
        const packLevels = levels.filter(l => l.packId === selectedPack);
        if (packLevels.length > 0) {
          setSelectedLevel(packLevels[0].id);
        } else {
          setSelectedPack("all");
          setSelectedLevel(levels[0].id);
        }
      }
    }
  }, [selectedPack, levels, selectedLevel]);

  // End of initialization checks




  // Listen for Global Config
  useEffect(() => {
    if (!isAdmin) return;
    const globalRef = doc(db, "configs", "ranks");
    const unsubscribe = onSnapshot(globalRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as LevelRankConfig;
        // Merge with defaults
        const mergedRanks = { ...DEFAULT_RANKS };
        if (data?.ranks) {
          Object.keys(data.ranks).forEach(rankId => {
            mergedRanks[rankId] = { ...mergedRanks[rankId], ...data.ranks[rankId] };
          });
        }
        setGlobalConfig(mergedRanks);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, "configs/ranks");
    });
    return unsubscribe;
  }, [isAdmin]);

  // Listen for Overall Config
  useEffect(() => {
    if (!isAdmin || activeTab !== 'overall') return;
    const docId = selectedOverallScope === "all" ? "overallRanks" : `overallRanks_${selectedOverallScope}`;
    const overallRef = doc(db, "configs", docId);
    const unsubscribe = onSnapshot(overallRef, (snapshot) => {
      const emptyOverall: Record<string, RankInfo> = {};
      const safeRankOrder = Array.isArray(RANK_ORDER) ? RANK_ORDER : [];
      safeRankOrder.forEach(id => {
        const gRank = globalConfig[id] || DEFAULT_RANKS[id];
        emptyOverall[id] = {
          ...gRank,
          timeCutoff: 0
        };
      });

      if (snapshot.exists()) {
        const data = snapshot.data() as LevelRankConfig;
        if (data?.ranks) {
          Object.keys(data.ranks).forEach(rankId => {
            if (emptyOverall[rankId]) {
              emptyOverall[rankId].timeCutoff = data.ranks[rankId]?.timeCutoff || 0;
            }
          });
        }
        setOverallConfig(emptyOverall);
      } else {
        setOverallConfig(emptyOverall);
      }
    }, (err) => {
      const docId = selectedOverallScope === "all" ? "overallRanks" : `overallRanks_${selectedOverallScope}`;
      handleFirestoreError(err, OperationType.GET, `configs/${docId}`);
    });
    return unsubscribe;
  }, [isAdmin, activeTab, selectedOverallScope, globalConfig]);

  // Listen for Level Config
  useEffect(() => {
    if (!isAdmin || activeTab !== 'maps' || !selectedLevel) return;

    const docRef = doc(db, "levelConfigs", selectedLevel);

    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      const emptyRanks: Record<string, RankInfo> = {};
      const safeRankOrder = Array.isArray(RANK_ORDER) ? RANK_ORDER : [];
      safeRankOrder.forEach(id => {
        const gRank = globalConfig[id] || DEFAULT_RANKS[id];
        emptyRanks[id] = {
          ...gRank,
          timeCutoff: 0
        };
      });

      if (snapshot.exists()) {
        const data = snapshot.data() as LevelRankConfig;
        if (data?.ranks) {
          Object.keys(data.ranks).forEach(rankId => {
            if (emptyRanks[rankId]) {
              emptyRanks[rankId].timeCutoff = data.ranks[rankId]?.timeCutoff || 0;
            }
          });
        }
        setRankConfig(emptyRanks);
        setTheoreticalMax(data.theoreticalMax ?? undefined);
        setHumanLimit(data.humanLimit ?? undefined);
      } else {
        setRankConfig(emptyRanks);
        setTheoreticalMax(undefined);
        setHumanLimit(undefined);
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `levelConfigs/${selectedLevel}`);
    });

    return unsubscribe;
  }, [selectedLevel, isAdmin, activeTab, globalConfig]);

  // Listen for legacy runs
  useEffect(() => {
    if (!isAdmin || activeTab !== 'legacy') return;
    const unsub = onSnapshot(collection(db, "legacyRuns"), (snapshot) => {
      const runs: LegacyRun[] = [];
      snapshot.forEach(doc => {
        runs.push({ id: doc.id, ...doc.data() } as LegacyRun);
      });
      setLegacyRuns(runs);
    }, (err) => {
      console.error("Error loading legacy runs in AdminPanel:", err);
    });
    return unsub;
  }, [isAdmin, activeTab]);

  const sortedLegacyRuns = React.useMemo(() => {
    let result = [...legacyRuns];

    if (legacySearchQuery) {
      const q = legacySearchQuery.toLowerCase();
      result = result.filter(r => r.username.toLowerCase().includes(q));
    }

    if (legacyLevelFilter !== "all") {
      result = result.filter(r => r.levelId === legacyLevelFilter);
    } else if (legacyPackFilter !== "all") {
      result = result.filter(r => {
        const levelObj = levels.find(l => l.id === r.levelId);
        return levelObj?.packId === legacyPackFilter;
      });
    }

    return result.sort((a, b) => {
      let comparison = 0;
      if (legacySortKey === 'level') {
        const nameA = levels.find(l => l.id === a.levelId)?.name || a.levelId;
        const nameB = levels.find(l => l.id === b.levelId)?.name || b.levelId;
        comparison = nameA.localeCompare(nameB);
      } else if (legacySortKey === 'player') {
        comparison = a.username.toLowerCase().localeCompare(b.username.toLowerCase());
      } else if (legacySortKey === 'time') {
        comparison = a.completionTime - b.completionTime;
      } else if (legacySortKey === 'date') {
        const dateA = a.createdAt || "";
        const dateB = b.createdAt || "";
        comparison = dateA.localeCompare(dateB);
      }
      return legacySortOrder === 'asc' ? comparison : -comparison;
    });
  }, [legacyRuns, legacySortKey, legacySortOrder, levels, legacySearchQuery, legacyLevelFilter, legacyPackFilter]);

  const filteredUsernames = React.useMemo(() => {
    if (!legacyPlayerQuery) {
      return allUsernames.slice(0, 10);
    }
    return allUsernames
      .filter(u => u.toLowerCase().includes(legacyPlayerQuery.toLowerCase()))
      .slice(0, 10);
  }, [allUsernames, legacyPlayerQuery]);

  const handleAddLegacyRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    let username = legacyPlayerSelect;
    if (!username && legacyPlayerQuery) {
      const trimmedQuery = legacyPlayerQuery.trim();
      if (trimmedQuery) {
        const matched = allUsernames.find(u => u.toLowerCase() === trimmedQuery.toLowerCase());
        username = matched || trimmedQuery;
      }
    }

    if (!username) {
      setToast({ message: "Player name is required", type: "error" });
      return;
    }

    const timeNum = parseFloat(legacyTime);
    if (isNaN(timeNum) || timeNum <= 0) {
      setToast({ message: "Invalid completion time", type: "error" });
      return;
    }

    setAddingLegacy(true);
    try {
      const docSlug = `${username.toLowerCase()}_${legacyLevelId}`.replace(/[^a-z0-9_]/g, '_');
      const legacyRunRef = doc(db, "legacyRuns", docSlug);

      const legacyData: Omit<LegacyRun, 'id'> = {
        levelId: legacyLevelId,
        username,
        completionTime: timeNum,
        arrow_name: legacyArrow,
        arrowId: legacyArrow,
      };

      if (legacyCreatedAt) {
        legacyData.createdAt = legacyCreatedAt;
      }

      await setDoc(legacyRunRef, legacyData);
      setToast({ message: `Successfully saved legacy run for ${username}`, type: "success" });
      
      // Reset inputs
      setLegacyTime("");
      setLegacyCreatedAt("");
      setLegacyArrow("Narrow Arrow");
      setLegacyPlayerSelect("");
      setLegacyPlayerQuery("");
    } catch (err) {
      console.error("Failed to add legacy run:", err);
      const docSlug = `${username.toLowerCase()}_${legacyLevelId}`.replace(/[^a-z0-9_]/g, '_');
      handleFirestoreError(err, OperationType.WRITE, `legacyRuns/${docSlug}`);
      setToast({ message: "Failed to add legacy run: " + (err instanceof Error ? err.message : String(err)), type: "error" });
    } finally {
      setAddingLegacy(false);
    }
  };

  const handleDeleteLegacyRun = async (runId: string) => {
    if (!isAdmin) return;
    if (!window.confirm("Are you sure you want to delete this legacy run?")) return;

    try {
      await deleteDoc(doc(db, "legacyRuns", runId));
      setToast({ message: "Successfully deleted legacy run", type: "success" });
    } catch (err) {
      console.error("Failed to delete legacy run:", err);
      handleFirestoreError(err, OperationType.DELETE, `legacyRuns/${runId}`);
      setToast({ message: "Failed to delete legacy run", type: "error" });
    }
  };

  const handleSaveEditedLegacyRun = async (oldRunId: string) => {
    if (!isAdmin) return;
    if (!editingUsername.trim()) {
      setToast({ message: "Player name cannot be empty", type: "error" });
      return;
    }
    const completionTime = parseFloat(editingCompletionTime);
    if (isNaN(completionTime) || completionTime <= 0) {
      setToast({ message: "Please enter a valid positive number for time", type: "error" });
      return;
    }

    setSavingEdit(true);
    try {
      const newSlug = `${editingUsername.trim().toLowerCase()}_${editingLevelId}`.replace(/[^a-z0-9_]/g, '_');
      const docRef = doc(db, "legacyRuns", newSlug);

      const legacyData: any = {
        levelId: editingLevelId,
        username: editingUsername.trim(),
        completionTime: completionTime,
        arrow_name: editingArrow,
        arrowId: editingArrow,
      };

      if (editingCreatedAt) {
        legacyData.createdAt = editingCreatedAt;
      }

      // Write new document
      await setDoc(docRef, legacyData);

      // If the slug has changed, delete the old document
      if (newSlug !== oldRunId) {
        await deleteDoc(doc(db, "legacyRuns", oldRunId));
      }

      setToast({ message: "Successfully updated legacy run", type: "success" });
      setEditingRunId(null);
    } catch (err) {
      console.error("Failed to edit legacy run:", err);
      const newSlug = `${editingUsername.trim().toLowerCase()}_${editingLevelId}`.replace(/[^a-z0-9_]/g, '_');
      handleFirestoreError(err, OperationType.WRITE, `legacyRuns/${newSlug}`);
      setToast({ message: "Failed to save edit: " + (err instanceof Error ? err.message : String(err)), type: "error" });
    } finally {
      setSavingEdit(false);
    }
  };


  const handleSaveMaps = async () => {
    if (!isAdmin || !selectedLevel) return;
    setSaving(true);
    const path = `levelConfigs/${selectedLevel}`;
    try {
      const docRef = doc(db, "levelConfigs", selectedLevel);
      // We only really need to save the timeCutoff, but for schema consistency we save the object
      // The App.tsx merge logic will prioritize global colors anyway
      await setDoc(docRef, {
        ranks: rankConfig,
        theoreticalMax: theoreticalMax || null,
        humanLimit: humanLimit || null,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email
      });
      setToast({ message: "Map times saved successfully!", type: "success" });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
      setToast({ message: `Error saving map times: ${error instanceof Error ? error.message : "Unknown error"}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGeneral = async () => {
    if (!isAdmin) return;
    setSaving(true);
    const path = "configs/ranks";
    try {
      const docRef = doc(db, "configs", "ranks");
      await setDoc(docRef, {
        ranks: globalConfig,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email
      });
      setToast({ message: "Global colors saved successfully!", type: "success" });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
      setToast({ message: `Error saving global colors: ${error instanceof Error ? error.message : "Unknown error"}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOverall = async () => {
    if (!isAdmin) return;
    setSaving(true);
    const docId = selectedOverallScope === "all" ? "overallRanks" : `overallRanks_${selectedOverallScope}`;
    const path = `configs/${docId}`;
    try {
      const docRef = doc(db, "configs", docId);
      await setDoc(docRef, {
        ranks: overallConfig,
        updatedAt: serverTimestamp(),
        updatedBy: user?.email
      });
      setToast({ message: `Overall ranks for ${selectedOverallScope === "all" ? "All Levels" : "selected pack"} saved successfully!`, type: "success" });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
      setToast({ message: `Error saving overall ranks: ${error instanceof Error ? error.message : "Unknown error"}`, type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const updateRankTime = (rankId: string, value: string) => {
    const timeCutoff = value === "" ? 0 : parseFloat(value);
    if (arrowScope !== "base") {
      setArrowRanks(prev => ({
        ...prev,
        [arrowScope]: { ...(prev[arrowScope] || {}), [rankId]: isNaN(timeCutoff) ? 0 : timeCutoff },
      }));
      return;
    }
    setRankConfig(prev => ({
      ...prev,
      [rankId]: { ...prev[rankId], timeCutoff }
    }));
  };


  const updateGlobalColor = (rankId: string, hex: string) => {
    // Allow empty or partial hex during editing
    const colorClass = `text-[#${hex}]`;
    const bgClass = `bg-[#${hex}]/10`;
    const borderClass = `border-[#${hex}]/50`;
    
    setGlobalConfig(prev => ({
      ...prev,
      [rankId]: { 
        ...prev[rankId], 
        color: colorClass,
        bgColor: bgClass,
        borderColor: borderClass
      }
    }));
  };

  const updateGlobalName = (rankId: string, name: string) => {
    setGlobalConfig(prev => ({
      ...prev,
      [rankId]: { ...prev[rankId], name }
    }));
  };

  const updateOverallTime = (rankId: string, value: string) => {
    const timeCutoff = value === "" ? 0 : parseFloat(value);
    setOverallConfig(prev => ({
      ...prev,
      [rankId]: { ...prev[rankId], timeCutoff }
    }));
  };

  if (loading) return <div className="p-8 text-center text-slate-500 font-mono text-xs">Verifying Credentials...</div>;

  if (!isAdmin) {
    return (
      <ErrorBoundary>
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-6">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-red-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Admin Access Required</h2>
            <p className="text-slate-500 text-sm max-w-xs mx-auto mt-2">
              You must be an authorized administrator to modify ranking configurations.
            </p>
          </div>
          {authError && (
            <div className="max-w-md text-left text-xs bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-2">
              <p className="text-red-300 font-medium">{authError}</p>
              <p className="text-slate-400">
                Current domain: <span className="font-mono text-white">{typeof window !== "undefined" ? window.location.hostname : ""}</span>
              </p>
            </div>
          )}
          {user ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">Logged in as: <span className="text-white font-mono">{user.email}</span></p>
              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">This account isn't on the admin list. Sign out and use an admin Google account.</p>
              <Button onClick={handleLogout} variant="outline" className="border-white/10 hover:bg-white/5">
                <LogOut className="w-4 h-4 mr-2" /> Sign Out
              </Button>
            </div>
          ) : (
            <Button onClick={handleLogin} className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold">
              <LogIn className="w-4 h-4 mr-2" /> Admin Login
            </Button>
          )}

        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Settings className="w-6 h-6 text-[var(--app-accent)]" />
              Admin Panel
            </h2>
            <p className="text-slate-500 text-sm">Manage map-specific times and global rank colors.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleLogout} variant="ghost" className="text-slate-500 hover:text-white">
              <LogOut className="w-4 h-4 mr-2" /> Logout
            </Button>
            {activeTab !== 'legacy' && activeTab !== 'removed' && activeTab !== 'badges' && activeTab !== 'discord' && (
              <Button 
                onClick={activeTab === 'maps' ? handleSaveMaps : activeTab === 'general' ? handleSaveGeneral : handleSaveOverall} 
                disabled={saving}
                className="bg-[var(--app-accent)] text-slate-950 hover:bg-[var(--app-accent)]/80 font-bold shadow-[0_0_15px_rgba(56,189,248,0.2)]"
              >
                <Save className={cn("w-4 h-4 mr-2", saving && "animate-spin")} />
                {saving ? "Saving..." : "Save Changes"}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-1 w-fit">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('maps')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'maps' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            Map Times
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('general')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'general' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            General Colors
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('overall')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'overall' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            Overall Ranks
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('legacy')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'legacy' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            Legacy Runs
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('removed')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'removed' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            Removed Runs ({removedRuns.length})
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('badges')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'badges' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            Badges
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setActiveTab('discord')}
            className={cn("text-[10px] uppercase tracking-widest h-8 px-4", activeTab === 'discord' ? "bg-white/10 text-white" : "text-slate-400")}
          >
            Discord
          </Button>
        </div>


        {activeTab === 'discord' ? (
          <AdminDiscordTracker />
        ) : activeTab === 'badges' ? (
          <AdminBadgeManager usernames={allUsernames} />
        ) : activeTab === 'maps' ? (
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="border-b border-white/10 pb-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">Map Selection</CardTitle>
                  <CardDescription>Modify rank times for a specific map</CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold ml-1">Pack</span>
                    <Select value={selectedPack} onValueChange={setSelectedPack}>
                      <SelectTrigger className="w-[180px] bg-black/40 border-white/10 text-white">
                        <SelectValue placeholder="All">
                          {selectedPack === "all" ? "All" : (levelPacks.find(p => p.id === selectedPack)?.name || capitalizeName(selectedPack))}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                        <SelectItem value="all">All</SelectItem>
                        {levelPacks.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold ml-1">Level</span>
                    <Select value={selectedLevel} onValueChange={setSelectedLevel}>
                      <SelectTrigger className="w-[180px] bg-black/40 border-white/10 text-white">
                        <SelectValue placeholder="Select map">
                          {levels.find(l => l.id === selectedLevel)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                        {levels.filter(l => selectedPack === "all" || l.packId === selectedPack).map(l => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-white/5 bg-white/[0.01]">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Theoretical Max</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <Input 
                      type="number"
                      step="0.001"
                      value={theoreticalMax || ""} 
                      onChange={(e) => setTheoreticalMax(parseFloat(e.target.value))}
                      placeholder="e.g. 13.300"
                      className="bg-black/40 border-white/10 h-10 text-sm font-mono text-white"
                    />
                    <span className="text-[10px] text-slate-600 font-mono">sec</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <label className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Human Limit</label>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="w-4 h-4 text-slate-500" />
                    <Input 
                      type="number"
                      step="0.001"
                      value={humanLimit || ""} 
                      onChange={(e) => setHumanLimit(parseFloat(e.target.value))}
                      placeholder="e.g. 13.150"
                      className="bg-black/40 border-white/10 h-10 text-sm font-mono text-white"
                    />
                    <span className="text-[10px] text-slate-600 font-mono">sec</span>
                  </div>
                </div>
              </div>
              <div className="divide-y divide-white/5">
                {(Array.isArray(RANK_ORDER) ? RANK_ORDER : []).map((rankId) => {
                  const rank = rankConfig[rankId] || DEFAULT_RANKS[rankId];
                  const gRank = globalConfig[rankId] || DEFAULT_RANKS[rankId];
                  return (
                    <div key={rankId} className="p-4 hover:bg-white/[0.01] transition-colors">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-[140px]">
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "font-bold text-[10px] uppercase tracking-tighter px-2 py-0.5",
                              gRank.bgColor,
                              gRank.color,
                              gRank.borderColor
                            )}
                          >
                            {gRank.name}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 flex-1 max-w-xs">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <Input 
                            type="number"
                            step="0.001"
                            value={rank.timeCutoff || ""} 
                            onChange={(e) => updateRankTime(rankId, e.target.value)}
                            className="bg-black/40 border-white/10 h-8 text-sm font-mono text-white"
                          />
                          <span className="text-[10px] text-slate-600 font-mono">sec</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : activeTab === 'general' ? (
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="border-b border-white/10 pb-4">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">Global Colors & Names</CardTitle>
              <CardDescription>Change colors and names for all maps</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-white/5">
                {(Array.isArray(RANK_ORDER) ? RANK_ORDER : []).map((rankId) => {
                  const rank = globalConfig[rankId] || DEFAULT_RANKS[rankId];
                  const defaultRank = DEFAULT_RANKS[rankId];
                  
                  // Extract hex from color class (e.g. "text-[#D300CF]") or use fallback from default
                  // Use a more lenient regex to allow editing
                  let hex = rank.color.match(/#([A-Fa-f0-9]*)/)?.[1] || "";

                  return (
                    <div key={rankId} className="p-4 hover:bg-white/[0.01] transition-colors">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                        <div className="md:col-span-3 flex items-center gap-4">
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "font-bold text-[10px] uppercase tracking-tighter px-2 py-0.5",
                              rank.bgColor,
                              rank.color,
                              rank.borderColor
                            )}
                          >
                            {rank.name}
                          </Badge>
                        </div>
                        <div className="md:col-span-4 flex items-center gap-3">
                          <Type className="w-3 h-3 text-slate-500" />
                          <Input 
                            value={rank.name} 
                            onChange={(e) => updateGlobalName(rankId, e.target.value)}
                            placeholder="Rank Name"
                            className="bg-black/40 border-white/10 h-8 text-sm text-white"
                          />
                        </div>
                        <div className="md:col-span-5 flex items-center gap-3">
                          <Palette className="w-3 h-3 text-slate-500" />
                          <div className="relative flex-1">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-xs">#</span>
                            <Input 
                              value={hex} 
                              onChange={(e) => updateGlobalColor(rankId, e.target.value)}
                              placeholder="D300CF"
                              maxLength={6}
                              className="bg-black/40 border-white/10 h-8 pl-6 text-sm font-mono text-white"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : activeTab === 'overall' ? (
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="border-b border-white/10 pb-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">Overall Time Ranks</CardTitle>
                  <CardDescription>Modify total time cutoffs for overall ranks</CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold ml-1">Scope / Map Pack</span>
                    <Select value={selectedOverallScope} onValueChange={setSelectedOverallScope}>
                      <SelectTrigger className="w-[200px] bg-black/40 border-white/10 text-white">
                        <SelectValue placeholder="All Levels">
                          {selectedOverallScope === "all" ? "All Levels" : (levelPacks.find(p => p.id === selectedOverallScope)?.name || capitalizeName(selectedOverallScope))}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                        <SelectItem value="all">All Levels</SelectItem>
                        {levelPacks.map(p => (
                          <SelectItem key={p.id} value={p.id}>Pack: {p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-white/5">
                {(Array.isArray(RANK_ORDER) ? RANK_ORDER : []).map((rankId) => {
                  const rank = overallConfig[rankId] || DEFAULT_OVERALL_RANKS[rankId];
                  const gRank = globalConfig[rankId] || DEFAULT_RANKS[rankId];
                  return (
                    <div key={rankId} className="p-4 hover:bg-white/[0.01] transition-colors">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4 min-w-[140px]">
                          <Badge 
                            variant="outline" 
                            className={cn(
                              "font-bold text-[10px] uppercase tracking-tighter px-2 py-0.5",
                              gRank.bgColor,
                              gRank.color,
                              gRank.borderColor
                            )}
                          >
                            {gRank.name}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 flex-1 max-w-xs">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <Input 
                            type="number"
                            step="0.001"
                            value={rank.timeCutoff || ""} 
                            onChange={(e) => updateOverallTime(rankId, e.target.value)}
                            className="bg-black/40 border-white/10 h-8 text-sm font-mono text-white"
                          />
                          <span className="text-[10px] text-slate-600 font-mono">sec</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : activeTab === 'legacy' ? (
          <div className="space-y-8">
            <div className="max-w-xl mx-auto">
              {/* Add Legacy Run Card */}
              <Card className="bg-white/5 border-white/10">
                <CardHeader className="border-b border-white/10 pb-4">
                  <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-[var(--app-accent)]" />
                    Add Legacy Run
                  </CardTitle>
                  <CardDescription>Insert a verified historic run that is no longer on the active leaderboards.</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <form onSubmit={handleAddLegacyRun} className="space-y-4">
                     <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Select Level</label>
                      <Select value={legacyLevelId} onValueChange={setLegacyLevelId}>
                        <SelectTrigger className="bg-black/40 border-white/10 text-white">
                          <SelectValue placeholder="Choose a level">
                            {levels.find(l => l.id === legacyLevelId)?.name || "Select Level"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-[300px]">
                          {levels.map(l => (
                            <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-col gap-1.5 relative">
                      <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Player Name</label>
                      <div className="relative w-full">
                        <Input
                          type="text"
                          placeholder="Type username to search..."
                          value={legacyPlayerQuery}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLegacyPlayerQuery(val);
                            // If exactly matches an existing player, select them
                            const matched = allUsernames.find(u => u.toLowerCase() === val.toLowerCase());
                            if (matched) {
                              setLegacyPlayerSelect(matched);
                            } else {
                              setLegacyPlayerSelect("");
                            }
                            setShowPlayerSuggestions(true);
                          }}
                          onFocus={() => setShowPlayerSuggestions(true)}
                          onBlur={() => {
                            setTimeout(() => setShowPlayerSuggestions(false), 200);
                          }}
                          className="bg-black/40 border-white/10 h-10 text-sm text-white pr-24 font-sans"
                        />
                        {isFetchingAll && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                            <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                            <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider">Syncing...</span>
                          </div>
                        )}
                        {!isFetchingAll && legacyPlayerSelect && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Selected</span>
                          </div>
                        )}
                      </div>
                      
                      {showPlayerSuggestions && (
                        <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-[#161616] border border-white/10 rounded-lg overflow-hidden z-50 shadow-2xl max-h-[200px] overflow-y-auto">
                          {isFetchingAll && filteredUsernames.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-sky-400 italic flex items-center gap-2">
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Syncing active players...</span>
                            </div>
                          ) : filteredUsernames.length > 0 ? (
                            filteredUsernames.map(u => (
                              <button
                                type="button"
                                key={u}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setLegacyPlayerSelect(u);
                                  setLegacyPlayerQuery(u);
                                  setShowPlayerSuggestions(false);
                                }}
                                className="w-full px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-[var(--app-accent)] hover:text-slate-950 transition-colors border-b border-white/5 last:border-0 flex items-center justify-between"
                              >
                                <span>{u}</span>
                                {legacyPlayerSelect === u && (
                                  <span className="text-xs font-bold text-slate-950">✓</span>
                                )}
                              </button>
                            ))
                          ) : (
                            <div className="px-4 py-3 text-xs text-slate-500 italic">No players found</div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Time (seconds)</label>
                        <Input
                          type="number"
                          step="0.001"
                          placeholder="e.g. 42.158"
                          value={legacyTime}
                          onChange={(e) => setLegacyTime(e.target.value)}
                          className="bg-black/40 border-white/10 h-10 text-sm text-white font-mono"
                          required
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Record Date (Optional)</label>
                        <Input
                          type="date"
                          value={legacyCreatedAt}
                          onChange={(e) => setLegacyCreatedAt(e.target.value)}
                          className="bg-black/40 border-white/10 h-10 text-sm text-white font-mono"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Arrow Type</label>
                        <Select value={legacyArrow} onValueChange={setLegacyArrow}>
                          <SelectTrigger className="bg-black/40 border-white/10 text-white h-10">
                            <SelectValue placeholder="Choose an arrow">
                              {legacyArrow}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                            <SelectItem value="Narrow Arrow">Narrow Arrow</SelectItem>
                            <SelectItem value="Speedy Arrow">Speedy Arrow</SelectItem>
                            <SelectItem value="Energy Arrow">Energy Arrow</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      disabled={addingLegacy}
                      className="w-full bg-[var(--app-accent)] text-slate-950 hover:bg-[var(--app-accent)]/80 font-bold h-10 mt-2"
                    >
                      {addingLegacy ? "Saving Run..." : "Save Legacy Run"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>

            {/* List and Management Table */}
            <Card className="bg-white/5 border-white/10">
              <CardHeader className="border-b border-white/10 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <History className="w-4 h-4 text-amber-400" />
                    Active Legacy Runs ({sortedLegacyRuns.length === legacyRuns.length ? legacyRuns.length : `${sortedLegacyRuns.length} of ${legacyRuns.length}`})
                  </CardTitle>
                  <CardDescription>Manage all historical record overrides in the database.</CardDescription>
                </div>
                
                {/* Search & Filter Toolbar */}
                <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                  <div className="relative min-w-[160px] flex-1 md:flex-initial">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <Input 
                      placeholder="Search player..." 
                      value={legacySearchQuery}
                      onChange={(e) => setLegacySearchQuery(e.target.value)}
                      className="bg-black/30 border-white/10 h-8 pl-8 text-xs text-white placeholder-slate-500 min-w-[140px] focus-visible:ring-[var(--app-accent)]/50"
                    />
                  </div>

                  <div className="min-w-[140px] flex-1 md:flex-initial">
                    <Select value={legacyPackFilter} onValueChange={(val) => {
                      setLegacyPackFilter(val);
                      setLegacyLevelFilter("all"); // Reset level filter on pack change
                    }}>
                      <SelectTrigger className="bg-black/30 border-white/10 h-8 text-[11px] text-white">
                        <SelectValue placeholder="All Map Packs" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 text-xs">
                        <SelectItem value="all">All Map Packs</SelectItem>
                        {levelPacks.map(pack => (
                          <SelectItem key={pack.id} value={pack.id}>{pack.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="min-w-[140px] flex-1 md:flex-initial">
                    <Select value={legacyLevelFilter} onValueChange={setLegacyLevelFilter}>
                      <SelectTrigger className="bg-black/30 border-white/10 h-8 text-[11px] text-white">
                        <SelectValue placeholder="All Levels" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 text-xs max-h-[250px]">
                        <SelectItem value="all">All Levels</SelectItem>
                        {levels
                          .filter(l => legacyPackFilter === "all" || l.packId === legacyPackFilter)
                          .map(level => (
                            <SelectItem key={level.id} value={level.id}>{level.name}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {(legacySearchQuery || legacyPackFilter !== "all" || legacyLevelFilter !== "all") && (
                    <Button 
                      variant="ghost" 
                      onClick={() => {
                        setLegacySearchQuery("");
                        setLegacyPackFilter("all");
                        setLegacyLevelFilter("all");
                      }}
                      className="h-8 text-[11px] text-amber-400 hover:text-amber-300 px-2"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/[0.02]">
                        <th 
                          onClick={() => {
                            if (legacySortKey === 'level') {
                              setLegacySortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setLegacySortKey('level');
                              setLegacySortOrder('asc');
                            }
                          }}
                          className="p-4 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold cursor-pointer hover:text-white select-none"
                        >
                          Level / Map {legacySortKey === 'level' ? (legacySortOrder === 'asc' ? "▲" : "▼") : ""}
                        </th>
                        <th 
                          onClick={() => {
                            if (legacySortKey === 'player') {
                              setLegacySortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setLegacySortKey('player');
                              setLegacySortOrder('asc');
                            }
                          }}
                          className="p-4 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold cursor-pointer hover:text-white select-none"
                        >
                          Player {legacySortKey === 'player' ? (legacySortOrder === 'asc' ? "▲" : "▼") : ""}
                        </th>
                        <th 
                          onClick={() => {
                            if (legacySortKey === 'time') {
                              setLegacySortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setLegacySortKey('time');
                              setLegacySortOrder('asc');
                            }
                          }}
                          className="p-4 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold cursor-pointer hover:text-white select-none"
                        >
                          Time {legacySortKey === 'time' ? (legacySortOrder === 'asc' ? "▲" : "▼") : ""}
                        </th>
                        <th 
                          onClick={() => {
                            if (legacySortKey === 'date') {
                              setLegacySortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                            } else {
                              setLegacySortKey('date');
                              setLegacySortOrder('asc');
                            }
                          }}
                          className="p-4 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold cursor-pointer hover:text-white select-none"
                        >
                          Date {legacySortKey === 'date' ? (legacySortOrder === 'asc' ? "▲" : "▼") : ""}
                        </th>
                        <th className="p-4 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold">Arrow</th>
                        <th className="p-4 text-[10px] font-mono uppercase tracking-widest text-slate-500 font-bold text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sortedLegacyRuns.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-xs text-slate-500 font-mono">
                            No matching legacy runs found.
                          </td>
                        </tr>
                      ) : (
                        sortedLegacyRuns.map((run) => {
                          const levelName = levels.find(l => l.id === run.levelId)?.name || run.levelId;
                          const isEditing = editingRunId === run.id;

                          if (isEditing) {
                            return (
                              <tr key={run.id} className="bg-white/[0.04] transition-colors border-l-2 border-amber-500">
                                {/* Level selection */}
                                <td className="p-2">
                                  <Select value={editingLevelId} onValueChange={setEditingLevelId}>
                                    <SelectTrigger className="bg-black/60 border-white/15 text-white h-8 text-xs">
                                      <SelectValue placeholder="Choose level">
                                        {levels.find(l => l.id === editingLevelId)?.name || editingLevelId}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 text-xs max-h-[200px]">
                                      {levels.map(l => (
                                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>

                                {/* Player Username */}
                                <td className="p-2">
                                  <Input
                                    value={editingUsername}
                                    onChange={(e) => setEditingUsername(e.target.value)}
                                    className="bg-black/60 border-white/15 h-8 text-xs text-white font-mono"
                                    placeholder="Player name"
                                  />
                                </td>

                                {/* Completion Time */}
                                <td className="p-2">
                                  <Input
                                    type="number"
                                    step="0.001"
                                    value={editingCompletionTime}
                                    onChange={(e) => setEditingCompletionTime(e.target.value)}
                                    className="bg-black/60 border-white/15 h-8 text-xs text-amber-400 font-mono font-bold"
                                    placeholder="Time (seconds)"
                                  />
                                </td>

                                {/* Date (Optional) */}
                                <td className="p-2">
                                  <Input
                                    type="date"
                                    value={editingCreatedAt}
                                    onChange={(e) => setEditingCreatedAt(e.target.value)}
                                    className="bg-black/60 border-white/15 h-8 text-xs text-slate-300 font-mono"
                                  />
                                </td>

                                {/* Arrow Selection */}
                                <td className="p-2">
                                  <Select value={editingArrow} onValueChange={setEditingArrow}>
                                    <SelectTrigger className="bg-black/60 border-white/15 text-white h-8 text-xs">
                                      <SelectValue placeholder="Arrow Type">
                                        {editingArrow}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 text-xs">
                                      <SelectItem value="Narrow Arrow">Narrow Arrow</SelectItem>
                                      <SelectItem value="Speedy Arrow">Speedy Arrow</SelectItem>
                                      <SelectItem value="Energy Arrow">Energy Arrow</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </td>

                                {/* Save / Cancel Actions */}
                                <td className="p-2 text-right whitespace-nowrap">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={savingEdit}
                                      onClick={() => handleSaveEditedLegacyRun(run.id)}
                                      className="text-green-400 hover:text-green-300 hover:bg-green-500/10 h-8 w-8"
                                      title="Save changes"
                                    >
                                      {savingEdit ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      disabled={savingEdit}
                                      onClick={() => setEditingRunId(null)}
                                      className="text-slate-400 hover:text-slate-200 hover:bg-white/5 h-8 w-8"
                                      title="Cancel editing"
                                    >
                                      <X className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }

                          return (
                            <tr key={run.id} className="hover:bg-white/[0.02] transition-colors">
                              <td className="p-4 text-sm text-white font-bold">{levelName}</td>
                              <td className="p-4 text-sm text-slate-300 font-mono">{run.username}</td>
                              <td className="p-4 text-sm text-amber-400 font-mono font-bold">{(run.completionTime).toFixed(3)}s</td>
                              <td className="p-4 text-xs text-slate-300 font-mono">
                                <div className="flex items-center gap-1.5">
                                  <ArrowIcon name={run.arrow_name || run.arrowId || "Narrow Arrow"} className="w-4 h-4" />
                                  <span>{run.arrow_name || run.arrowId || "Narrow Arrow"}</span>
                                </div>
                              </td>
                              <td className="p-4 text-xs text-slate-400 font-mono">{run.createdAt || "N/A"}</td>
                              <td className="p-4 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setEditingRunId(run.id);
                                      setEditingLevelId(run.levelId);
                                      setEditingUsername(run.username);
                                      setEditingCompletionTime(String(run.completionTime));
                                      setEditingCreatedAt(run.createdAt || "");
                                      setEditingArrow(run.arrow_name || run.arrowId || "Narrow Arrow");
                                    }}
                                    className="text-[var(--app-accent)] hover:text-[var(--app-accent)]/80 hover:bg-[var(--app-accent)]/10 h-8 w-8"
                                    title="Edit Run"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteLegacyRun(run.id)}
                                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8"
                                    title="Delete Run"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : activeTab === 'removed' ? (
          <Card className="bg-white/5 border-white/10">
            <CardHeader className="border-b border-white/10 pb-4">
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-400">
                Removed Runs ({removedRuns.length})
              </CardTitle>
              <CardDescription>
                Runs hidden from every leaderboard, average and world-record view. Restore to bring one back.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {removedRuns.length === 0 ? (
                <div className="p-8 text-center text-slate-500 font-mono text-xs">
                  No removed runs. Use the trash icon on a leaderboard row to hide a run.
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {removedRuns.map(run => (
                    <div key={run.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium truncate">{run.username}</div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">
                          {levels.find(l => l.id === run.levelId)?.name || run.levelId} · {Number(run.completionTime).toFixed(3)}s
                          {run.reason ? ` · ${run.reason}` : ""}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await restoreRun(run.id);
                            setToast({ message: `Restored ${run.username}'s run`, type: "success" });
                          } catch (err) {
                            setToast({ message: `Failed to restore: ${err instanceof Error ? err.message : "error"}`, type: "error" });
                          }
                        }}
                        className="border-white/10 hover:bg-white/5 text-[10px] uppercase tracking-widest shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-2" /> Restore
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={cn(
              "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md max-w-md",
              toast.type === "success" 
                ? "bg-[#121214]/90 border-green-500/30 text-white" 
                : "bg-[#121214]/90 border-red-500/30 text-white"
            )}
          >
            {toast.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <div className="text-xs font-medium font-sans">{toast.message}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </ErrorBoundary>
  );
}
