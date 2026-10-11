import * as React from "react";
import { Gem, Award, Medal, Shield, Target, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry, LevelInfo, LevelPack, InGameMedals } from "@/types";
import { computeMedalEase, MEDAL_TIER_ORDER, type MedalKey } from "@/lib/medals";

interface Props {
  levels: LevelInfo[];
  packs: LevelPack[];
  data: Record<string, LeaderboardEntry[]>;
  medals: Record<string, InGameMedals>;
  loading?: boolean;
  onLevelClick?: (levelId: string) => void;
  formatTime?: (seconds: number) => string;
}

const SUBTAB_ICONS: Record<MedalKey, React.ComponentType<{ className?: string }>> = {
  topTime: Gem,
  goldTime: Award,
  silverTime: Medal,
  bronzeTime: Shield,
};

const SUBTABS = MEDAL_TIER_ORDER.map((tier) => ({ ...tier, Icon: SUBTAB_ICONS[tier.key] }));

/**
 * "Easiest to Achieve" — ranks pack levels per medal by the gap between the
 * medal's cutoff and the level's world record. The widest gap is the easiest
 * medal to take, because the target sits furthest from the best time.
 */
export function MedalEaseView({
  levels,
  packs,
  data,
  medals,
  loading,
  onLevelClick,
  formatTime,
}: Props) {
  const [tier, setTier] = React.useState<MedalKey>("topTime");
  const [query, setQuery] = React.useState("");
  const [packFilter, setPackFilter] = React.useState("all");

  const fmt = formatTime ?? ((s: number) => `${s.toFixed(3)}s`);

  const scopedLevels = React.useMemo(
    () => (packFilter === "all" ? levels : levels.filter((l) => l.packId === packFilter)),
    [levels, packFilter],
  );

  const rows = React.useMemo(
    () => computeMedalEase(scopedLevels, data, medals, tier),
    [scopedLevels, data, medals, tier],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((row) => row.levelName.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const active = SUBTABS.find((tab) => tab.key === tier)!;
  const packName = (id: string) => packs.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Target className="w-5 h-5 text-[var(--app-accent)]" /> Easiest to Achieve
        </h2>
        <p className="text-slate-500 text-sm">
          Every pack level ranked by how far each medal's cutoff sits below the world record. The
          bigger the gap, the easier the medal is to earn.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SUBTABS.map(({ key, label, color, Icon }) => (
          <Button
            key={key}
            variant={tier === key ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTier(key)}
            aria-pressed={tier === key}
            className={cn("text-xs", tier === key && "font-bold", tier === key && color)}
          >
            <Icon className="w-3.5 h-3.5 mr-1.5" /> {label}
          </Button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search level"
            className="pl-8 h-9 w-56 bg-black/30 border-white/10 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={packFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setPackFilter("all")}
            className="text-xs"
          >
            All packs
          </Button>
          {packs.map((pack) => (
            <Button
              key={pack.id}
              variant={packFilter === pack.id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setPackFilter(pack.id)}
              className="text-xs"
            >
              {pack.name}
            </Button>
          ))}
        </div>
      </div>

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardContent className="p-0">
          <div className="grid grid-cols-[2rem_1fr_auto_auto] sm:grid-cols-[2.5rem_1fr_6rem_7rem_6rem] gap-2 px-4 py-2 border-b border-white/5 bg-white/[0.02] text-[9px] uppercase tracking-widest text-slate-500 font-bold">
            <span>#</span>
            <span>Level</span>
            <span className="hidden sm:block text-right">WR</span>
            <span className="text-right">{active.label} target</span>
            <span className="text-right">Difference</span>
          </div>

          {loading && filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-500 font-mono text-sm animate-pulse">
              Loading medal times…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-500 font-mono text-sm">
              No {active.label.toLowerCase()} medal data available yet.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((row, index) => (
                <button
                  key={row.levelId}
                  type="button"
                  onClick={() => onLevelClick?.(row.levelId)}
                  className="w-full grid grid-cols-[2rem_1fr_auto_auto] sm:grid-cols-[2.5rem_1fr_6rem_7rem_6rem] gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors items-center"
                >
                  <span className="font-mono text-xs text-slate-500">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="font-medium text-white truncate block">{row.levelName}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500 truncate block">
                      {packName(row.packId)}
                      {!row.achieved && (
                        <span className="text-red-400 normal-case tracking-normal">
                          {" "}
                          · WR misses this
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="hidden sm:block text-right font-mono text-xs text-slate-400">
                    {fmt(row.wrTime)}
                  </span>
                  <span className={cn("text-right font-mono text-xs font-bold", active.color)}>
                    {fmt(row.cutoff)}
                  </span>
                  <span
                    className={cn(
                      "text-right font-mono text-sm font-bold",
                      row.difference >= 0 ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {row.difference >= 0 ? "+" : ""}
                    {row.difference.toFixed(3)}s
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
