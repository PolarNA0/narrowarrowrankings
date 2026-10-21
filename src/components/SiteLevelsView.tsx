import * as React from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Globe,
  Loader2,
  MoveHorizontal,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Trophy,
  Wind,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  fetchSiteLevel,
  fetchSiteLevels,
  fetchSiteScores,
  removeSiteLevel,
  removeSiteRun,
  type SiteLevelRecord,
  type SiteLevelSummary,
  type SiteScoreEntry,
} from "@/lib/site-levels";
import { TasReplayViewer } from "@/components/ReplayViewer";
import { siteLevelToRawData } from "@/lib/site-levels";
import { siteLevelShareUrl } from "@/lib/url-state";
import type { RawLevelData } from "@/lib/replay-sim";

/**
 * Copy a site level's share link. The link opens the level in Play, so pasting
 * it into Discord or a chat drops the reader straight into the level.
 */
function ShareLinkButton({
  levelId,
  arrowName,
  size = "sm",
  label,
}: {
  levelId: string;
  arrowName: string;
  size?: "sm" | "default";
  label?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    const url = siteLevelShareUrl(levelId, arrowName);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
    }
    setCopied(true);
    toast.success("Share link copied — it opens the level in Play.");
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      size={size}
      variant="outline"
      onClick={() => void copy()}
      title="Copy a link that opens this level in Play"
    >
      {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
      {label ?? "Link"}
    </Button>
  );
}

export interface SiteLoadRequest {
  levelId: string;
  arrowName: string;
  inputs: string;
  inputCount: number;
}

export interface SiteCheckpointRequest {
  levelId: string;
  arrowName: string;
  tick: number;
}

/**
 * The arrows a site level can be played with. A level ships a suggested arrow,
 * but the choice is never pinned — any arrow can run any level, and its own
 * leaderboard carries a per-run arrow.
 */
export const SITE_ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

/** A small arrow picker, shared by the level card and its detail header. */
function ArrowSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (arrow: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-[9.5rem] text-xs bg-white/5 border-white/10">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
        {SITE_ARROWS.map((a) => (
          <SelectItem key={a} value={a} className="text-xs">
            {a}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface SiteLevelsViewProps {
  isAdmin?: boolean;
  /** Open a run in the TAS editor. */
  onLoadRun?: (request: SiteLoadRequest) => void;
  /** Save a practice checkpoint off a watched run. */
  onMakeCheckpoint?: (request: SiteCheckpointRequest) => void;
  /** Play a site level in the Play tab, with the chosen arrow. */
  onPlay?: (levelId: string, arrowName?: string) => void;
}

function fmt(ms: number): string {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

/**
 * The site level browser. Site levels are authored with the Level editor and
 * hosted here, so they can use the site-only wind/suction mechanics the game's
 * engine has no concept of. Each level has its own leaderboard of finished
 * runs, which can be watched in place or loaded into the editor.
 */
export function SiteLevelsView({
  isAdmin,
  onLoadRun,
  onMakeCheckpoint,
  onPlay,
}: SiteLevelsViewProps) {
  const [levels, setLevels] = React.useState<SiteLevelSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  // Per-card arrow choice, so a level is not stuck on its author's suggestion.
  const [cardArrows, setCardArrows] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLevels(await fetchSiteLevels());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const remove = async (level: SiteLevelSummary) => {
    if (!window.confirm(`Remove "${level.name}" and its leaderboard?`)) return;
    try {
      setLevels(await removeSiteLevel(level.id));
      if (selected === level.id) setSelected(null);
      toast.success(`Removed ${level.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove that level.");
    }
  };

  if (selected) {
    return (
      <SiteLevelDetail
        levelId={selected}
        isAdmin={isAdmin}
        onBack={() => setSelected(null)}
        onPlay={onPlay}
        onLoadRun={onLoadRun}
        onMakeCheckpoint={onMakeCheckpoint}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Globe className="w-6 h-6 text-[var(--app-accent)]" /> Site levels
          </h2>
          <p className="text-slate-500 text-sm">
            Community levels built with the Level editor and hosted here — including ones that use
            the site-only wind and suction fields. Play them, or race the leaderboard.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {loading && levels.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading site levels…
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && levels.length === 0 && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-500">
          No site levels yet. Build one in the Level editor and hit{" "}
          <span className="text-slate-300">Publish as site level</span>.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {levels.map((level) => (
          <div
            key={level.id}
            className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3 flex flex-col"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button
                  className="truncate text-left font-semibold text-white hover:text-[var(--app-accent)]"
                  onClick={() => setSelected(level.id)}
                >
                  {level.name}
                </button>
                <p className="text-[11px] text-slate-500 truncate">
                  by {level.author} · {level.arrowName}
                </p>
              </div>
              {level.hasCustomMechanics && (
                <span
                  className="shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-300 flex items-center gap-1"
                  title="Uses site-only wind/suction fields"
                >
                  <Wind className="w-3 h-3" /> custom
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400 font-mono">
              <span>{level.obstacleCount} obstacles</span>
              <span>
                {level.completions} {level.completions === 1 ? "player" : "players"}
              </span>
              <span className="text-[var(--app-accent)]">
                {level.bestTimeMs != null ? fmt(level.bestTimeMs) : "no times"}
              </span>
            </div>

            <div className="flex-1" />
            {onPlay && (
              <ArrowSelect
                value={cardArrows[level.id] ?? level.arrowName}
                onChange={(arrow) => setCardArrows((m) => ({ ...m, [level.id]: arrow }))}
              />
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => setSelected(level.id)}
              >
                <Trophy className="w-3.5 h-3.5 mr-1.5" /> Leaderboard
              </Button>
              {onPlay && (
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => onPlay(level.id, cardArrows[level.id] ?? level.arrowName)}
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" /> Play
                </Button>
              )}
              <ShareLinkButton
                levelId={level.id}
                arrowName={cardArrows[level.id] ?? level.arrowName}
              />
              {isAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-400 hover:text-red-300"
                  onClick={() => void remove(level)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DetailProps {
  levelId: string;
  isAdmin?: boolean;
  onBack: () => void;
  onPlay?: (levelId: string, arrowName?: string) => void;
  onLoadRun?: (request: SiteLoadRequest) => void;
  onMakeCheckpoint?: (request: SiteCheckpointRequest) => void;
}

function SiteLevelDetail({
  levelId,
  isAdmin,
  onBack,
  onPlay,
  onLoadRun,
  onMakeCheckpoint,
}: DetailProps) {
  const [record, setRecord] = React.useState<SiteLevelRecord | null>(null);
  const [entries, setEntries] = React.useState<SiteScoreEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Which arrow to play with. Seeded from the level's suggested arrow, but the
  // player can switch it; it is never locked to the author's choice.
  const [playArrow, setPlayArrow] = React.useState<string>("Narrow Arrow");

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchSiteLevel(levelId), fetchSiteScores(levelId)])
      .then(([rec, scores]) => {
        if (cancelled) return;
        setRecord(rec);
        setEntries(scores);
        // Seed the play arrow from the level's suggestion (fall back to Narrow).
        if (rec?.arrowName) setPlayArrow(rec.arrowName);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [levelId]);

  // The geometry is handed to the replay viewer so it never hits the upstream
  // level API (a site level does not exist there).
  const levelData: RawLevelData | null = React.useMemo(
    () => (record ? siteLevelToRawData(record) : null),
    [record],
  );

  const removeEntry = async (entry: SiteScoreEntry) => {
    try {
      setEntries(await removeSiteRun(levelId, entry.id));
      toast.success(`Removed ${entry.username}'s run`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove that run.");
    }
  };

  const ghosts = React.useMemo(
    () =>
      entries.map((e) => ({
        id: e.id,
        username: e.username,
        timeMs: e.timeMs,
        arrowName: e.arrowName,
        inputCount: e.inputCount,
        inputs: e.inputs,
      })),
    [entries],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="w-3.5 h-3.5" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold text-white">{record?.name ?? "Site level"}</h2>
            <p className="text-slate-500 text-sm">
              {record ? `by ${record.author} · ${record.arrowName}` : "Loading…"}
            </p>
          </div>
        </div>
        {onPlay && (
          <div className="flex items-center gap-2">
            <ArrowSelect value={playArrow} onChange={setPlayArrow} />
            <ShareLinkButton levelId={levelId} arrowName={playArrow} />
            <Button size="sm" onClick={() => onPlay(levelId, playArrow)}>
              <Play className="w-3.5 h-3.5 mr-1.5" /> Play
            </Button>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading…
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {record && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-[11px] text-slate-400 font-mono flex flex-wrap gap-x-5 gap-y-1">
          <span>{record.data.obstacles.length} obstacles</span>
          <span>{entries.length} runs</span>
          {entries.length > 0 && (
            <span className="text-[var(--app-accent)]">WR {fmt(entries[0].timeMs)}</span>
          )}
          {record.data.obstacles.some((o) => o.field_type) && (
            <span className="text-cyan-300 flex items-center gap-1">
              <Wind className="w-3 h-3" /> site-only mechanics
            </span>
          )}
          {record.data.obstacles.some((o) => o.motion_period) && (
            <span className="text-amber-300 flex items-center gap-1">
              <MoveHorizontal className="w-3 h-3" /> moving blocks
            </span>
          )}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Arrow</th>
                <th className="px-3 py-2">Inputs</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                    No runs yet — be the first to post a time.
                  </td>
                </tr>
              )}
              {entries.map((e, i) => (
                <tr key={e.id} className="border-b border-white/5 last:border-0">
                  <td className="px-3 py-2 font-mono text-slate-400">
                    {i === 0 ? <Trophy className="w-3.5 h-3.5 text-yellow-400" /> : i + 1}
                  </td>
                  <td className="px-3 py-2 text-slate-200">{e.username}</td>
                  <td className="px-3 py-2 font-mono text-[var(--app-accent)]">{fmt(e.timeMs)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{e.arrowName}</td>
                  <td className="px-3 py-2 font-mono text-slate-500 text-xs">{e.inputCount}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <TasReplayViewer
                        levelId={levelId}
                        levelName={record?.name}
                        username={e.username}
                        arrowName={e.arrowName}
                        inputs={e.inputs}
                        inputCount={e.inputCount}
                        timeMs={e.timeMs}
                        levelData={levelData}
                        boardEntries={ghosts}
                        onMakeCheckpoint={
                          onMakeCheckpoint
                            ? (cp) =>
                                onMakeCheckpoint({
                                  levelId,
                                  arrowName: cp.arrowName,
                                  tick: cp.tick,
                                })
                            : undefined
                        }
                      />
                      {onLoadRun && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Load into the TAS editor"
                          onClick={() =>
                            onLoadRun({
                              levelId,
                              arrowName: e.arrowName,
                              inputs: e.inputs,
                              inputCount: e.inputCount,
                            })
                          }
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300"
                          onClick={() => void removeEntry(e)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
