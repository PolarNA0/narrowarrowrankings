import * as React from "react";
import { History, Target } from "lucide-react";
import type { LeaderboardEntry, LegacyRun } from "../types";
import { toStandings } from "@/lib/medals";

interface Props {
  levelId: string;
  username: string;
  bestTime: number;
  bestDate?: string;
  standings?: LeaderboardEntry[];
  legacyRuns?: LegacyRun[];
  colSpan: number;
}

/** Expandable per-level detail: past PBs plus the times needed to climb. */
export function LevelHistoryDetail({
  levelId,
  username,
  bestTime,
  bestDate,
  standings,
  legacyRuns,
  colSpan,
}: Props) {
  const board = React.useMemo(() => toStandings(standings || []), [standings]);
  const position = React.useMemo(() => {
    const idx = board.findIndex((entry) => entry.username.toLowerCase() === username.toLowerCase());
    return idx >= 0 ? idx + 1 : null;
  }, [board, username]);

  const history = React.useMemo(() => {
    const rows = (legacyRuns || [])
      .filter(
        (run) =>
          run.levelId === levelId && run.username.toLowerCase() === username.toLowerCase(),
      )
      .map((run) => ({
        time: run.completionTime,
        date: run.createdAt || run.addedAt || "",
        source: "Legacy run",
      }));
    rows.push({ time: bestTime, date: bestDate || "", source: "Current PB" });
    return rows
      .filter((row, index, all) => all.findIndex((r) => Math.abs(r.time - row.time) < 1e-6) === index)
      .sort((a, b) => b.time - a.time);
  }, [legacyRuns, levelId, username, bestTime, bestDate]);

  const targets = React.useMemo(() => {
    const marks: Array<{ label: string; time: number }> = [];
    const add = (label: string, index: number) => {
      const entry = board[index];
      if (entry && entry.completion_time < bestTime) marks.push({ label, time: entry.completion_time });
    };
    add("World record", 0);
    add("Podium (3rd)", 2);
    add("Top 10", 9);
    add("Top 25", 24);
    return marks;
  }, [board, bestTime]);

  const improvement = history.length > 1 ? history[0].time - bestTime : 0;

  return (
    <tr className="border-white/5 bg-black/30">
      <td colSpan={colSpan} className="p-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <h5 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1.5 mb-2">
              <History className="w-3 h-3" /> Personal best history
            </h5>
            <div className="space-y-1.5">
              {history.map((row, index) => (
                <div
                  key={`${row.time}-${index}`}
                  className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5"
                >
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                    {row.source}
                    {row.date ? ` · ${new Date(row.date).toLocaleDateString()}` : ""}
                  </span>
                  <span
                    className={
                      index === history.length - 1
                        ? "font-mono font-bold text-[#2DD4BF]"
                        : "font-mono text-slate-400"
                    }
                  >
                    {row.time.toFixed(3)}s
                  </span>
                </div>
              ))}
              {improvement > 0 && (
                <p className="text-[11px] font-mono text-emerald-400">
                  Improved by {improvement.toFixed(3)}s since the earliest recorded run.
                </p>
              )}
              {history.length === 1 && (
                <p className="text-[11px] font-mono text-slate-600">
                  Only one recorded run — older times appear here once they are archived.
                </p>
              )}
            </div>
          </div>

          <div>
            <h5 className="text-[10px] uppercase tracking-widest font-bold text-slate-500 flex items-center gap-1.5 mb-2">
              <Target className="w-3 h-3" /> Time targets
            </h5>
            {position && (
              <p className="text-[11px] font-mono text-slate-400 mb-2">
                Currently #{position} of {board.length} runners.
              </p>
            )}
            <div className="space-y-1.5">
              {targets.length === 0 && (
                <p className="text-[11px] font-mono text-amber-400">Nothing left to chase here — top of the board.</p>
              )}
              {targets.map((target) => (
                <div
                  key={target.label}
                  className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5"
                >
                  <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">{target.label}</span>
                  <span className="font-mono text-xs text-slate-200">
                    {target.time.toFixed(3)}s{" "}
                    <span className="text-rose-400">(-{(bestTime - target.time).toFixed(3)}s)</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
