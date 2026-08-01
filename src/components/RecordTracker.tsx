import * as React from "react";
import { Activity, Crown, Filter, Search, Timer } from "lucide-react";
import type { LeaderboardEntry, LevelInfo } from "../types";
import { toStandings } from "@/lib/medals";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RecordEvent {
  key: string;
  username: string;
  levelId: string;
  levelName: string;
  time: number;
  position: number;
  gapToWr: number;
  createdAt: number;
  isWr: boolean;
  isLegacy?: boolean;
}

interface Props {
  levels: LevelInfo[];
  data: Record<string, LeaderboardEntry[]>;
  onSelectPlayer?: (username: string) => void;
  onSelectLevel?: (levelId: string) => void;
  formatTime: (seconds: number) => string;
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function RecordTracker({ levels, data, onSelectPlayer, onSelectLevel, formatTime }: Props) {
  const [filter, setFilter] = React.useState<"all" | "wr" | "podium" | "top10">("all");
  const [query, setQuery] = React.useState("");

  const events = React.useMemo(() => {
    const out: RecordEvent[] = [];
    for (const level of levels) {
      const standings = toStandings(data[level.id] || []);
      if (standings.length === 0) continue;
      const wrTime = standings[0].completion_time;
      standings.forEach((entry, index) => {
        const ts = new Date(entry.created_at).getTime();
        if (!Number.isFinite(ts)) return;
        out.push({
          key: `${level.id}-${entry.username}-${entry.completion_time}`,
          username: entry.username,
          levelId: level.id,
          levelName: level.name,
          time: entry.completion_time,
          position: index + 1,
          gapToWr: entry.completion_time - wrTime,
          createdAt: ts,
          isWr: index === 0,
          isLegacy: entry.isLegacy,
        });
      });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }, [levels, data]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return events
      .filter((e) => {
        if (filter === "wr" && !e.isWr) return false;
        if (filter === "podium" && e.position > 3) return false;
        if (filter === "top10" && e.position > 10) return false;
        if (q && !e.username.toLowerCase().includes(q) && !e.levelName.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, 120);
  }, [events, filter, query]);

  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const todayCount = events.filter((e) => e.createdAt > dayAgo).length;
  const weekCount = events.filter((e) => e.createdAt > weekAgo).length;
  const hotPlayer = React.useMemo(() => {
    const tally = new Map<string, number>();
    for (const e of events) if (e.createdAt > weekAgo) tally.set(e.username, (tally.get(e.username) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [events, weekAgo]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Runs last 24h", value: todayCount, icon: Timer },
          { label: "Runs this week", value: weekCount, icon: Activity },
          { label: "Hottest player", value: hotPlayer?.[0] ?? "—", icon: Crown },
          { label: "Tracked runs", value: events.length, icon: Filter },
        ].map((stat) => (
          <Card key={stat.label} className="bg-white/5 border-white/10">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                <stat.icon className="w-3.5 h-3.5 text-[var(--app-accent)]" /> {stat.label}
              </div>
              <div className="text-xl font-bold text-white mt-1 font-mono truncate">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-white/5 border-white/10 overflow-hidden">
        <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3 flex flex-col md:flex-row md:items-center gap-3 justify-between">
          <CardTitle className="text-base font-bold text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--app-accent)]" /> Record tracker
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex bg-black/30 border border-white/10 rounded-lg p-0.5">
              {(["all", "top10", "podium", "wr"] as const).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant="ghost"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "h-7 px-2.5 text-[10px] uppercase tracking-widest",
                    filter === key ? "bg-[var(--app-accent)] text-slate-950 font-bold" : "text-slate-400",
                  )}
                >
                  {key === "wr" ? "WRs" : key === "top10" ? "Top 10" : key}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Player or level"
                className="pl-8 h-8 w-44 bg-black/30 border-white/10 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-white/5 max-h-[640px] overflow-y-auto">
          {filtered.length === 0 && (
            <p className="p-8 text-center text-slate-500 font-mono text-xs">No runs match this filter yet.</p>
          )}
          {filtered.map((event) => (
            <div key={event.key} className="flex items-center gap-3 p-3 hover:bg-white/[0.03] transition-colors">
              <div
                className={cn(
                  "w-10 h-10 rounded-xl grid place-items-center font-mono text-xs font-bold shrink-0",
                  event.isWr
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/25"
                    : event.position <= 3
                      ? "bg-white/10 text-slate-200 border border-white/10"
                      : "bg-black/30 text-slate-500 border border-white/5",
                )}
              >
                #{event.position}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="font-bold text-white text-sm hover:text-[var(--app-accent)] transition-colors"
                    onClick={() => onSelectPlayer?.(event.username)}
                  >
                    {event.username}
                  </button>
                  {event.isWr && (
                    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] uppercase">
                      World record
                    </Badge>
                  )}
                  {event.isLegacy && (
                    <Badge className="bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20 text-[9px] uppercase">
                      Legacy
                    </Badge>
                  )}
                </div>
                <button
                  className="text-[11px] text-slate-500 font-mono hover:text-slate-300 transition-colors"
                  onClick={() => onSelectLevel?.(event.levelId)}
                >
                  {event.levelName}
                </button>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-[#2DD4BF] text-sm">{formatTime(event.time)}</div>
                <div className="text-[10px] font-mono text-slate-500">
                  {event.gapToWr > 0 ? `+${event.gapToWr.toFixed(3)}s` : "WR pace"} · {timeAgo(event.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
