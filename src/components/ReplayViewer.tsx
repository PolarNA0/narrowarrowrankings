import * as React from "react";
import { Play, Pause, Loader2, Gamepad2, Info, RotateCcw, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  REPLAY_SYMBOLS,
  REPLAY_TICK_MS,
  detectCombo,
  formatReplayInput,
  summariseReplay,
  type ReplaySymbolKey,
  type ReplaySummary,
} from "@/lib/replay";
import {
  SIM_TICK_MS,
  levelWalls,
  simulateRun,
  type RawLevelData,
  type SimWall,
} from "@/lib/replay-sim";

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
  neutral: "bg-slate-600",
  left: "bg-[#3b82f6]",
  right: "bg-[#f59e0b]",
  brake: "bg-rose-500",
};

const SYMBOL_TEXT: Record<ReplaySymbolKey, string> = {
  neutral: "text-slate-400",
  left: "text-[#60a5fa]",
  right: "text-[#fbbf24]",
  brake: "text-rose-400",
};

const WALL_STYLE: Record<string, { stroke: string; width: number }> = {
  normal: { stroke: "#64748b", width: 1 },
  death: { stroke: "#ef4444", width: 1.4 },
  bouncy: { stroke: "#eab308", width: 1.4 },
  boost: { stroke: "#38bdf8", width: 1.8 },
  finish: { stroke: "#22c55e", width: 4 },
};

/** Playback speeds offered for the animated replay. */
const SPEEDS = [0.5, 1, 2, 4];

/**
 * Opens a run's replay. The primary view is an animation reconstructed from the
 * recorded inputs and the level geometry; an info menu breaks the same run down
 * into its held inputs (Input) and its press sequence (Combo).
 */
export function ReplayViewer({ runId, username, levelName, className }: ReplayViewerProps) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [summary, setSummary] = React.useState<ReplaySummary | null>(null);
  const [meta, setMeta] = React.useState<RunPayload | null>(null);
  const [walls, setWalls] = React.useState<SimWall[]>([]);
  const [sim, setSim] = React.useState<ReturnType<typeof simulateRun> | null>(null);
  const [selected, setSelected] = React.useState(0);
  const [panel, setPanel] = React.useState<"none" | "input" | "combo">("none");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [playing, setPlaying] = React.useState(true);
  const [frame, setFrame] = React.useState(0);
  const [speed, setSpeed] = React.useState(1);
  const [attempt, setAttempt] = React.useState(0);
  const loadedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const key = String(runId);
    if (loadedRef.current === key && attempt === 0) return;
    loadedRef.current = key;
    let cancelled = false;
    setState("loading");
    setSim(null);
    setWalls([]);
    setPanel("none");
    setFrame(0);
    setPlaying(true);

    (async () => {
      try {
        // Client-side timeout: the server proxy already bounds upstream, but a
        // stalled network hop must not leave the dialog on "Loading replay…".
        const res = await fetch(`/api/runs/${encodeURIComponent(key)}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as RunPayload;
        if (cancelled) return;
        setMeta(data);
        setSummary(summariseReplay(data.inputs ?? "", data.input_count));

        // Level geometry is only needed for the animation; if it is slow or
        // missing, show the input breakdown rather than blocking on it.
        if (data.mapName) {
          try {
            const levelRes = await fetch(`/api/level-details/${encodeURIComponent(data.mapName)}`, {
              signal: AbortSignal.timeout(20000),
            });
            if (levelRes.ok) {
              const payload = (await levelRes.json()) as { levelInfo?: { data?: RawLevelData } };
              const levelData = payload.levelInfo?.data ?? null;
              if (levelData && !cancelled) {
                setWalls(levelWalls(levelData));
                setSim(simulateRun(data.inputs ?? "", data.input_count, levelData));
              }
            }
          } catch {
            /* animation is optional; fall back to the input breakdown */
          }
        }
        if (cancelled) return;
        setState("ready");
      } catch {
        if (cancelled) return;
        if (loadedRef.current === key) loadedRef.current = null;
        setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, runId, attempt]);

  const inputs = summary?.inputs ?? [];
  const active = inputs[selected];
  const combo = React.useMemo(() => (summary ? detectCombo(summary) : null), [summary]);
  const pathLength = sim?.path.length ?? 0;

  // Drive the animation while playing.
  React.useEffect(() => {
    if (!open || !playing || !sim || pathLength === 0) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = now - last;
      last = now;
      setFrame((f) => {
        const next = f + (elapsed / SIM_TICK_MS) * speed;
        if (next >= pathLength - 1) {
          setPlaying(false);
          return pathLength - 1;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, sim, pathLength, speed]);

  const replayTimeMs = frame * SIM_TICK_MS;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="View replay"
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
            Replay
            {username && <span className="text-slate-400 font-normal">· {username}</span>}
          </DialogTitle>
        </DialogHeader>

        {state === "loading" && (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading replay…
          </div>
        )}

        {state === "error" && (
          <div className="py-16 text-center text-sm">
            <p className="text-slate-500 italic mb-4">Replay couldn't be loaded.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                loadedRef.current = null;
                setAttempt((n) => n + 1);
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {state === "ready" && summary && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span>{meta?.mapName ?? levelName ?? "Level"}</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{meta?.arrow_name ?? "Arrow"}</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">
                {summary.tickCount} inputs @ {(1000 / REPLAY_TICK_MS).toFixed(0)}Hz
              </span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{(summary.durationMs / 1000).toFixed(2)}s</span>
            </div>

            {sim && pathLength > 0 ? (
              <ReplayStage
                sim={sim}
                walls={walls}
                frame={frame}
                playing={playing}
                speed={speed}
                replayTimeMs={replayTimeMs}
                onTogglePlay={() => {
                  if (frame >= pathLength - 1) setFrame(0);
                  setPlaying((p) => !p);
                }}
                onScrub={(value) => {
                  setPlaying(false);
                  setFrame(value);
                }}
                onSpeed={setSpeed}
              />
            ) : (
              <div className="rounded-lg border border-white/5 bg-black/30 py-10 text-center text-slate-500 text-xs italic">
                Level geometry unavailable — showing the input breakdown only.
              </div>
            )}

            {/* Info menu: Input / Combo */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMenuOpen((v) => !v)}
                className="text-xs text-slate-400 hover:text-white"
              >
                <Info className="w-3.5 h-3.5 mr-1.5" /> Run info
                <ChevronDown
                  className={cn("w-3.5 h-3.5 ml-1 transition-transform", menuOpen && "rotate-180")}
                />
              </Button>
              {menuOpen && (
                <div className="flex gap-1 animate-in fade-in slide-in-from-left-2">
                  <Button
                    variant={panel === "input" ? "secondary" : "ghost"}
                    size="sm"
                    className="text-xs"
                    onClick={() => setPanel("input")}
                  >
                    Input
                  </Button>
                  <Button
                    variant={panel === "combo" ? "secondary" : "ghost"}
                    size="sm"
                    className="text-xs"
                    onClick={() => setPanel("combo")}
                  >
                    Combo
                  </Button>
                </div>
              )}
            </div>

            {panel === "combo" && (
              <div className="bg-black/30 rounded-lg p-4 border border-white/5 space-y-2">
                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                  Press sequence
                </div>
                {combo ? (
                  <>
                    <div className="font-mono text-lg font-extrabold text-[var(--app-accent)] break-words">
                      {combo.sequence}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {combo.segments} steering segments · spans{" "}
                      {(combo.durationMs / 1000).toFixed(2)}s (L = left, R = right, "/" = mashed
                      together, "→" = separate press)
                    </div>
                  </>
                ) : (
                  <div className="text-slate-500 text-sm italic">
                    No steering input recorded for this run.
                  </div>
                )}
              </div>
            )}

            {panel === "input" && (
              <div className="space-y-3">
                {inputs.length === 0 ? (
                  <div className="py-8 text-center text-slate-500 text-sm italic">
                    No input data recorded for this run.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-4 gap-2">
                      {REPLAY_SYMBOLS.map((symbol) => (
                        <div
                          key={symbol.key}
                          className="bg-black/30 rounded-lg p-2 text-center border border-white/5"
                        >
                          <div
                            className={cn(
                              "text-sm font-extrabold font-mono",
                              SYMBOL_TEXT[symbol.key],
                            )}
                          >
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

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                        Jump to input ({inputs.length} segments)
                      </label>
                      <Select
                        value={String(selected)}
                        onValueChange={(v) => {
                          const index = Number(v);
                          setSelected(index);
                          setPlaying(false);
                          setFrame(Math.round((inputs[index]?.atMs ?? 0) / SIM_TICK_MS));
                        }}
                      >
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

                    {active && (
                      <div className="bg-black/30 rounded-lg p-3 border border-white/5 flex items-center justify-between">
                        <div>
                          <div className="text-[10px] uppercase tracking-widest font-bold text-slate-500">
                            Selected input
                          </div>
                          <div
                            className={cn(
                              "text-2xl font-extrabold font-mono",
                              SYMBOL_TEXT[active.key],
                            )}
                          >
                            {formatReplayInput(active)}
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-400 font-mono space-y-0.5">
                          <div>
                            {REPLAY_SYMBOLS.find((s) => s.key === active.key)?.label} held for{" "}
                            <span className="text-slate-200">{Math.round(active.heldMs)}ms</span>
                          </div>
                          <div>
                            starts at{" "}
                            <span className="text-slate-200">{active.atMs.toFixed(1)}ms</span>
                          </div>
                        </div>
                      </div>
                    )}

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
                              input.index === selected
                                ? "opacity-100"
                                : "opacity-60 hover:opacity-90",
                            )}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface StageProps {
  sim: ReturnType<typeof simulateRun>;
  walls: SimWall[];
  frame: number;
  playing: boolean;
  speed: number;
  replayTimeMs: number;
  onTogglePlay: () => void;
  onScrub: (value: number) => void;
  onSpeed: (value: number) => void;
}

function ReplayStage({
  sim,
  walls,
  frame,
  playing,
  speed,
  replayTimeMs,
  onTogglePlay,
  onScrub,
  onSpeed,
}: StageProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = parent.clientWidth;
    const height = 320;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // World bounds: the level plus the simulated path.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of walls) {
      minX = Math.min(minX, w.ax, w.bx);
      minY = Math.min(minY, w.ay, w.by);
      maxX = Math.max(maxX, w.ax, w.bx);
      maxY = Math.max(maxY, w.ay, w.by);
    }
    for (const p of sim.path) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minX)) return;
    const pad = 40;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(width / spanX, height / spanY);
    const offX = (width - spanX * scale) / 2 - minX * scale;
    const offY = (height - spanY * scale) / 2 - minY * scale;
    const tx = (wx: number) => wx * scale + offX;
    const ty = (wy: number) => wy * scale + offY;

    // Walls.
    ctx.lineCap = "round";
    for (const w of walls) {
      const style = WALL_STYLE[w.type] ?? WALL_STYLE.normal;
      ctx.strokeStyle = w.type === "finish" ? style.stroke : "rgba(100,116,139,0.35)";
      ctx.lineWidth = style.width;
      ctx.beginPath();
      ctx.moveTo(tx(w.ax), ty(w.ay));
      ctx.lineTo(tx(w.bx), ty(w.by));
      ctx.stroke();
    }

    if (sim.path.length === 0) return;
    const safeFrame = Number.isFinite(frame) ? Math.floor(frame) : 0;
    const upto = Math.max(0, Math.min(safeFrame, sim.path.length - 1));
    // Travelled path.
    ctx.strokeStyle = "rgba(56,189,248,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) {
      const p = sim.path[i];
      if (i === 0) ctx.moveTo(tx(p.x), ty(p.y));
      else ctx.lineTo(tx(p.x), ty(p.y));
    }
    ctx.stroke();

    // Arrow at the current position.
    const point = sim.path[upto];
    const len = 9;
    const wid = 6;
    const cos = Math.cos(point.rot);
    const sin = Math.sin(point.rot);
    const tipX = tx(point.x) + cos * len;
    const tipY = ty(point.y) + sin * len;
    const leftX = tx(point.x) - sin * wid - cos * wid;
    const leftY = ty(point.y) + cos * wid - sin * wid;
    const rightX = tx(point.x) + sin * wid - cos * wid;
    const rightY = ty(point.y) - cos * wid - sin * wid;
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.closePath();
    ctx.fill();

    if (sim.finishTick !== null && upto >= sim.finishTick) {
      ctx.fillStyle = "#22c55e";
      ctx.font = "bold 11px monospace";
      ctx.fillText("FINISH", 8, 16);
    }
  }, [sim, walls, frame]);

  const maxFrame = Math.max(1, sim.path.length - 1);
  return (
    <div className="space-y-2">
      <div className="rounded-lg overflow-hidden border border-white/10 bg-[#06060a]">
        <canvas ref={canvasRef} />
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-300"
          onClick={onTogglePlay}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-slate-300"
          onClick={() => onScrub(0)}
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <input
          type="range"
          min={0}
          max={maxFrame}
          value={Math.floor(frame)}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="flex-1 accent-[var(--app-accent)]"
          aria-label="Replay scrubber"
        />
        <span className="font-mono text-[11px] text-slate-400 w-14 text-right">
          {(replayTimeMs / 1000).toFixed(2)}s
        </span>
        <Select value={String(speed)} onValueChange={(v) => onSpeed(Number(v))}>
          <SelectTrigger className="h-8 w-16 bg-black/30 border-white/10 text-xs font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)} className="text-xs font-mono">
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[10px] text-slate-600">
        Animation reconstructed from the recorded inputs and level geometry — approximate, not
        frame-perfect.
      </p>
    </div>
  );
}
