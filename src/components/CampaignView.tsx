import * as React from "react";
import { Clock, Flag, Medal, Search, Settings, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CampaignCuratorDialog } from "@/components/CampaignCuratorDialog";
import {
  buildClassStandings,
  CAMPAIGN_MAX_POINTS,
  formatCountdown,
  rankClassRows,
  type CampaignStanding,
} from "@/lib/campaign";
import {
  fetchCampaigns,
  fetchCampaign,
  type CampaignDetail,
  type CampaignSummary,
} from "@/lib/campaign-client";
import { displayNameFor, type ProfileDirectory } from "@/lib/display-name";

interface Props {
  profiles?: ProfileDirectory;
  formatTime: (seconds: number, forceMode?: "seconds" | "minutes") => string;
  onPlayerClick?: (username: string) => void;
  onLevelClick?: (levelId: string) => void;
  /** Admins get the curator; everyone else just reads the standings. */
  isAdmin?: boolean;
}

const PAGE = 50;

export function CampaignView({
  profiles,
  formatTime,
  onPlayerClick,
  onLevelClick,
  isAdmin,
}: Props) {
  const [summaries, setSummaries] = React.useState<CampaignSummary[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<CampaignDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [visible, setVisible] = React.useState(PAGE);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [classId, setClassId] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [curatorOpen, setCuratorOpen] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);

  // A live countdown only matters while a campaign is running.
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCampaigns()
      .then((list) => {
        if (cancelled) return;
        setSummaries(list);
        setSelected((prev) =>
          prev && list.some((c) => c.id === prev) ? prev : (list[0]?.id ?? null),
        );
        if (list.length === 0) {
          setDetail(null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load campaigns.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  React.useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCampaign(selected)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setClassId(null);
        setVisible(PAGE);
        setExpanded(null);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load the campaign.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const campaign = detail?.campaign ?? null;
  const standings = React.useMemo(() => detail?.standings ?? [], [detail]);

  const classRows = React.useMemo(() => {
    if (!campaign) return new Map<string, CampaignStanding[]>();
    return buildClassStandings(campaign, standings);
  }, [campaign, standings]);

  /** Ranks are 1-based within the active scope (overall, or one class). */
  const ranked = React.useMemo(() => {
    const rows = classId ? (classRows.get(classId) ?? []) : standings;
    let rank = 0;
    let previous: number | null = null;
    return rows.map((row, index) => {
      if (previous === null || row.points !== previous) {
        rank = index + 1;
        previous = row.points;
      }
      return { ...row, rank };
    });
  }, [standings, classId, classRows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((r) => r.username.toLowerCase().includes(q));
  }, [ranked, query]);

  const classOf = (id: string) => campaign?.classes.find((k) => k.id === id) ?? null;
  const status = detail?.status ?? "upcoming";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Flag className="w-5 h-5 text-[var(--app-accent)]" /> Campaign
          </h2>
          <p className="text-slate-500 text-sm">
            A curated set of levels run inside a window. Each level awards up to{" "}
            {CAMPAIGN_MAX_POINTS.toLocaleString()} points — the closer your time is to the world
            record, the more you score. Your fastest run on any arrow counts.
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisible(PAGE);
            }}
            placeholder="Search player"
            className="pl-8 h-9 w-48 bg-black/30 border-white/10 text-sm"
          />
        </div>
      </div>

      {isAdmin && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCuratorOpen(true)}
            className="h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10 text-slate-300 gap-2"
          >
            <Settings className="w-3.5 h-3.5" /> Curate campaign
          </Button>
        </div>
      )}

      {summaries.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {summaries.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant="ghost"
              onClick={() => setSelected(s.id)}
              className={cn(
                "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
                selected === s.id
                  ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                  : "text-slate-400",
              )}
            >
              {s.name}
              {s.frozen && <span className="ml-2 text-[9px] opacity-70">final</span>}
            </Button>
          ))}
        </div>
      )}

      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="py-4 text-sm text-red-300">{error}</CardContent>
        </Card>
      )}

      {!loading && summaries.length === 0 && !error && (
        <Card className="bg-white/5 border-white/10">
          <CardContent className="py-10 text-center text-sm text-slate-400">
            No campaign is running yet.
          </CardContent>
        </Card>
      )}

      {campaign && (
        <>
          <Card className="bg-white/5 border-white/10">
            <CardContent className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-widest px-2 py-1 rounded border font-bold",
                    status === "live"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : status === "ended"
                        ? "border-white/20 bg-white/5 text-slate-400"
                        : "border-amber-400/40 bg-amber-400/10 text-amber-300",
                  )}
                >
                  {status === "live" ? "Live" : status === "ended" ? "Final" : "Upcoming"}
                </span>
                <div>
                  <div className="text-white font-bold">{campaign.name}</div>
                  <div className="text-xs text-slate-500">
                    {campaign.levels.length} levels ·{" "}
                    {new Date(campaign.startsAt).toLocaleDateString()} –{" "}
                    {new Date(campaign.endsAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3" />{" "}
                    {status === "live" ? "Time left" : status === "ended" ? "Closed" : "Starts in"}
                  </div>
                  <div className="text-white font-mono text-sm">
                    {status === "live"
                      ? formatCountdown(campaign.endsAt - now)
                      : status === "ended"
                        ? "—"
                        : formatCountdown(campaign.startsAt - now)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500">
                    Perfect
                  </div>
                  <div className="text-white font-mono text-sm">
                    {(campaign.levels.length * CAMPAIGN_MAX_POINTS).toLocaleString()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Classes double as a scope filter, so each has its own standings. */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setClassId(null);
                setVisible(PAGE);
              }}
              className={cn(
                "h-8 px-3 text-[10px] uppercase tracking-widest border border-white/10",
                classId === null
                  ? "bg-[var(--app-accent)] text-slate-950 font-bold"
                  : "text-slate-400",
              )}
            >
              Overall
            </Button>
            {campaign.classes.map((k) => (
              <Button
                key={k.id}
                size="sm"
                variant="ghost"
                onClick={() => {
                  setClassId(k.id);
                  setVisible(PAGE);
                }}
                className={cn(
                  "h-8 px-3 text-[10px] uppercase tracking-widest border gap-2",
                  classId === k.id ? "text-slate-950 font-bold" : "text-slate-300",
                )}
                style={
                  classId === k.id
                    ? { backgroundColor: k.color, borderColor: k.color }
                    : { borderColor: `${k.color}66` }
                }
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: classId === k.id ? "#0f172a" : k.color }}
                />
                {k.name}
              </Button>
            ))}
          </div>

          <Card className="bg-white/5 border-white/10">
            <CardHeader className="border-b border-white/10 bg-white/[0.02] py-3">
              <CardTitle className="text-base font-bold text-white">
                {classId ? `${classOf(classId)?.name} standings` : "Standings"} (
                {filtered.length.toLocaleString()} players)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-white/5">
              {filtered.slice(0, visible).map((row) => (
                <div key={row.username}>
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => (prev === row.username ? null : row.username))
                    }
                    className="w-full grid grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] md:grid-cols-[2.5rem_minmax(10rem,1fr)_auto_auto_auto] items-center gap-2 md:gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
                  >
                    <span className="font-mono text-xs text-slate-500">#{row.rank}</span>
                    <span className="min-w-0 truncate text-sm text-white">
                      {row.rank === 1 && (
                        <Trophy className="inline w-3.5 h-3.5 mr-1 text-amber-400" />
                      )}
                      {displayNameFor(profiles, row.username)}
                    </span>
                    <span className="font-mono text-sm text-[var(--app-accent)] font-bold text-right">
                      {row.points.toLocaleString()}
                    </span>
                    <span className="hidden md:block font-mono text-xs text-slate-500 text-right">
                      {row.levelsPlayed}/{row.levelCount} levels
                    </span>
                    <span className="font-mono text-xs text-slate-400 text-right">
                      {formatTime(row.totalTime)}
                    </span>
                  </button>

                  {expanded === row.username && (
                    <div className="px-4 pb-4 pt-1 bg-black/20">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 text-[10px] uppercase tracking-widest text-slate-500 pb-2 border-b border-white/5">
                        <span>Level</span>
                        <span className="text-right">Time</span>
                        <span className="text-right">Points</span>
                      </div>
                      {[...row.levels]
                        .sort((a, b) => b.points - a.points)
                        .map((l) => (
                          <button
                            key={l.levelId}
                            type="button"
                            onClick={() => onLevelClick?.(l.levelId)}
                            className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 py-1.5 text-left hover:bg-white/[0.03] items-center"
                          >
                            <span className="min-w-0 truncate text-sm text-slate-300 flex items-center gap-2">
                              <span
                                className="w-1.5 h-3 rounded-sm shrink-0"
                                style={{ backgroundColor: classOf(l.classId)?.color ?? "#64748B" }}
                              />
                              {l.levelName}
                              {l.position === 1 && (
                                <Medal className="w-3 h-3 text-amber-400 shrink-0" />
                              )}
                            </span>
                            <span className="font-mono text-xs text-slate-400 text-right">
                              {formatTime(l.time)}
                              <span className="text-slate-600 ml-2">
                                +{(l.time - l.wrTime).toFixed(3)}
                              </span>
                            </span>
                            <span className="font-mono text-xs text-[var(--app-accent)] text-right w-14">
                              {l.points.toLocaleString()}
                            </span>
                          </button>
                        ))}
                      {row.levelsPlayed < row.levelCount && (
                        <div className="pt-2 text-xs text-slate-500">
                          {row.levelCount - row.levelsPlayed} level
                          {row.levelCount - row.levelsPlayed === 1 ? "" : "s"} not played
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {filtered.length === 0 && (
                <div className="py-10 text-center text-sm text-slate-400">
                  {query ? "No player matches that search." : "No runs recorded yet."}
                </div>
              )}
            </CardContent>
          </Card>

          {filtered.length > visible && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                onClick={() => setVisible((v) => v + PAGE)}
                className="text-slate-400"
              >
                Show more
              </Button>
            </div>
          )}
        </>
      )}

      <CampaignCuratorDialog
        open={curatorOpen}
        onOpenChange={setCuratorOpen}
        onChanged={() => setReloadToken((t) => t + 1)}
      />
    </div>
  );
}
