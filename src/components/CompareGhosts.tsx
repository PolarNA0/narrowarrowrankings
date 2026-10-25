import * as React from "react";
import { GitCompareArrows } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ghostColor } from "@/lib/compare-ghosts";
import type { CompareCandidate } from "@/hooks/useCompareGhosts";

interface GhostPickerProps {
  candidates: CompareCandidate[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}

/**
 * Cap how many rows are mounted. A level's human board can hold hundreds of
 * runs, and the replay re-renders its dialog on every animation frame — mounting
 * the whole board meant reconciling hundreds of checkboxes 60+ times a second,
 * which is what made a run's replay crawl. The list is already sorted fastest
 * first, so the fastest 40 are the useful ones to compare against.
 */
const MAX_ROWS = 40;

/** Which board the list is showing. */
type GhostSource = "all" | "human" | "tas";

/**
 * The tick-list that turns other runs on this level into ghost overlays. The
 * human leaderboard and the TAS board are offered as separate sources: a busy
 * level's human board alone can fill the row cap, which used to push every TAS
 * entry out of view before it could be ticked. Memoised — the replay dialog
 * re-renders every animation frame, and this list is far too expensive to
 * rebuild that often.
 */
export const GhostPicker = React.memo(function GhostPicker({
  candidates,
  selectedIds,
  onToggle,
  onClear,
}: GhostPickerProps) {
  const [source, setSource] = React.useState<GhostSource>("all");

  const humanCount = candidates.filter((c) => c.kind === "human").length;
  const tasCount = candidates.filter((c) => c.kind === "tas").length;

  // A ghost's colour is its position in the full candidate list, so filtering
  // must not renumber the swatches — a TAS entry has to keep the colour it is
  // drawn with on the stage.
  const colorIndex = React.useMemo(() => {
    const map = new Map<string, number>();
    candidates.forEach((c, i) => map.set(c.id, i));
    return map;
  }, [candidates]);

  const filtered = React.useMemo(
    () =>
      source === "all" ? candidates : candidates.filter((c) => (c.kind ?? "human") === source),
    [candidates, source],
  );
  const rows = filtered.length > MAX_ROWS ? filtered.slice(0, MAX_ROWS) : filtered;

  if (candidates.length === 0) return null;

  // Only offer the toggle when there is a choice to make.
  const showToggle = humanCount > 0 && tasCount > 0;

  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <GitCompareArrows className="w-3.5 h-3.5 text-[var(--app-accent)]" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
          Compare runs
        </span>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
          >
            Clear
          </button>
        )}
      </div>
      {showToggle && (
        <div className="flex items-center gap-1">
          {[
            { key: "all" as const, label: "All", count: candidates.length },
            { key: "human" as const, label: "Leaderboard", count: humanCount },
            { key: "tas" as const, label: "TAS", count: tasCount },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSource(tab.key)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                source === tab.key
                  ? "bg-[var(--app-accent)]/15 text-[var(--app-accent)]"
                  : "text-slate-500 hover:text-slate-300",
              )}
            >
              {tab.label}
              <span className="ml-1 text-slate-600">{tab.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((entry) => (
          <label
            key={entry.id}
            className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 hover:bg-white/[0.03]"
          >
            <Checkbox
              checked={selectedIds.includes(entry.id)}
              onCheckedChange={() => onToggle(entry.id)}
              aria-label={`Compare ${entry.username}`}
            />
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: ghostColor(colorIndex.get(entry.id) ?? 0) }}
            />
            <span className="text-xs text-slate-200 truncate">{entry.username}</span>
            {entry.kind === "tas" && (
              <span className="text-[9px] uppercase tracking-wider text-[var(--app-accent)]/80 shrink-0">
                TAS
              </span>
            )}
            <span className="text-[11px] text-slate-500 truncate hidden sm:inline">
              {entry.arrowName}
            </span>
            <span className="ml-auto font-mono text-[11px] text-slate-400">
              {(entry.timeMs / 1000).toFixed(3)}s
            </span>
          </label>
        ))}
        {rows.length === 0 && (
          <p className="text-[11px] text-slate-600 italic px-1">No runs on this board.</p>
        )}
        {filtered.length > MAX_ROWS && (
          <p className="text-[10px] text-slate-600 px-1">
            Showing the fastest {MAX_ROWS} of {filtered.length}.
          </p>
        )}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-[10px] text-slate-600">
          Ghosts are drawn as tinted trails with a matching arrow; the primary run stays on top.
        </p>
      )}
    </div>
  );
});
