import * as React from "react";
import { Globe, Loader2, Play, RefreshCw, Trophy, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchSiteRecords, type SiteRecord } from "@/lib/site-levels";

function fmt(ms: number): string {
  const total = ms / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

interface SiteRecordsViewProps {
  /** Play a site level in the Play tab, with the chosen arrow. */
  onPlay?: (levelId: string, arrowName?: string) => void;
  /** Jump to the site level browser (which owns the per-level boards). */
  onOpenLevels?: () => void;
}

/**
 * The site level records tracker: every site level with its record run, so the
 * records for site-hosted levels can be scanned in one place instead of opening
 * each level's own board. A level with no submissions shows as "no record".
 */
export function SiteRecordsView({ onPlay, onOpenLevels }: SiteRecordsViewProps) {
  const [records, setRecords] = React.useState<SiteRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await fetchSiteRecords());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const withRecords = records.filter((r) => r.timeMs !== null).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-[var(--app-accent)]" /> Site level records
          </h2>
          <p className="text-slate-500 text-sm">
            The record run on every site-hosted level, fastest first. {withRecords} of{" "}
            {records.length} level{records.length === 1 ? "" : "s"} ha
            {records.length === 1 ? "s" : "ve"} a time.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenLevels && (
            <Button variant="outline" size="sm" onClick={onOpenLevels}>
              <Globe className="w-3.5 h-3.5 mr-1.5" /> Browse levels
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {loading && records.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading site records…
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && records.length === 0 && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-500">
          No site levels yet. Build one in the Level editor and publish it to start a board.
        </div>
      )}

      {records.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Level</th>
                  <th className="px-3 py-2">Record</th>
                  <th className="px-3 py-2">Holder</th>
                  <th className="px-3 py-2">Arrow</th>
                  <th className="px-3 py-2">Players</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.levelId} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2 font-mono text-slate-400">
                      {r.timeMs === null ? (
                        "—"
                      ) : i === 0 ? (
                        <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                      ) : (
                        i + 1
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-slate-200 font-medium">{r.levelName}</span>
                        {r.hasCustomMechanics && (
                          <span
                            className="shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-300 flex items-center gap-1"
                            title="Uses site-only wind/suction fields"
                          >
                            <Wind className="w-2.5 h-2.5" /> custom
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500">by {r.author}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[var(--app-accent)]">
                      {r.timeMs !== null ? (
                        fmt(r.timeMs)
                      ) : (
                        <span className="text-slate-600">no record</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {r.holder ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-400 text-xs">{r.holderArrow ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-slate-500 text-xs">{r.completions}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end">
                        {onPlay && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title={`Play with ${r.holderArrow ?? r.arrowName}`}
                            onClick={() => onPlay(r.levelId, r.holderArrow ?? r.arrowName)}
                          >
                            <Play className="w-3.5 h-3.5" />
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
      )}
    </div>
  );
}
