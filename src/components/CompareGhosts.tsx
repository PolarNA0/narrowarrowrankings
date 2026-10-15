import { GitCompareArrows } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ghostColor } from "@/lib/compare-ghosts";
import type { CompareCandidate } from "@/hooks/useCompareGhosts";

interface GhostPickerProps {
  candidates: CompareCandidate[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}

/** The tick-list that turns other runs on this level into ghost overlays. */
export function GhostPicker({ candidates, selectedIds, onToggle, onClear }: GhostPickerProps) {
  if (candidates.length === 0) return null;
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
      <div className="space-y-1">
        {candidates.map((entry, index) => (
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
              style={{ backgroundColor: ghostColor(index) }}
            />
            <span className="text-xs text-slate-200 truncate">{entry.username}</span>
            {entry.kind !== "human" && (
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
      </div>
      {selectedIds.length > 0 && (
        <p className="text-[10px] text-slate-600">
          Ghosts are drawn as tinted trails with a matching arrow; the primary run stays on top.
        </p>
      )}
    </div>
  );
}
