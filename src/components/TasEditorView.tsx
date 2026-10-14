import * as React from "react";
import {
  Play,
  Pause,
  Loader2,
  Upload,
  Download,
  Plus,
  Minus,
  Send,
  Medal,
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
  parseTasFile,
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
import { TasSubmitDialog } from "@/components/TasSubmitDialog";
import { fetchTasBoard, type TasEntry } from "@/lib/tas-leaderboard";
import { TasReplayViewer } from "@/components/ReplayViewer";
import type { CompareCandidate } from "@/hooks/useCompareGhosts";
import type { TasLoadRequest } from "@/components/TasLeaderboardView";

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

/** A run-length segment: one input held for `length` consecutive 240Hz ticks. */
interface Segment {
  symbol: number;
  start: number;
  length: number;
}

/** Run-length of the held input that begins at `index`. */
function lengthOf(symbols: number[], index: number): number {
  let len = 0;
  const symbol = symbols[index];
  while (index + len < symbols.length && symbols[index + len] === symbol) len++;
  return len;
}

/**
 * A tool-assisted-speedrun editor. A run is shown the way speedrunners think
 * about it — a list of held inputs ("Left 37", "Right 42") from the start to
 * the finish — rather than tick by tick. Each row's +/- grows or shrinks that
 * hold by one tick; the real game engine re-simulates the result live.
 */
export function TasEditorView({ loadRequest }: { loadRequest?: TasLoadRequest | null }) {
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
  /** Whether the input list shows tick counts or their wall-clock time. */
  const [showTime, setShowTime] = React.useState(false);
  const [boardOpen, setBoardOpen] = React.useState(false);
  const [boardEntries, setBoardEntries] = React.useState<LeaderboardEntry[]>([]);
  const [boardLoading, setBoardLoading] = React.useState(false);
  // Community TAS board for the loaded level, plus the submit dialog state.
  const [tasEntries, setTasEntries] = React.useState<TasEntry[]>([]);
  const [tasOpen, setTasOpen] = React.useState(false);
  // Compare ghosts for the TAS board below: the level's real-game runs and its
  // other TAS entries, so a TAS run can be watched against either.
  const compareCandidates = React.useMemo<CompareCandidate[]>(() => {
    const human: CompareCandidate[] = boardEntries
      .filter((e) => !e.isLegacy && e.run_id > 0)
      .map((e) => ({
        id: `run-${e.run_id}`,
        runId: e.run_id,
        username: e.username,
        inputs: "",
        inputCount: 0,
        arrowName: e.arrow_name,
        timeMs: Math.round(e.completion_time * 1000),
        kind: "human" as const,
      }));
    const tas: CompareCandidate[] = tasEntries.map((e) => ({
      id: `tas-${e.id}`,
      username: e.username,
      inputs: e.inputs,
      inputCount: e.inputCount,
      arrowName: e.arrowName,
      timeMs: e.timeMs,
      kind: "tas" as const,
    }));
    return [...human, ...tas];
  }, [boardEntries, tasEntries]);

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

  /** Load a level from scratch (no inputs yet). */
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

  /** Load a community TAS entry (level + arrow + its input string) into the editor. */
  const loadTasEntry = React.useCallback(
    async (request: TasLoadRequest) => {
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const info = await loadLevel(request.levelId, request.arrowName);
        if (!info) return;
        setLoaded(info);
        setLevelId(request.levelId);
        setArrowName(request.arrowName);
        setRunId("");
        const decoded = decodeInputSymbols(request.inputs, request.inputCount);
        applySymbols(decoded);
        setFrame(0);
        setStatus(
          `Loaded TAS run — ${decoded.length} inputs, ${((decoded.length * REPLAY_TICK_MS) / 1000).toFixed(2)}s. Edit it to make it your own before submitting.`,
        );
        setBoardOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [loadLevel, applySymbols],
  );

  // Pull in a run handed over from the TAS leaderboard (its "load" action).
  const appliedRequestRef = React.useRef<TasLoadRequest | null>(null);
  React.useEffect(() => {
    if (!loadRequest || appliedRequestRef.current === loadRequest) return;
    appliedRequestRef.current = loadRequest;
    void loadTasEntry(loadRequest);
  }, [loadRequest, loadTasEntry]);

  /** Refresh the community TAS board for the loaded level. */
  const refreshTas = React.useCallback(async (id: string) => {
    if (!id) return;
    try {
      setTasEntries(await fetchTasBoard(id));
    } catch {
      setTasEntries([]);
    }
  }, []);

  // Load the TAS board whenever a new level is opened.
  React.useEffect(() => {
    if (loaded) void refreshTas(levelId);
  }, [loaded, levelId, refreshTas]);

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

  const commit = (next: number[], fromTick: number) => {
    symbolsRef.current = next;
    setSymbols(next);
    resimulate(fromTick, next);
  };

  /** Change the input held at `index` (splitting/merging its segments). */
  const changeSymbol = (index: number, symbol: number) => {
    if (index < 0 || index >= symbolsRef.current.length) return;
    if (symbolsRef.current[index] === symbol) return;
    const next = symbolsRef.current.slice();
    next[index] = symbol;
    commit(next, index);
  };

  /** Grow (+1) or shrink (-1) the hold that starts at `segStart`. */
  const adjustSegment = (segStart: number, delta: number, symbol: number) => {
    const len = lengthOf(symbolsRef.current, segStart);
    if (delta > 0) {
      const next = symbolsRef.current.slice();
      next.splice(segStart + len, 0, symbol);
      commit(next, segStart + len);
      setFrame(segStart + len + 1);
    } else {
      if (len <= 1) return;
      const next = symbolsRef.current.slice();
      next.splice(segStart + len - 1, 1);
      commit(next, segStart + len - 1);
      setFrame(Math.min(segStart + len - 1, next.length));
    }
  };

  /** Append a new hold of `symbol` (and `length` ticks) at the end. */
  const appendSegment = (symbol: number, length: number) => {
    const next = symbolsRef.current.slice();
    const start = next.length;
    for (let i = 0; i < length; i++) next.push(symbol);
    commit(next, start);
    setFrame(Math.min(start + 1, next.length));
  };

  const segments = React.useMemo<Segment[]>(() => {
    const out: Segment[] = [];
    let i = 0;
    while (i < symbols.length) {
      const symbol = symbols[i];
      let len = 1;
      while (i + len < symbols.length && symbols[i + len] === symbol) len++;
      out.push({ symbol, start: i, length: len });
      i += len;
    }
    return out;
  }, [symbols]);

  const currentTick = Math.max(0, Math.min(Math.floor(frame), Math.max(0, symbols.length - 1)));
  const currentSymbol = symbols[currentTick];
  const frameTimeMs = frame * SIM_TICK_MS;
  const currentSegIndex = segments.findIndex(
    (s) => currentTick >= s.start && currentTick < s.start + s.length,
  );

  const jumpToSegment = (start: number) => {
    setPlaying(false);
    setFrame(Math.min(start + 1, Math.max(0, path.length - 1)));
  };

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
    setError(null);
    setStatus(null);
    try {
      const parsed = parseTasFile(await file.text());

      // A file that names its level/arrow can be opened straight into the editor.
      const namedLevel = parsed.mapName
        ? LEVELS.find((l) => l.name.toLowerCase() === parsed.mapName!.toLowerCase())?.id
        : undefined;
      const targetLevel = parsed.levelId ?? namedLevel;
      const targetArrow = parsed.arrowName ?? arrowName;
      if (targetLevel && (targetLevel !== levelId || targetArrow !== arrowName)) {
        const info = await loadLevel(targetLevel, targetArrow);
        if (!info) return;
        setLoaded(info);
        setLevelId(targetLevel);
        setArrowName(targetArrow);
        setRunId("");
      }

      applySymbols(parsed.symbols);
      const finish =
        parsed.finishTick != null
          ? `, finish ${((parsed.finishTick * SIM_TICK_MS) / 1000).toFixed(3)}s`
          : "";
      setStatus(`Imported ${parsed.symbols.length} inputs${finish}.`);
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
            Load a run's inputs (or just a level). The run is listed as the inputs it holds, in
            order, from Start to Finish. Use +/- on a row to lengthen or shorten that hold by one
            tick; the real game engine re-simulates the result live.
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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
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
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => setTasOpen(true)}
                    disabled={finishTick === null || symbols.length === 0}
                    title={
                      finishTick === null
                        ? "Finish the run before submitting"
                        : "Submit this TAS time"
                    }
                  >
                    <Send className="w-3.5 h-3.5 mr-1" /> Submit TAS
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
                      accept=".json,.txt,application/json,text/plain"
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
            </div>
          </div>

          {/* Input list */}
          <div className="bg-black/30 border border-white/5 rounded-lg p-3 space-y-3 lg:max-h-[70vh] lg:overflow-y-auto">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Inputs ({symbols.length} ticks)
              </span>
              <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
                {(["ticks", "time"] as const).map((mode) => {
                  const active = (mode === "time") === showTime;
                  return (
                    <button
                      key={mode}
                      onClick={() => setShowTime(mode === "time")}
                      className={cn(
                        "px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        active
                          ? "bg-[var(--app-accent)]/20 text-[var(--app-accent)]"
                          : "text-slate-500 hover:text-slate-300",
                      )}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between px-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Start
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {showTime ? "0.000s" : "0t"}
              </span>
            </div>

            <div className="space-y-1">
              {segments.length === 0 && (
                <div className="text-slate-500 text-xs px-2 py-3">
                  No inputs yet — add a hold to start building the run.
                </div>
              )}
              {segments.map((seg, i) => {
                const active = i === currentSegIndex;
                return (
                  <div
                    key={seg.start}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1",
                      active && "bg-white/5 ring-1 ring-[var(--app-accent)]/40",
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 text-center text-xs font-bold font-mono",
                        symbolTone(REPLAY_SYMBOLS[seg.symbol]?.key ?? "neutral"),
                      )}
                    >
                      {REPLAY_SYMBOLS[seg.symbol]?.short ?? "?"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-slate-400"
                      onClick={() => adjustSegment(seg.start, -1, seg.symbol)}
                      disabled={seg.length <= 1}
                      aria-label="Remove one tick"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <span className="w-12 text-center font-mono text-xs text-slate-100">
                      {showTime ? seconds(seg.length) : seg.length}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-slate-400"
                      onClick={() => adjustSegment(seg.start, 1, seg.symbol)}
                      aria-label="Add one tick"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                    <button
                      className="ml-auto font-mono text-[10px] text-slate-500 hover:text-slate-300"
                      onClick={() => jumpToSegment(seg.start)}
                      title="Jump to this hold"
                    >
                      {showTime ? seconds(seg.start) : `tick ${seg.start}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between px-2 pt-1 border-t border-white/5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                Finish
              </span>
              <span className="font-mono text-[11px] text-[var(--app-accent)]">
                {finishTick !== null
                  ? showTime
                    ? seconds(finishTick)
                    : `tick ${finishTick}`
                  : "—"}
              </span>
            </div>

            {/* Edit the hold under the cursor */}
            <div className="pt-2 border-t border-white/5 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                {segments.length > 0 ? `Tick ${currentTick} — set input` : "Add a hold"}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {REPLAY_SYMBOLS.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant={
                      segments.length > 0 && currentSymbol === symbolValue(s.key)
                        ? "secondary"
                        : "ghost"
                    }
                    className={cn("h-7 text-[11px] font-mono", symbolTone(s.key))}
                    onClick={() => {
                      if (segments.length === 0) appendSegment(symbolValue(s.key), 1);
                      else changeSymbol(currentTick, symbolValue(s.key));
                    }}
                  >
                    {s.short}
                  </Button>
                ))}
                {[10, 100].map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => appendSegment(symbolValue("neutral"), n)}
                  >
                    +{n}n
                  </Button>
                ))}
              </div>
            </div>

            {/* Community TAS board */}
            <div className="pt-2 border-t border-white/5 space-y-2">
              <div className="flex items-center gap-2">
                <Medal className="w-3.5 h-3.5 text-[var(--app-accent)]" />
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                  TAS leaderboard
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-slate-400 ml-auto"
                  onClick={() => void refreshTas(levelId)}
                  aria-label="Refresh TAS board"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </div>
              {tasEntries.length === 0 ? (
                <div className="text-slate-500 text-[11px] px-1">
                  No TAS times yet. Finish a run and hit “Submit TAS” to set the first.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {tasEntries.slice(0, 8).map((entry, i) => (
                    <div key={entry.id} className="flex items-center gap-2 px-1 py-0.5">
                      <span className="w-4 text-right font-mono text-[11px] text-slate-500">
                        {i === 0 ? <Trophy className="w-3 h-3 text-[var(--app-accent)]" /> : i + 1}
                      </span>
                      <span className="flex-1 truncate text-[11px] text-slate-200">
                        {entry.username}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--app-accent)]">
                        {(entry.timeMs / 1000).toFixed(3)}s
                      </span>
                      <TasReplayViewer
                        levelId={levelId}
                        levelName={loaded?.mapName}
                        username={entry.username}
                        arrowName={entry.arrowName}
                        inputs={entry.inputs}
                        inputCount={entry.inputCount}
                        timeMs={entry.timeMs}
                        className="h-6 w-6"
                        boardEntries={compareCandidates.filter((c) => c.id !== `tas-${entry.id}`)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loaded && finishTick !== null && (
        <TasSubmitDialog
          open={tasOpen}
          onOpenChange={setTasOpen}
          levelId={levelId}
          levelName={loaded.mapName}
          arrowName={loaded.arrowName}
          timeMs={finishTick * SIM_TICK_MS}
          inputs={encodeInputSymbols(symbolsRef.current)}
          inputCount={symbols.length}
          onSubmitted={() => void refreshTas(levelId)}
        />
      )}
    </div>
  );
}

function symbolValue(key: ReplaySymbolKey): number {
  return REPLAY_SYMBOLS.findIndex((s) => s.key === key);
}

/** A tick count as a wall-clock time string, e.g. 240 ticks → "1.000s". */
function seconds(ticks: number): string {
  return `${((ticks * SIM_TICK_MS) / 1000).toFixed(3)}s`;
}

function symbolTone(key: ReplaySymbolKey): string {
  return {
    neutral: "text-slate-400",
    left: "text-[#60a5fa]",
    right: "text-[#fbbf24]",
    brake: "text-rose-400",
  }[key];
}
