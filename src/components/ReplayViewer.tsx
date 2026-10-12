import * as React from "react";
import { Play, Loader2, Gamepad2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  REPLAY_SYMBOLS,
  REPLAY_TICK_MS,
  formatReplayInput,
  summariseReplay,
  type ReplaySymbolKey,
  type ReplaySummary,
} from "@/lib/replay";

interface ReplayViewerProps {
  runId: number | string;
  username?: string;
  levelName?: string;
  className?: string;
}

interface RunPayload {
  inputs?: string;
  input_count?: number;
  completion_time?: number;
  mapName?: string;
  arrow_name?: string;
}

const SYMBOL_TONE: Record<ReplaySymbolKey, string> = {
  left: "bg-[#3b82f6]",
  right: "bg-[#f59e0b]",
  neutral: "bg-slate-600",
  brake: "bg-rose-500",
};

const SYMBOL_TEXT: Record<ReplaySymbolKey, string> = {
  left: "text-[#60a5fa]",
  right: "text-[#fbbf24]",
  neutral: "text-slate-400",
  brake: "text-rose-400",
};

/**
 * Opens a run's replay and breaks it down into held inputs. The dropdown lists
 * every input with how long it was held, e.g. "r72" = right held for 72ms.
 */
export function ReplayViewer({ runId, username, levelName, className }: ReplayViewerProps) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [summary, setSummary] = React.useState<ReplaySummary | null>(null);
  const [meta, setMeta] = React.useState<RunPayload | null>(null);
  const [selected, setSelected] = React.useState(0);
  const loadedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const key = String(runId);
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    let cancelled = false;
    setState("loading");
    fetch(`/api/runs/${encodeURIComponent(key)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: RunPayload) => {
        if (cancelled) return;
        setMeta(data);
        setSummary(summariseReplay(data.inputs ?? "", data.input_count));
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        if (loadedRef.current === key) loadedRef.current = null;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open, runId]);

  const inputs = summary?.inputs ?? [];
  const active = inputs[selected];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="View replay inputs"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-slate-500 hover:text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10 h-8 w-8",
            className,
          )}
        >
          <Play className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#0d0d10] border-white/10 text-slate-200 max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Gamepad2 className="w-4 h-4 text-[var(--app-accent)]" />
            Replay inputs
            {username && <span className="text-slate-400 font-normal">· {username}</span>}
          </DialogTitle>
        </DialogHeader>

        {state === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading replay…
          </div>
        )}

        {state === "error" && (
          <div className="py-16 text-center text-slate-500 text-sm italic">
            Replay not available for this run.
          </div>
        )}

        {state === "ready" && summary && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span>{meta?.mapName ?? levelName ?? "Level"}</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{meta?.arrow_name ?? "Arrow"}</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{summary.tickCount} inputs @ {(1000 / REPLAY_TICK_MS).toFixed(0)}Hz</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{(summary.durationMs / 1000).toFixed(2)}s</span>
            </div>

            {inputs.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm italic">
                No input data recorded for this run.
              </div>
            ) : (
              <>
                {/* Totals per input state */}
                <div className="grid grid-cols-4 gap-2">
                  {REPLAY_SYMBOLS.map((symbol) => (
                    <div
                      key={symbol.key}
                      className="bg-black/30 rounded-lg p-2 text-center border border-white/5"
                    >
                      <div className={cn("text-sm font-extrabold font-mono", SYMBOL_TEXT[symbol.key])}>
                        {symbol.short}
                      </div>
                      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">
                        {symbol.label}
                      </div>
                      <div className="text-xs font-mono text-slate-300 mt-0.5">
                        {(summary.totals[symbol.key] / 1000).toFixed(2)}s
                      </div>
                    </div>
                  ))}
                </div>

                {/* Dropdown: one entry per held input */}
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                    Jump to input ({inputs.length} segments)
                  </label>
                  <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
                    <SelectTrigger className="bg-black/30 border-white/10 text-slate-200 font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200 max-h-[320px]">
                      {inputs.map((input) => (
                        <SelectItem
                          key={input.index}
                          value={String(input.index)}
                          className="font-mono text-xs"
                        >
                          <span className={cn("font-bold mr-2", SYMBOL_TEXT[input.key])}>
                            {formatReplayInput(input)}
                          </span>
                          <span className="text-slate-500">
                            #{input.index} @ {(input.atMs / 1000).toFixed(2)}s
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Selected input detail */}
                {active && (
                  <div className="bg-black/30 rounded-lg p-3 border border-white/5 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                        Selected input
                      </div>
                      <div className={cn("text-2xl font-extrabold font-mono", SYMBOL_TEXT[active.key])}>
                        {formatReplayInput(active)}
                      </div>
                    </div>
                    <div className="text-right text-xs text-slate-400 font-mono space-y-0.5">
                      <div>
                        {REPLAY_SYMBOLS.find((s) => s.key === active.key)?.label} held for{" "}
                        <span className="text-slate-200">{Math.round(active.heldMs)}ms</span>
                      </div>
                      <div>
                        starts at <span className="text-slate-200">{active.atMs.toFixed(1)}ms</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timeline strip */}
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-1.5">
                    Timeline
                  </div>
                  <div className="flex h-6 w-full overflow-hidden rounded bg-black/40">
                    {inputs.map((input) => (
                      <button
                        key={input.index}
                        type="button"
                        title={`${formatReplayInput(input)} @ ${(input.atMs / 1000).toFixed(2)}s`}
                        onClick={() => setSelected(input.index)}
                        style={{ flexGrow: input.heldMs }}
                        className={cn(
                          "h-full transition-opacity",
                          SYMBOL_TONE[input.key],
                          input.index === selected ? "opacity-100" : "opacity-60 hover:opacity-90",
                        )}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
