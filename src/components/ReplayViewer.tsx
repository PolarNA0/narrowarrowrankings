import * as React from "react";
import {
  Play,
  Pause,
  Loader2,
  Gamepad2,
  Info,
  RotateCcw,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
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
import { LEVELS } from "@/constants";
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
  arrowConstants,
  levelGeometry,
  simulateRun,
  type RawLevelData,
  type SimGeometry,
  type SimResult,
  type SimPortal,
  type SimWall,
} from "@/lib/replay-sim";
import {
  themeColor,
  thrustColor,
  trailColor,
  wallVisual,
  withAlpha,
  lighten,
  type SkinConfig,
} from "@/lib/replay-visuals";
import { arrowKind, drawArrowSprite, type ArrowKind } from "@/lib/arrow-sprites";
import {
  CAMERA_PRESETS,
  DEFAULT_CAMERA,
  FollowCamera,
  GAME_COLLISION_COLOR,
  GAME_FINISH_THICKNESS,
  GAME_PORTAL_COLORS,
  GAME_THRUST_COLORS,
  GAME_WALL_THICKNESS,
  cameraPreset,
  checkerAt,
  gameWallColor,
  gameZoneColor,
  type CameraPreset,
  type CameraSettings,
} from "@/lib/replay-render";
import { ghostColor } from "@/lib/compare-ghosts";
import { GhostPicker } from "@/components/CompareGhosts";
import { ghostLabel, useCompareGhosts, type CompareCandidate } from "@/hooks/useCompareGhosts";
import bounceIcon from "@/assets/game/bounce.svg";
import skullIcon from "@/assets/game/skull.svg";
import finishIcon from "@/assets/game/finish_line_icon.svg";
import flameIcon from "@/assets/game/flame.svg";
import portalIcon from "@/assets/game/portal.svg";
import railIcon from "@/assets/game/rail.svg";
import zoneIcon from "@/assets/game/zone.svg";

interface ReplayViewerProps {
  runId: number | string;
  username?: string;
  levelName?: string;
  className?: string;
  /**
   * Other runs on this level to compare against, TAS or real-game. A real-game
   * candidate carries its `runId` and is fetched on demand.
   */
  boardEntries?: CompareCandidate[];
}

interface RunPayload {
  inputs?: string;
  input_count?: number;
  completion_time?: number;
  mapName?: string;
  arrow_name?: string;
  skinConfig?: SkinConfig;
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

/** Playback speeds offered for the animated replay. */
const SPEEDS = [0.5, 1, 2, 4];

/**
 * Opens a run's replay. The primary view is an animation reconstructed from the
 * recorded inputs and the level geometry; an info menu breaks the same run down
 * into its held inputs (Input) and its press sequence (Combo).
 */
export function ReplayViewer({
  runId,
  username,
  levelName,
  className,
  boardEntries,
}: ReplayViewerProps) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [summary, setSummary] = React.useState<ReplaySummary | null>(null);
  const [levelData, setLevelData] = React.useState<RawLevelData | null>(null);
  const [selectedGhostIds, setSelectedGhostIds] = React.useState<string[]>([]);
  const [meta, setMeta] = React.useState<RunPayload | null>(null);
  const [geometry, setGeometry] = React.useState<SimGeometry>({
    walls: [],
    zones: [],
    portals: [],
  });
  const [sim, setSim] = React.useState<SimResult | null>(null);
  const [selected, setSelected] = React.useState(0);
  const [panel, setPanel] = React.useState<"none" | "input" | "combo">("none");
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [playing, setPlaying] = React.useState(true);
  const [frame, setFrame] = React.useState(0);
  const [speed, setSpeed] = React.useState(1);
  const [attempt, setAttempt] = React.useState(0);
  const loadedRef = React.useRef<string | null>(null);

  // The run's own skin: the game tints the arrow, trail and thrust with it.
  const skin = meta?.skinConfig ?? null;
  const bodyColor = themeColor(skin);
  const trail = trailColor(skin);
  const thrust = thrustColor(skin);
  // The arrow sprite and hitbox radius the run actually flew.
  const arrow = arrowKind(meta?.arrow_name);
  const arrowRadius = arrowConstants(meta?.arrow_name).radius ?? 16;

  React.useEffect(() => {
    if (!open) return;
    const key = String(runId);
    if (loadedRef.current === key && attempt === 0) return;
    loadedRef.current = key;
    let cancelled = false;
    setState("loading");
    setSim(null);
    setGeometry({ walls: [], zones: [], portals: [] });
    setLevelData(null);
    setSelectedGhostIds([]);
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
        const levelKey = data.mapName
          ? (LEVELS.find((l) => l.name.toLowerCase() === data.mapName!.toLowerCase())?.id ??
            data.mapName)
          : null;
        if (levelKey) {
          try {
            const levelRes = await fetch(`/api/level-details/${encodeURIComponent(levelKey)}`, {
              signal: AbortSignal.timeout(20000),
            });
            if (levelRes.ok) {
              const payload = (await levelRes.json()) as { levelInfo?: { data?: RawLevelData } };
              const levelData = payload.levelInfo?.data ?? null;
              if (levelData && !cancelled) {
                setGeometry(levelGeometry(levelData));
                setLevelData(levelData);
                const result = await simulateRun(
                  data.inputs ?? "",
                  data.input_count,
                  levelData,
                  {},
                  data.arrow_name,
                );
                if (!cancelled) setSim(result);
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

  // Compare against other runs on the same level — TAS entries or other
  // real-game runs. Real-game ghosts fetch their inputs on demand; each ghost
  // is simulated against the geometry already loaded for the primary run.
  const candidates = React.useMemo(() => boardEntries ?? [], [boardEntries]);
  const ghostSims = useCompareGhosts(open, levelData, candidates, selectedGhostIds);
  const overlays = React.useMemo<ReplayOverlay[]>(
    () =>
      selectedGhostIds.flatMap((id) => {
        const entry = candidates.find((c) => c.id === id);
        const ghostSim = ghostSims[id];
        if (!entry || !ghostSim || ghostSim.path.length === 0) return [];
        const index = candidates.findIndex((c) => c.id === id);
        return [
          {
            id,
            sim: ghostSim,
            color: ghostColor(index),
            arrow: arrowKind(entry.arrowName),
            arrowRadius: arrowConstants(entry.arrowName).radius ?? 16,
            label: ghostLabel(entry),
          },
        ];
      }),
    [selectedGhostIds, candidates, ghostSims],
  );
  // Stable identities so the memoised GhostPicker is not rebuilt every frame.
  const toggleGhost = React.useCallback(
    (id: string) =>
      setSelectedGhostIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [],
  );
  const clearGhosts = React.useCallback(() => setSelectedGhostIds([]), []);

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
                geometry={geometry}
                frame={frame}
                playing={playing}
                speed={speed}
                bodyColor={bodyColor}
                trail={trail}
                thrust={thrust}
                arrow={arrow}
                arrowRadius={arrowRadius}
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
                overlays={overlays}
              />
            ) : (
              <div className="rounded-lg border border-white/5 bg-black/30 py-10 text-center text-slate-500 text-xs italic">
                Level geometry unavailable — showing the input breakdown only.
              </div>
            )}

            {pathLength > 0 && (
              <GhostPicker
                candidates={candidates}
                selectedIds={selectedGhostIds}
                onToggle={toggleGhost}
                onClear={clearGhosts}
              />
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
                          // path[0] is the spawn pose, so input i lands on path[i + 1].
                          setFrame(Math.round((inputs[index]?.atMs ?? 0) / SIM_TICK_MS) + 1);
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
  sim: SimResult;
  geometry: SimGeometry;
  frame: number;
  playing: boolean;
  speed: number;
  bodyColor: string;
  trail: string;
  thrust: string;
  arrow: ArrowKind;
  arrowRadius: number;
  replayTimeMs: number;
  onTogglePlay: () => void;
  onScrub: (value: number) => void;
  onSpeed: (value: number) => void;
  /** Hide the built-in transport bar (the TAS editor provides its own). */
  hideControls?: boolean;
  /** Extra runs drawn under the main arrow so attempts can be compared. */
  overlays?: ReplayOverlay[];
  /**
   * When set, the stage becomes a drawing surface: pointer drags over the map
   * append world-space waypoints and the trace is rendered on top. The camera
   * and frame controls still work; the stage just also captures the pointer.
   */
  onDrawPath?: (points: { x: number; y: number }[]) => void;
  /** A waypoint trace to render while drawing, in world units. */
  drawnPath?: { x: number; y: number }[];
  /** Colour of the drawn trace; defaults to the app accent. */
  drawColor?: string;
}

/** "lines" is the schematic stroke look; "game" mirrors the real game's render. */
export type ReplayRenderMode = "lines" | "game";

/** Stable empty list so `overlays = []` never re-fires the draw effect. */
const NO_OVERLAYS: ReplayOverlay[] = [];

/** Another run replayed on the same stage as the primary one. */
export interface ReplayOverlay {
  id: string;
  sim: SimResult;
  color: string;
  arrow: ArrowKind;
  arrowRadius: number;
  /** Label drawn beside the ghost arrow, e.g. "Ch4mpY_TAS · 13.825s". */
  label?: string;
  /** Last tick the ghost's trail layer was painted at (internal draw cache). */
  cachedKey?: string;
}

export function ReplayStage({
  sim,
  geometry,
  frame,
  playing,
  speed,
  bodyColor,
  trail,
  thrust,
  arrow,
  arrowRadius,
  replayTimeMs,
  onTogglePlay,
  onScrub,
  onSpeed,
  hideControls,
  overlays = NO_OVERLAYS,
  onDrawPath,
  drawnPath,
  drawColor = "var(--app-accent)",
}: StageProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  // How the stage draws: the schematic line look, or a render matching the game.
  const [mode, setMode] = React.useState<ReplayRenderMode>("lines");
  // Camera state for "game" mode; a ref so the draw effect reads it without
  // re-running on every settings change (the frame effect repaints anyway).
  const [cameraSettings, setCameraSettings] = React.useState<CameraSettings>(DEFAULT_CAMERA);
  const [showCamera, setShowCamera] = React.useState(false);
  const cameraRef = React.useRef(new FollowCamera(DEFAULT_CAMERA));
  const settingsRef = React.useRef(cameraSettings);
  settingsRef.current = cameraSettings;
  cameraRef.current.settings = cameraSettings;
  // The animation loop and the resize listener both call this so a new frame or
  // a relayout repaints without the draw effect re-running (and without React
  // re-rendering the whole stage 60 times a second).
  const drawRef = React.useRef<() => void>(() => {});
  // The draw effect deliberately omits `frame`, so `draw` reads the current
  // frame through this ref instead of a stale closure.
  const frameRef = React.useRef(frame);
  frameRef.current = frame;

  // Drawing support: pointer→world uses the live transform, which lives inside
  // the canvas effect, so it is exposed through refs the handlers read.
  const worldFromEventRef = React.useRef<
    ((e: React.PointerEvent) => { x: number; y: number }) | null
  >(null);
  const drawPathRef = React.useRef(drawnPath);
  drawPathRef.current = drawnPath;
  const drawColorRef = React.useRef(drawColor);
  drawColorRef.current = drawColor;
  const strokeRef = React.useRef<{ x: number; y: number }[] | null>(null);
  const drawingRef = React.useRef(false);

  /** Map a pointer event to world coordinates using the canvas' current transform. */
  const eventToWorld = React.useCallback((e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    const map = worldFromEventRef.current;
    if (!canvas || !map) return null;
    return map(e);
  }, []);

  const beginStroke = (e: React.PointerEvent) => {
    if (!onDrawPath) return;
    const p = eventToWorld(e);
    if (!p) return;
    drawingRef.current = true;
    strokeRef.current = [p];
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const extendStroke = (e: React.PointerEvent) => {
    if (!drawingRef.current || !onDrawPath) return;
    const p = eventToWorld(e);
    if (!p) return;
    const s = strokeRef.current!;
    const last = s[s.length - 1];
    // Keep the trace fine-grained while dragging; the controller simplifies it.
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
    s.push(p);
    onDrawPath(s.slice());
  };
  const endStroke = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const s = strokeRef.current;
    strokeRef.current = null;
    if (s && s.length >= 2) onDrawPath?.(s.slice());
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const HEIGHT = 340;
    let width = 0;
    let dpr = 1;
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let tx = (x: number) => x;
    let ty = (y: number) => y;
    let base: HTMLCanvasElement | null = null;
    const ghostTrails = new Map<string, HTMLCanvasElement>();
    let lastUpto = -1;

    // World bounds only depend on the level and the runs, not the current frame,
    // so they are computed once here instead of on every repaint.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const reach = (w: SimWall) => {
      if (w.pivot && w.rotationSpeed) {
        const r = Math.max(
          Math.hypot(w.ax - w.pivot.x, w.ay - w.pivot.y),
          Math.hypot(w.bx - w.pivot.x, w.by - w.pivot.y),
        );
        return { x0: w.pivot.x - r, x1: w.pivot.x + r, y0: w.pivot.y - r, y1: w.pivot.y + r };
      }
      const half = w.thickness / 2;
      return {
        x0: Math.min(w.ax, w.bx) - half,
        x1: Math.max(w.ax, w.bx) + half,
        y0: Math.min(w.ay, w.by) - half,
        y1: Math.max(w.ay, w.by) + half,
      };
    };
    for (const w of geometry.walls) {
      const b = reach(w);
      minX = Math.min(minX, b.x0);
      minY = Math.min(minY, b.y0);
      maxX = Math.max(maxX, b.x1);
      maxY = Math.max(maxY, b.y1);
    }
    for (const z of geometry.zones) {
      minX = Math.min(minX, z.x0);
      minY = Math.min(minY, z.y0);
      maxX = Math.max(maxX, z.x1);
      maxY = Math.max(maxY, z.y1);
    }
    for (const p of sim.path) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    // Ghost paths share the level but can wander further, so bound them too.
    for (const o of overlays) {
      for (const p of o.sim.path) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!Number.isFinite(minX)) return;
    const pad = 40;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const levelScale = (w: number, h: number) => Math.min(w / spanX, h / spanY);
    scale = levelScale(width || parent.clientWidth, HEIGHT);

    // Rotating walls move every frame, so they are drawn live on top of the
    // cached static layer; the rest are painted once.
    const rotatingWalls = geometry.walls.filter((w) => w.pivot && w.rotationSpeed);
    const staticWalls = geometry.walls.filter((w) => !(w.pivot && w.rotationSpeed));

    // Palette: the schematic look keeps the sampled colours from
    // `replay-visuals`; "game" mode uses the game's own colours (which differ —
    // e.g. death walls are orange and the boost zone is green).
    const wallColorFor = (type: string) =>
      mode === "game" ? gameWallColor(type) : wallVisual(type).color;
    const zoneColorFor = (type: string) =>
      mode === "game" ? gameZoneColor(type) : wallVisual(type).color;

    /** Point the world→px transform at the fitted level (lines) or the camera (game). */
    const updateTransform = (cam: { x: number; y: number; zoom: number } | null) => {
      if (mode === "game" && cam) {
        scale = cam.zoom;
        offX = width / 2 - cam.x * scale;
        offY = HEIGHT / 2 - cam.y * scale;
      } else {
        scale = levelScale(width, HEIGHT);
        offX = (width - spanX * scale) / 2 - minX * scale;
        offY = (HEIGHT - spanY * scale) / 2 - minY * scale;
      }
      tx = (wx: number) => wx * scale + offX;
      ty = (wy: number) => wy * scale + offY;
    };

    // Expose the inverse transform so pointer events can be mapped to world
    // units (used only while drawing a route).
    worldFromEventRef.current = (e: React.PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      return { x: (px - offX) / scale, y: (py - offY) / scale };
    };

    /** Zones and portals, drawn under the walls in both modes. */
    const paintZones = (g: CanvasRenderingContext2D) => {
      for (const z of geometry.zones) {
        const color = zoneColorFor(z.type);
        const x = tx(Math.min(z.x0, z.x1));
        const y = ty(Math.min(z.y0, z.y1));
        const w = Math.abs(tx(z.x1) - tx(z.x0));
        const h = Math.abs(ty(z.y1) - ty(z.y0));
        if (mode === "game") {
          g.fillStyle = withAlpha(color, 0.22);
          g.fillRect(x, y, w, h);
        } else {
          g.fillStyle = withAlpha(color, 0.14);
          g.fillRect(x, y, w, h);
          g.strokeStyle = withAlpha(color, 0.55);
          g.lineWidth = 1;
          g.setLineDash([6, 4]);
          g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          g.setLineDash([]);
        }
      }
      for (const p of geometry.portals) {
        drawPortal(g, p, tx, ty, mode === "game");
      }
    };

    /** Stroke a run's trail in full at the current transform (game mode). */
    const strokeTrail = (
      g: CanvasRenderingContext2D,
      path: SimResult["path"],
      upto: number,
      color: string,
      glow: boolean,
    ) => {
      if (upto < 1) return;
      g.lineCap = "round";
      g.lineJoin = "round";
      if (glow) {
        for (const [w, a] of [
          [7, 0.12],
          [3.5, 0.3],
        ] as const) {
          g.strokeStyle = withAlpha(color, a);
          g.lineWidth = w;
          g.beginPath();
          g.moveTo(tx(path[0].x), ty(path[0].y));
          for (let i = 1; i <= upto; i++) g.lineTo(tx(path[i].x), ty(path[i].y));
          g.stroke();
        }
      }
      g.strokeStyle = glow ? lighten(color, 0.35) : color;
      g.lineWidth = glow ? 1.4 : 2;
      g.beginPath();
      g.moveTo(tx(path[0].x), ty(path[0].y));
      for (let i = 1; i <= upto; i++) g.lineTo(tx(path[i].x), ty(path[i].y));
      g.stroke();
    };

    /** The game's layered thrust flame, trailing behind the arrow. */
    const drawGameThrust = (
      g: CanvasRenderingContext2D,
      kind: ArrowKind,
      x: number,
      y: number,
      rot: number,
      radius: number,
    ) => {
      const [outer, inner] = GAME_THRUST_COLORS[kind];
      const len = radius * 3.2;
      const halfW = radius * 1.05;
      g.save();
      g.translate(tx(x), ty(y));
      g.rotate(rot + Math.PI);
      for (const [color, f] of [
        [outer, 1],
        [inner, 0.6],
      ] as const) {
        g.fillStyle = color;
        g.globalAlpha = 0.85;
        g.beginPath();
        g.moveTo(0, -halfW * f);
        g.lineTo(len * f, 0);
        g.lineTo(0, halfW * f);
        g.closePath();
        g.fill();
      }
      g.restore();
    };

    /** Paint walls (rotated to `tick` when they spin) onto a 2D context. */
    const paintWalls = (g: CanvasRenderingContext2D, walls: SimWall[], tick: number) => {
      g.lineCap = "round";
      for (const w of walls) {
        let ax = w.ax;
        let ay = w.ay;
        let bx = w.bx;
        let by = w.by;
        if (w.pivot && w.rotationSpeed) {
          const ang = w.rotationSpeed * tick;
          const cosA = Math.cos(ang);
          const sinA = Math.sin(ang);
          const rotate = (px: number, py: number) => {
            const dx = px - w.pivot!.x;
            const dy = py - w.pivot!.y;
            return { x: w.pivot!.x + dx * cosA - dy * sinA, y: w.pivot!.y + dx * sinA + dy * cosA };
          };
          const a = rotate(ax, ay);
          const b = rotate(bx, by);
          ax = a.x;
          ay = a.y;
          bx = b.x;
          by = b.y;
        }
        const isFinish = w.type === "finish";
        const color = isFinish ? "#ffffff" : wallColorFor(w.type);
        const X0 = tx(ax);
        const Y0 = ty(ay);
        const X1 = tx(bx);
        const Y1 = ty(by);

        if (mode === "game") {
          const thickness = isFinish ? GAME_FINISH_THICKNESS : w.thickness || GAME_WALL_THICKNESS;
          const core = Math.max(2, thickness * scale);
          if (isFinish) {
            drawFinish(g, X0, Y0, X1, Y1, thickness, scale);
            continue;
          }
          if (ax === bx && ay === by) {
            g.fillStyle = color;
            g.beginPath();
            g.arc(X0, Y0, core / 2, 0, Math.PI * 2);
            g.fill();
            continue;
          }
          g.strokeStyle = color;
          g.lineWidth = core;
          g.beginPath();
          g.moveTo(X0, Y0);
          g.lineTo(X1, Y1);
          g.stroke();
          continue;
        }

        const visual = wallVisual(w.type);
        if (visual.kind === "finish") {
          drawFinish(g, X0, Y0, X1, Y1, w.thickness, scale);
          continue;
        }
        // Draw at the wall's real thickness, in world units. The engine collides
        // at `arrowRadius + thickness / 2`, so a wall drawn thinner than it
        // collides reads as the arrow bonking against nothing. A small floor
        // keeps the thinnest walls visible at the replay's zoom.
        const core = Math.max(1.5, w.thickness * scale);
        const X = X0;
        const Y = Y0;
        if (ax === bx && ay === by) {
          // A single-point wall: the engine collides with it as a zero-length
          // segment, so draw the dot it really is.
          g.fillStyle = withAlpha(visual.color, 0.16);
          g.beginPath();
          g.arc(X, Y, core * 1.8, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = visual.color;
          g.beginPath();
          g.arc(X, Y, core / 2, 0, Math.PI * 2);
          g.fill();
          continue;
        }
        // A faint wide pass under a crisp core reads as the game's neon walls.
        g.strokeStyle = withAlpha(visual.color, 0.16);
        g.lineWidth = Math.max(3, core * 2.4);
        g.beginPath();
        g.moveTo(X, Y);
        g.lineTo(X1, Y1);
        g.stroke();
        g.strokeStyle = visual.color;
        g.lineWidth = core;
        g.beginPath();
        g.moveTo(X, Y);
        g.lineTo(X1, Y1);
        g.stroke();
      }
    };

    /** Paint everything that never changes as the frame advances onto an offscreen layer. */
    const paintBase = () => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(HEIGHT * dpr));
      const g = c.getContext("2d");
      if (!g) return c;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#07070b";
      g.fillRect(0, 0, width, HEIGHT);

      // Zones and portals first, then the walls that are baked once.
      paintZones(g);
      paintWalls(g, staticWalls, 0);
      return c;
    };

    /** A ghost's trail up to `upto`, on its own layer so it is stroked once. */
    const paintGhost = (o: ReplayOverlay, upto: number) => {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(width * dpr));
      c.height = Math.max(1, Math.round(HEIGHT * dpr));
      const g = c.getContext("2d");
      if (!g) return c;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.strokeStyle = withAlpha(o.color, 0.5);
      g.lineWidth = 2;
      g.beginPath();
      const gp = o.sim.path;
      for (let i = 0; i <= upto; i++) {
        const p = gp[i];
        if (i === 0) g.moveTo(tx(p.x), ty(p.y));
        else g.lineTo(tx(p.x), ty(p.y));
      }
      g.stroke();
      return c;
    };

    const draw = () => {
      if (!width) return;
      const f = frameRef.current;
      const safeFrame = Number.isFinite(f) ? Math.floor(f) : 0;
      const upto = Math.max(0, Math.min(safeFrame, sim.path.length - 1));
      const camera = cameraRef.current;
      if (mode === "game" && sim.path.length > 0) {
        // Drive the follow camera to the current frame before the transform is
        // built, so the whole scene moves with the arrow.
        const p = sim.path[upto];
        const prev = sim.path[Math.max(0, upto - 1)];
        const vx = (p.x - prev.x) / (SIM_TICK_MS / 1000);
        const vy = (p.y - prev.y) / (SIM_TICK_MS / 1000);
        camera.follow(p.x, p.y, vx, vy, upto === 0 ? 1 : SIM_TICK_MS / 1000);
        updateTransform(camera);
      }
      // All offscreen layers are full-size (device px), so compositing needs the
      // identity transform; vector drawing is done in CSS px via `dpr`.
      const composite = (layer: HTMLCanvasElement) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(layer, 0, 0);
      };
      const vector = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // The "lines" level layer is baked at the fit transform; only "game" mode
      // uses a moving camera, so it never needs this layer.
      if (mode === "lines") {
        if (!base) base = paintBase();
        composite(base);
      }
      if (mode === "game" && sim.path.length > 0) {
        // The camera moves every frame, so the scene is drawn live rather than
        // composited from the static level layer.
        vector();
        ctx.fillStyle = "#07070b";
        ctx.fillRect(0, 0, width, HEIGHT);
        paintZones(ctx);
        paintWalls(ctx, geometry.walls, upto);
        for (const o of overlays) {
          const gp = o.sim.path;
          if (gp.length < 2) continue;
          const gUpto = Math.max(0, Math.min(upto, gp.length - 1));
          ctx.save();
          ctx.globalAlpha = 0.5;
          strokeTrail(ctx, gp, gUpto, o.color, false);
          ctx.restore();
          const gp2 = gp[gUpto];
          ctx.save();
          ctx.globalAlpha = 0.6;
          drawArrowSprite(
            ctx,
            o.arrow,
            tx(gp2.x),
            ty(gp2.y),
            gp2.rot,
            scale,
            o.arrowRadius,
            o.color,
            o.color,
          );
          ctx.restore();
          if (o.label) {
            ctx.font = "bold 10px ui-monospace, monospace";
            ctx.fillStyle = o.color;
            ctx.fillText(o.label, tx(gp2.x) + 9, ty(gp2.y) - 9);
          }
        }
        strokeTrail(ctx, sim.path, upto, trail, true);
        const point = sim.path[upto];
        if ((point.thrustPower ?? 0) > 0.05) {
          drawGameThrust(ctx, arrow, point.x, point.y, point.rot, arrowRadius);
        }
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = GAME_COLLISION_COLOR;
        ctx.beginPath();
        ctx.arc(tx(point.x), ty(point.y), Math.max(2, arrowRadius * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = GAME_COLLISION_COLOR;
        ctx.lineWidth = Math.max(1.2, scale * 0.9);
        ctx.stroke();
        ctx.restore();
        drawArrowSprite(
          ctx,
          arrow,
          tx(point.x),
          ty(point.y),
          point.rot,
          scale,
          arrowRadius,
          bodyColor,
          thrust,
        );
        if (sim.finishTick !== null && upto >= sim.finishTick) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 11px ui-monospace, monospace";
          ctx.fillText("FINISH", 10, 18);
        }
        return;
      }

      // Rotating walls sit above the baked layer and move with the frame.
      if (rotatingWalls.length > 0) {
        vector();
        paintWalls(ctx, rotatingWalls, upto);
      }

      // Ghost trails, each cached at its own current tick and only re-stroked
      // when that tick advances.
      for (const o of overlays) {
        const gp = o.sim.path;
        if (gp.length === 0) continue;
        const gUpto = Math.max(0, Math.min(upto, gp.length - 1));
        const key = `${o.id}:${gUpto}`;
        if (key !== o.cachedKey) {
          o.cachedKey = key;
          ghostTrails.set(o.id, paintGhost(o, gUpto));
        }
        const layer = ghostTrails.get(o.id);
        if (layer) composite(layer);
        const gp2 = gp[gUpto];
        vector();
        ctx.save();
        ctx.globalAlpha = 0.6;
        drawArrowSprite(
          ctx,
          o.arrow,
          tx(gp2.x),
          ty(gp2.y),
          gp2.rot,
          scale,
          o.arrowRadius,
          o.color,
          o.color,
        );
        ctx.restore();
        if (o.label) {
          ctx.font = "bold 10px ui-monospace, monospace";
          ctx.fillStyle = o.color;
          ctx.fillText(o.label, tx(gp2.x) + 9, ty(gp2.y) - 9);
        }
      }

      // Travelled path: a soft glow under a bright core, in the run's trail
      // colour. The already-drawn portion is cached, so only the new segment is
      // stroked each frame — re-stroking the whole path every frame is what made
      // the replay crawl on long runs.
      if (upto > 0) {
        // A scrub back invalidates the cache; it is rebuilt forward from 0.
        if (upto < lastUpto) {
          trailLayer = null;
          lastUpto = -1;
        }
        if (!trailLayer) {
          trailLayer = document.createElement("canvas");
          trailLayer.width = Math.max(1, Math.round(width * dpr));
          trailLayer.height = Math.max(1, Math.round(HEIGHT * dpr));
          lastUpto = 0;
        }
        if (upto > lastUpto) {
          const tg = trailLayer.getContext("2d");
          if (tg) {
            tg.setTransform(dpr, 0, 0, dpr, 0, 0);
            tg.lineCap = "round";
            tg.lineJoin = "round";
            const start = Math.max(0, lastUpto);
            for (const [w, a] of [
              [7, 0.12],
              [3.5, 0.3],
            ] as const) {
              tg.strokeStyle = withAlpha(trail, a);
              tg.lineWidth = w;
              tg.beginPath();
              const s0 = sim.path[start];
              tg.moveTo(tx(s0.x), ty(s0.y));
              for (let i = start + 1; i <= upto; i++) {
                const p = sim.path[i];
                tg.lineTo(tx(p.x), ty(p.y));
              }
              tg.stroke();
            }
            tg.strokeStyle = lighten(trail, 0.35);
            tg.lineWidth = 1.4;
            tg.beginPath();
            const s0 = sim.path[start];
            tg.moveTo(tx(s0.x), ty(s0.y));
            for (let i = start + 1; i <= upto; i++) {
              const p = sim.path[i];
              tg.lineTo(tx(p.x), ty(p.y));
            }
            tg.stroke();
          }
          lastUpto = upto;
        }
        composite(trailLayer);
      }

      // Arrow at the current position, drawn as the game's two-tone sprite and
      // facing the engine's recorded rotation, so spins animate even when the
      // arrow is pinned against a wall. Skipped when the sim has no path, as on
      // the draw canvas, where only the traced route is shown.
      const point = sim.path[upto];
      if (point) {
        vector();
        drawArrowSprite(
          ctx,
          arrow,
          tx(point.x),
          ty(point.y),
          point.rot,
          scale,
          arrowRadius,
          bodyColor,
          thrust,
        );
      }

      if (sim.finishTick !== null && upto >= sim.finishTick) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px ui-monospace, monospace";
        ctx.fillText("FINISH", 10, 18);
      }

      // A drawn route is overlaid last so it sits above the walls and trail.
      const stroke = drawPathRef.current;
      if (stroke && stroke.length > 1) {
        ctx.save();
        ctx.strokeStyle = drawColorRef.current;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(tx(stroke[0].x), ty(stroke[0].y));
        for (let i = 1; i < stroke.length; i++) ctx.lineTo(tx(stroke[i].x), ty(stroke[i].y));
        ctx.stroke();
        // A dot marks each waypoint the controller will aim at.
        ctx.globalAlpha = 1;
        ctx.fillStyle = drawColorRef.current;
        for (const p of stroke) {
          ctx.beginPath();
          ctx.arc(tx(p.x), ty(p.y), 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    };

    let trailLayer: HTMLCanvasElement | null = null;

    /** Fit the canvas to its parent, rebuild the static layer, then repaint. */
    const resize = () => {
      width = parent.clientWidth;
      if (!width) return;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${HEIGHT}px`;
      updateTransform(null);
      base = null;
      trailLayer = null;
      lastUpto = -1;
      ghostTrails.clear();
      for (const o of overlays) o.cachedKey = undefined;
      draw();
    };

    drawRef.current = draw;
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
    // `frame` is not a dependency: `draw` reads it through `frameRef` so the
    // static layer and world bounds are not rebuilt on every frame.
  }, [sim, geometry, bodyColor, trail, thrust, arrow, arrowRadius, overlays, mode]);

  // Repaint on every frame change. Kept out of the effect above so the world
  // bounds and the static wall layer are not rebuilt 60 times a second.
  React.useEffect(() => {
    drawRef.current();
  }, [frame]);

  // Repaint when the drawn route changes so the trace tracks the pointer.
  React.useEffect(() => {
    drawRef.current();
  }, [drawnPath]);

  // Camera changes (a new preset or a slider) only need a repaint.
  React.useEffect(() => {
    drawRef.current();
  }, [cameraSettings]);

  // A new run or level resets the follow camera to the spawn point.
  React.useEffect(() => {
    const p = sim.path[0];
    if (p) cameraRef.current.reset(p.x, p.y);
    drawRef.current();
  }, [sim, mode]);

  // Ghosts may run past the primary run's finish; keep the scrubber covering
  // the longest run so a slower ghost can still be watched to its end.
  const maxFrame = Math.max(1, sim.path.length - 1, ...overlays.map((o) => o.sim.path.length - 1));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-500">Render</span>
          <Select value={mode} onValueChange={(v) => setMode(v as ReplayRenderMode)}>
            <SelectTrigger className="h-7 w-28 bg-black/30 border-white/10 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0d0d10] border-white/10 text-slate-200">
              <SelectItem value="lines" className="text-xs">
                Simple lines
              </SelectItem>
              <SelectItem value="game" className="text-xs">
                Game
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {mode === "game" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-slate-300 hover:text-slate-100"
            onClick={() => setShowCamera((v) => !v)}
            aria-expanded={showCamera}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Camera
          </Button>
        )}
      </div>
      {mode === "game" && showCamera && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400 w-28">Preset</span>
            <div className="flex gap-1">
              {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((p) => (
                <Button
                  key={p}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-6 px-2 text-[11px] capitalize",
                    cameraSettings.preset === p ? "bg-white/15 text-slate-100" : "text-slate-400",
                  )}
                  onClick={() => setCameraSettings(cameraPreset(p))}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
          {(
            [
              ["Zoom", "zoom", 0.4, 5, 0.05],
              ["Dynamic Zoom", "dynamicZoom", 0, 1.2, 0.05],
              ["Zoom Smoothness", "zoomSmoothness", 4, 10, 0.5],
              ["Move Ahead", "moveAhead", 0, 6, 0.1],
              ["Movement Smoothness", "movementSmoothness", 2, 7, 0.5],
            ] as const
          ).map(([label, key, min, max, step]) => (
            <label key={key} className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400 w-28">{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={cameraSettings[key]}
                onChange={(e) =>
                  setCameraSettings((s) => ({ ...s, [key]: Number(e.target.value) }))
                }
                className="flex-1 accent-[var(--app-accent)]"
                aria-label={label}
              />
              <span className="font-mono text-[10px] text-slate-400 w-8 text-right">
                {cameraSettings[key].toFixed(2)}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="rounded-lg overflow-hidden border border-white/10 bg-[#07070b]">
        <canvas
          ref={canvasRef}
          onPointerDown={beginStroke}
          onPointerMove={extendStroke}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          className={onDrawPath ? "cursor-crosshair touch-none" : undefined}
        />
      </div>
      {mode === "lines" && <ReplayLegend geometry={geometry} />}
      {!hideControls && (
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
      )}
      {!hideControls && (
        <p className="text-[10px] text-slate-600">
          Animation reconstructed from the recorded inputs and level geometry, coloured with the
          run's own skin — approximate, not frame-perfect.
        </p>
      )}
    </div>
  );
}

/** A portal as a dashed segment with a chevron pointing along the travel. */
function drawPortal(
  ctx: CanvasRenderingContext2D,
  p: SimPortal,
  tx: (x: number) => number,
  ty: (y: number) => number,
  game = false,
) {
  const x0 = tx(p.ax);
  const y0 = ty(p.ay);
  const x1 = tx(p.bx);
  const y1 = ty(p.by);
  if (game) {
    // The game's portal: a bright particle band along the segment.
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = withAlpha(GAME_PORTAL_COLORS.a, 0.5);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = GAME_PORTAL_COLORS.a;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const visual = wallVisual("portal");
  ctx.save();
  ctx.strokeStyle = withAlpha(visual.color, 0.7);
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const s = 6;
  ctx.fillStyle = visual.color;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(ang) * s, my + Math.sin(ang) * s);
  ctx.lineTo(mx + Math.cos(ang + 2.5) * s, my + Math.sin(ang + 2.5) * s);
  ctx.lineTo(mx + Math.cos(ang - 2.5) * s, my + Math.sin(ang - 2.5) * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The finish line: a white strip with a black chequer, like the game's grid. */
function drawFinish(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  worldThickness: number,
  scale: number,
) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const cells = Math.max(4, Math.round(len / 12));
  const cell = len / cells;
  const thick = Math.max(6, worldThickness * scale);
  ctx.save();
  ctx.translate(x0, y0);
  ctx.rotate(ang);
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = checkerAt(i, j, 1) ? "#ffffff" : "#111114";
      ctx.fillRect(i * cell, -thick / 2 + (j * thick) / 2, cell, thick / 2);
    }
  }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, -thick / 2, len, thick);
  ctx.restore();
}

/** The game's own icons for the obstacle types, used in the legend below. */
const LEGEND_ICONS: Record<string, string> = {
  normal: railIcon,
  death: skullIcon,
  bouncy: bounceIcon,
  boost: flameIcon,
  finish: finishIcon,
  portal: portalIcon,
  ice: zoneIcon,
  nosteer: railIcon,
};

const LEGEND_LABELS: Record<string, string> = {
  normal: "Wall",
  death: "Death",
  bouncy: "Bouncy",
  boost: "Boost",
  finish: "Finish",
  portal: "Portal",
  ice: "Ice",
  nosteer: "No steer",
};

/**
 * A one-line key for the obstacle types actually present in the level, drawn
 * with the game's own icons so the canvas colours are self-explanatory.
 */
function ReplayLegend({ geometry }: { geometry: SimGeometry }) {
  const types = React.useMemo(() => {
    const seen = new Set<string>();
    for (const w of geometry.walls) seen.add(w.type);
    for (const z of geometry.zones) seen.add(z.type);
    if (geometry.portals.length > 0) seen.add("portal");
    return [...seen].filter((t) => LEGEND_ICONS[t]);
  }, [geometry]);

  if (types.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {types.map((type) => {
        const visual = wallVisual(type);
        return (
          <span key={type} className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <img
              src={LEGEND_ICONS[type]}
              alt=""
              className="w-3.5 h-3.5 opacity-90"
              style={{ filter: `drop-shadow(0 0 3px ${withAlpha(visual.color, 0.8)})` }}
            />
            <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: visual.color }} />
            {LEGEND_LABELS[type] ?? type}
          </span>
        );
      })}
    </div>
  );
}

interface TasReplayViewerProps {
  levelId: string;
  levelName?: string;
  username?: string;
  arrowName?: string;
  inputs: string;
  inputCount?: number;
  timeMs?: number;
  className?: string;
  /** Other runs on this level's board, offered as ghosts to compare against. */
  boardEntries?: CompareCandidate[];
}

/**
 * Plays a community TAS entry straight from its stored input string, so a run
 * on the TAS board can be watched without it existing as an upstream run id.
 * Other entries on the same board can be ticked to replay as ghost overlays.
 */
export function TasReplayViewer({
  levelId,
  levelName,
  username,
  arrowName,
  inputs,
  inputCount,
  timeMs,
  className,
  boardEntries,
}: TasReplayViewerProps) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"idle" | "loading" | "ready" | "error">("idle");
  const [geometry, setGeometry] = React.useState<SimGeometry>({
    walls: [],
    zones: [],
    portals: [],
  });
  const [sim, setSim] = React.useState<SimResult | null>(null);
  const [playing, setPlaying] = React.useState(true);
  const [frame, setFrame] = React.useState(0);
  const [speed, setSpeed] = React.useState(1);
  const [attempt, setAttempt] = React.useState(0);
  const loadedRef = React.useRef<string | null>(null);

  // Ghost compare state: the level geometry is cached so each ticked run only
  // costs one simulation, not another geometry fetch.
  const [levelData, setLevelData] = React.useState<RawLevelData | null>(null);
  const [selectedGhostIds, setSelectedGhostIds] = React.useState<string[]>([]);

  const candidates = React.useMemo(() => boardEntries ?? [], [boardEntries]);
  const ghostSims = useCompareGhosts(open, levelData, candidates, selectedGhostIds);
  const arrow = arrowKind(arrowName);
  const arrowRadius = arrowConstants(arrowName).radius ?? 16;
  const pathLength = sim?.path.length ?? 0;
  const summary = React.useMemo(() => summariseReplay(inputs, inputCount), [inputs, inputCount]);

  React.useEffect(() => {
    if (!open) return;
    const key = `${levelId}:${inputs.length}:${attempt}`;
    if (loadedRef.current === key && attempt === 0) return;
    loadedRef.current = key;
    let cancelled = false;
    setState("loading");
    setSim(null);
    setLevelData(null);
    setSelectedGhostIds([]);
    setFrame(0);
    setPlaying(true);

    (async () => {
      try {
        const levelRes = await fetch(`/api/level-details/${encodeURIComponent(levelId)}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!levelRes.ok) throw new Error(String(levelRes.status));
        const payload = (await levelRes.json()) as { levelInfo?: { data?: RawLevelData } };
        const data = payload.levelInfo?.data ?? null;
        if (!data) throw new Error("no geometry");
        if (cancelled) return;
        setGeometry(levelGeometry(data));
        setLevelData(data);
        const result = await simulateRun(inputs, inputCount, data, {}, arrowName);
        if (cancelled) return;
        setSim(result);
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
  }, [open, levelId, inputs, inputCount, arrowName, attempt]);

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

  const overlays = React.useMemo<ReplayOverlay[]>(
    () =>
      selectedGhostIds.flatMap((id) => {
        const entry = candidates.find((c) => c.id === id);
        const ghostSim = ghostSims[id];
        if (!entry || !ghostSim || ghostSim.path.length === 0) return [];
        const index = candidates.findIndex((c) => c.id === id);
        return [
          {
            id,
            sim: ghostSim,
            color: ghostColor(index),
            arrow: arrowKind(entry.arrowName),
            arrowRadius: arrowConstants(entry.arrowName).radius ?? 16,
            label: ghostLabel(entry),
          },
        ];
      }),
    [selectedGhostIds, candidates, ghostSims],
  );

  // Stable identities so the memoised GhostPicker is not rebuilt every frame.
  const toggleGhost = React.useCallback(
    (id: string) =>
      setSelectedGhostIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])),
    [],
  );
  const clearGhosts = React.useCallback(() => setSelectedGhostIds([]), []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="Watch this TAS run"
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
            TAS replay
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

        {state === "ready" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              <span>{levelName ?? levelId}</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{arrowName ?? "Arrow"}</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">{summary.tickCount} inputs</span>
              <span className="text-slate-700">•</span>
              <span className="font-mono">
                {((timeMs ?? summary.durationMs) / 1000).toFixed(3)}s
              </span>
            </div>

            {sim && pathLength > 0 ? (
              <ReplayStage
                sim={sim}
                geometry={geometry}
                frame={frame}
                playing={playing}
                speed={speed}
                bodyColor={themeColor(null)}
                trail={trailColor(null)}
                thrust={thrustColor(null)}
                arrow={arrow}
                arrowRadius={arrowRadius}
                replayTimeMs={frame * SIM_TICK_MS}
                onTogglePlay={() => {
                  if (frame >= pathLength - 1) setFrame(0);
                  setPlaying((p) => !p);
                }}
                onScrub={(value) => {
                  setPlaying(false);
                  setFrame(value);
                }}
                onSpeed={setSpeed}
                overlays={overlays}
              />
            ) : (
              <div className="rounded-lg border border-white/5 bg-black/30 py-10 text-center text-slate-500 text-xs italic">
                Level geometry unavailable — this run can't be animated.
              </div>
            )}

            {pathLength > 0 && (
              <GhostPicker
                candidates={candidates}
                selectedIds={selectedGhostIds}
                onToggle={toggleGhost}
                onClear={clearGhosts}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
