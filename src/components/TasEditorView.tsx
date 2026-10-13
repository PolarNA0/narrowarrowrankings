import * as React from "react";
import {
  Play,
  Pause,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Upload,
  Download,
  Trash2,
  Trophy,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LEVELS } from "@/constants";
import { fetchLeaderboard } from "@/services/api";
import type { LeaderboardEntry } from "@/types";
import {
  REPLAY_SYMBOLS,
  REPLAY_TICK_MS,
  decodeInputSymbols,
  encodeInputSymbols,
  summariseReplay,
  type ReplaySymbolKey,
} from "@/lib/replay";
import {
  SIM_TICK_MS,
  createReplayEngine,
  levelGeometry,
  type RawLevelData,
  type ReplayEngine,
  type SimGeometry,
  type SimResult,
  type SimPoint,
} from "@/lib/replay-sim";
import { arrowKind, type ArrowKind } from "@/lib/arrow-sprites";
import { ReplayStage } from "@/components/ReplayViewer";

const NEUTRAL = 0;
const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"];
/** Inputs between saved engine snapshots, trading memory for rewind speed. */
const CHECKPOINT = 600;

interface Loaded {
  mapName: string;
  arrowName: string;
  levelData: RawLevelData;
  geometry: SimGeometry;
  arrow: ArrowKind;
  arrowRadius: number;
}

/**
 * A tool-assisted-speedrun editor. Loads a run's inputs (or a level to start
 * from scratch), then lets every 240Hz input tick be edited, inserted or
 * deleted while the real game engine re-simulates the result. The slider scrubs
 * the timeline; its current time can be typed into "Go to time" to jump
 * straight to that tick instead of hunting for it.
 */
export function TasEditorView() {
  const [levelId, setLevelId] = React.useState(LEVELS[0]?.id ?? "");
  const [arrowName, setArrowName] = React.useState(ARROWS[0]);
  const [runId, setRunId] = React.useState("");
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [symbols, setSymbols] = React.useState<number[]>([]);
  const [path, setPath] = React.useState<SimPoint[]>([]);
  const [finishTick, setFinishTick] = React.useState<number | null>(null);
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [goTo, setGoTo] = React.useState("");
  const [boardOpen, setBoardOpen] = React.useState(false);
  const [boardEntries, setBoardEntries] = React.useState<LeaderboardEntry[]>([]);
  const [boardLoading, setBoardLoading] = React.useState(false);

  const engineRef = React.useRef<ReplayEngine | null>(null);
  const symbolsRef = React.useRef<number[]>([]);
  // Engine states saved every CHECKPOINT inputs so an edit near the end of a
  // long run only re-steps the changed tail instead of the whole run.
  const checkpointsRef = React.useRef<Map<number, string>>(new Map());
  const rafRef = React.useRef(0);
  const lastRef = React.useRef(0);

  React.useEffect(() => {
    return () => {
      engineRef.current?.free();
      engineRef.current = null;
    };
  }, []);

  /**
   * Re-simulate after an edit. Points before `fromTick` are untouched, so the
   * engine resumes from the latest saved checkpoint at or before it and only
   * the changed region and its tail are stepped again.
   */
  const resimulate = React.useCallback((fromTick: number, nextSymbols: number[]) => {
    const engine = engineRef.current;
    if (!engine) return;
    const edit = Math.max(0, Math.min(fromTick, nextSymbols.length));

    // Any checkpoint past the edit was built from the old input sequence and is
    // no longer valid; the re-stepped tail below rebuilds them.
    for (const key of [...checkpointsRef.current.keys()]) {
      if (key > edit) checkpointsRef.current.delete(key);
    }

    // Latest checkpoint at or before the edit.
    let best = 0;
    let bestSnap: string | null = null;
    for (const [at, snap] of checkpointsRef.current) {
      if (at <= edit && at > best) {
        best = at;
        bestSnap = snap;
      }
    }
    if (bestSnap) engine.restore(bestSnap);
    else engine.reset();

    // Fast-forward (without recording) to the state just before the edit.
    for (let i = best; i < edit; i++) engine.step(nextSymbols[i]);

    // Step the changed region and tail, recording samples and checkpoints.
    const tail: SimPoint[] = [];
    let finished: number | null = null;
    for (let i = edit; i < nextSymbols.length; i++) {
      const point = engine.step(nextSymbols[i]);
      tail.push(point);
      if (finished === null && point.finished) finished = i + 1;
      if ((i + 1) % CHECKPOINT === 0) checkpointsRef.current.set(i + 1, engine.snapshot());
    }

    setPath((prev) => {
      const head = prev.slice(0, edit + 1);
      return [...head, ...tail];
    });
    setFinishTick(finished);
  }, []);

  const loadLevel = React.useCallback(async (id: string, arrow: string): Promise<Loaded | null> => {
    const res = await fetch(`/api/level-details/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Level request failed (${res.status})`);
    const payload = (await res.json()) as { levelInfo?: { data?: RawLevelData } };
    const levelData = payload.levelInfo?.data ?? null;
    if (!levelData) throw new Error("Level has no geometry");
    const engine = await createReplayEngine(levelData, arrow);
    if (!engine) throw new Error("Physics engine failed to initialise");
    engineRef.current?.free();
    engineRef.current = engine;
    const spawn = engine.reset();
    checkpointsRef.current.clear();
    const next: Loaded = {
      mapName: levelData.map_name ?? id,
      arrowName: arrow,
      levelData,
      geometry: levelGeometry(levelData),
      arrow: arrowKind(arrow),
      arrowRadius: 16,
    };
    setPath([spawn]);
    return next;
  }, []);

  const applySymbols = React.useCallback(
    (next: number[]) => {
      symbolsRef.current = next;
      setSymbols(next);
      checkpointsRef.current.clear();
      resimulate(0, next);
      setFrame(0);
    },
    [resimulate],
  );

  /** Load a level from scratch (all-neutral inputs). */
  const loadLevelOnly = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const info = await loadLevel(levelId, arrowName);
      if (!info) return;
      setLoaded(info);
      setSymbols([]);
      symbolsRef.current = [];
      setFrame(0);
      setFinishTick(null);
      setStatus(`Loaded ${info.mapName}. Add inputs to start building a run.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  /** Load a specific run's inputs and level, ready to edit. */
  const loadRunById = async (rawId: string) => {
    const id = rawId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`Run request failed (${res.status})`);
      const data = (await res.json()) as {
        inputs?: string;
        input_count?: number;
        mapName?: string;
        arrow_name?: string;
      };
      const mapName = data.mapName ?? "";
      const level =
        LEVELS.find((l) => l.name.toLowerCase() === mapName.toLowerCase())?.id ?? mapName;
      const arrow = data.arrow_name ?? arrowName;
      const info = await loadLevel(level, arrow);
      if (!info) return;
      setLoaded(info);
      setLevelId(level);
      setArrowName(arrow);
      setRunId(id);
      const decoded = decodeInputSymbols(data.inputs ?? "", data.input_count);
      applySymbols(decoded);
      setFrame(0);
      setStatus(
        `Loaded run ${id} — ${decoded.length} inputs, ${((decoded.length * REPLAY_TICK_MS) / 1000).toFixed(2)}s.`,
      );
      setBoardOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  /** Load the run whose id is typed into the Run ID field. */
  const loadRun = () => loadRunById(runId);

  /** Fetch the selected level's leaderboard so a run can be picked by name. */
  const openBoard = async (open: boolean) => {
    setBoardOpen(open);
    if (!open) return;
    setBoardLoading(true);
    setError(null);
    try {
      const entries = await fetchLeaderboard(levelId, false, true);
      setBoardEntries(entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBoardLoading(false);
    }
  };

  // Playback loop.
  React.useEffect(() => {
    if (!playing || path.length === 0) return;
    lastRef.current = performance.now();
    const step = (now: number) => {
      const elapsed = now - lastRef.current;
      lastRef.current = now;
      setFrame((f) => {
        const next = f + elapsed / SIM_TICK_MS;
        if (next >= path.length - 1) {
          setPlaying(false);
          return path.length - 1;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, path.length]);

  const setSymbolAt = (index: number, symbol: number) => {
    if (index < 0 || index >= symbolsRef.current.length) return;
    const next = symbolsRef.current.slice();
    next[index] = symbol;
    symbolsRef.current = next;
    setSymbols(next);
    resimulate(index, next);
  };

  const insertSymbol = (index: number, symbol: number) => {
    const next = symbolsRef.current.slice();
    next.splice(index, 0, symbol);
    symbolsRef.current = next;
    setSymbols(next);
    resimulate(index, next);
    // Keep the cursor on the freshly inserted tick so it can be edited at once.
    setFrame(index);
  };

  const deleteSymbol = (index: number) => {
    if (index < 0 || index >= symbolsRef.current.length) return;
    const next = symbolsRef.current.slice();
    next.splice(index, 1);
    symbolsRef.current = next;
    setSymbols(next);
    resimulate(index, next);
    setFrame((f) => Math.min(f, next.length));
  };

  const currentTick = Math.max(0, Math.min(Math.floor(frame), symbols.length - 1));
  const currentSymbol = symbols[currentTick];
  const frameTimeMs = frame * SIM_TICK_MS;

  const jumpToTime = () => {
    const seconds = Number(goTo);
    if (!Number.isFinite(seconds)) return;
    const tick = Math.round((seconds * 1000) / SIM_TICK_MS);
    setPlaying(false);
    setFrame(Math.max(0, Math.min(tick, path.length - 1)));
  };

  const exportInputs = () => {
    const base64 = encodeInputSymbols(symbolsRef.current);
    const summary = summariseReplay(base64, symbolsRef.current.length);
    const text = JSON.stringify(
      { inputs: base64, input_count: symbolsRef.current.length, durationMs: summary.durationMs },
      null,
      2,
    );
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tas-${(loaded?.mapName ?? "level").toLowerCase().replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importInputs = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { inputs?: string; input_count?: number };
      if (!parsed.inputs) throw new Error("File has no `inputs` field");
      const decoded = decodeInputSymbols(parsed.inputs, parsed.input_count);
      applySymbols(decoded);
      setStatus(`Imported ${decoded.length} inputs.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sim: SimResult | null = React.useMemo(
    () => (loaded ? { path, finishTick, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } } : null),
    [loaded, path, finishTick],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-[var(--app-accent)]" /> TAS Editor
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Load a run's inputs (or just a level) and edit every 240Hz input tick. The real game
            engine re-simulates your edits live. Scrub the timeline, read the time, then type it
            into “Go to time” to jump straight back to the tick you want to change.
          </p>
        </div>
      </div>

      {/* Loader */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-black/30 border border-white/5 rounded-lg p-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            Level
          </label>
          <Select value={levelId} onValueChange={setLevelId}>
            <SelectTrigger className="bg-white/5 border-white/10 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-72">
              {LEVELS.map((l) => (
                <SelectItem key={l.id} value={l.id} className="text-xs">
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            Arrow
          </label>
          <Select value={arrowName} onValueChange={setArrowName}>
            <SelectTrigger className="bg-white/5 border-white/10 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
              {ARROWS.map((a) => (
                <SelectItem key={a} value={a} className="text-xs">
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
            Run ID
          </label>
          <Input
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadRun();
            }}
            placeholder="e.g. 396461"
            className="bg-white/5 border-white/10 h-9 text-xs font-mono"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button
            size="sm"
            onClick={loadRun}
            disabled={loading || !runId.trim()}
            className="h-9 text-xs"
          >
            Load run
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={loadLevelOnly}
            disabled={loading}
            className="h-9 text-xs"
          >
            Load level
          </Button>
        </div>
        <div className="flex items-end">
          <Popover open={boardOpen} onOpenChange={openBoard}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                className="h-9 text-xs w-full border-[var(--app-accent)]/30 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/10"
              >
                <Trophy className="w-3.5 h-3.5 mr-1" /> Leaderboard
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 p-0 bg-[#121212] border-white/10 text-slate-200"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white">
                  Load a run
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-slate-400"
                  onClick={() => void openBoard(true)}
                  disabled={boardLoading}
                  aria-label="Refresh leaderboard"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", boardLoading && "animate-spin")} />
                </Button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {boardLoading ? (
                  <div className="flex items-center gap-2 text-slate-500 text-xs px-3 py-4">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading board…
                  </div>
                ) : boardEntries.length === 0 ? (
                  <div className="text-slate-500 text-xs px-3 py-4">No runs on this board.</div>
                ) : (
                  boardEntries.map((entry, i) => (
                    <button
                      key={`${entry.run_id}-${i}`}
                      onClick={() => void loadRunById(String(entry.run_id))}
                      disabled={loading}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 disabled:opacity-50"
                    >
                      <span className="w-6 text-right font-mono text-[11px] text-slate-500">
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-xs text-slate-200">
                        {entry.username}
                      </span>
                      <span className="text-[10px] text-slate-500 truncate max-w-20">
                        {entry.arrow_name}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--app-accent)]">
                        {entry.completion_time.toFixed(3)}s
                      </span>
                    </button>
                  ))
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {error && <div className="text-rose-400 text-xs">{error}</div>}
      {status && !error && <div className="text-slate-500 text-xs">{status}</div>}

      {loaded && sim && (
        <>
          <ReplayStage
            sim={sim}
            geometry={loaded.geometry}
            frame={frame}
            playing={false}
            speed={1}
            bodyColor="#ffffff"
            trail="#8b5cf6"
            thrust="#cbd5e1"
            arrow={loaded.arrow}
            arrowRadius={loaded.arrowRadius}
            replayTimeMs={frameTimeMs}
            onTogglePlay={() => {}}
            onScrub={() => {}}
            onSpeed={() => {}}
            hideControls
          />

          {/* Transport */}
          <div className="space-y-2 bg-black/30 border border-white/5 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-300"
                onClick={() => {
                  if (frame >= path.length - 1) setFrame(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <input
                type="range"
                min={0}
                max={Math.max(1, path.length - 1)}
                value={Math.floor(frame)}
                onChange={(e) => {
                  setPlaying(false);
                  setFrame(Number(e.target.value));
                }}
                className="flex-1 accent-[var(--app-accent)]"
                aria-label="TAS scrubber"
              />
              <span className="font-mono text-[11px] text-slate-400 w-24 text-right">
                tick {currentTick} · {(frameTimeMs / 1000).toFixed(3)}s
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Go to time (s)
              </span>
              <Input
                value={goTo}
                onChange={(e) => setGoTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") jumpToTime();
                }}
                placeholder={(frameTimeMs / 1000).toFixed(2)}
                className="bg-white/5 border-white/10 h-8 w-24 text-xs font-mono"
              />
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={jumpToTime}>
                Jump
              </Button>
              <span className="text-[11px] text-slate-500">
                {finishTick !== null
                  ? `Finish at tick ${finishTick} (${((finishTick * SIM_TICK_MS) / 1000).toFixed(3)}s)`
                  : "Not finished"}
              </span>
            </div>
          </div>

          {/* Input editor */}
          <div className="bg-black/30 border border-white/5 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Input at tick {currentTick} ({symbols.length} total)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => {
                    setPlaying(false);
                    setFrame((f) => Math.max(0, Math.floor(f) - 1));
                  }}
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => {
                    setPlaying(false);
                    setFrame((f) => Math.min(path.length - 1, Math.floor(f) + 1));
                  }}
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={exportInputs}
                  disabled={symbols.length === 0}
                >
                  <Download className="w-3.5 h-3.5 mr-1" /> Export
                </Button>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void importInputs(file);
                      e.target.value = "";
                    }}
                  />
                  <span className="inline-flex items-center h-8 px-3 rounded-md border border-white/10 text-xs hover:bg-white/5">
                    <Upload className="w-3.5 h-3.5 mr-1" /> Import
                  </span>
                </label>
              </div>
            </div>

            {/* Symbol picker for the current tick */}
            <div className="flex items-center gap-2 flex-wrap">
              {REPLAY_SYMBOLS.map((s) => (
                <Button
                  key={s.key}
                  size="sm"
                  variant={currentSymbol === symbolValue(s.key) ? "secondary" : "ghost"}
                  className={cn("h-8 text-xs font-mono", symbolTone(s.key))}
                  onClick={() => setSymbolAt(currentTick, symbolValue(s.key))}
                >
                  {s.short} · {s.label}
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => insertSymbol(currentTick, NEUTRAL)}
              >
                + Insert tick
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs text-rose-400"
                onClick={() => deleteSymbol(currentTick)}
                disabled={symbols.length === 0}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete tick
              </Button>
            </div>

            {/* Neighbouring ticks for context. */}
            {symbols.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {symbols.slice(Math.max(0, currentTick - 12), currentTick + 13).map((sym, i) => {
                  const index = Math.max(0, currentTick - 12) + i;
                  return (
                    <button
                      key={index}
                      onClick={() => {
                        setPlaying(false);
                        setFrame(index + 1);
                      }}
                      className={cn(
                        "w-6 h-6 shrink-0 rounded text-[10px] font-mono border",
                        index === currentTick
                          ? "border-[var(--app-accent)] text-white"
                          : "border-white/10 text-slate-400",
                        index === currentTick ? "" : tickTone(sym),
                      )}
                      title={`tick ${index}`}
                    >
                      {REPLAY_SYMBOLS[sym]?.short ?? "?"}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function symbolValue(key: ReplaySymbolKey): number {
  return REPLAY_SYMBOLS.findIndex((s) => s.key === key);
}

function symbolTone(key: ReplaySymbolKey): string {
  return {
    neutral: "text-slate-400",
    left: "text-[#60a5fa]",
    right: "text-[#fbbf24]",
    brake: "text-rose-400",
  }[key];
}

function tickTone(sym: number): string {
  return ["bg-slate-700/40", "bg-[#3b82f6]/30", "bg-[#f59e0b]/30", "bg-rose-500/30"][sym] ?? "";
}
