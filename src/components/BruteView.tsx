import * as React from "react";
import { Check, Cpu, Loader2, Pencil, Send, Sparkles, Square, Timer, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LEVELS } from "@/constants";
import {
  arrowConstants,
  levelGeometry,
  simulateRun,
  type RawLevelData,
  type SimGeometry,
  type SimResult,
} from "@/lib/replay-sim";
import { arrowKind } from "@/lib/arrow-sprites";
import { ReplayStage } from "@/components/ReplayViewer";
import { TasSubmitDialog } from "@/components/TasSubmitDialog";
import { LevelPicker } from "@/components/LevelPicker";
import { fetchTasBoard, type TasEntry } from "@/lib/tas-leaderboard";
import { fetchLeaderboard } from "@/services/api";
import { fetchRunInputs } from "@/hooks/useCompareGhosts";
import type { LeaderboardEntry } from "@/types";
import {
  seedFromInputs,
  type BruteProgress,
  type BruteResult,
  type BruteResultLite,
} from "@/lib/tas-brute";
import { encodeInputSymbols } from "@/lib/replay";
import { SIM_TICK_MS } from "@/lib/replay-sim";
import { waypointsToSymbols, simplifyStroke } from "@/lib/path-seed";

/** The three playable arrows, for drawing a line before any run is chosen. */
const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"];

/** An empty trajectory for the draw canvas (no run is replayed there). */
const EMPTY_SIM: SimResult = {
  path: [],
  finishTick: null,
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
};

const BUDGETS = [
  { label: "15s", ms: 15000 },
  { label: "30s", ms: 30000 },
  { label: "60s", ms: 60000 },
  { label: "2min", ms: 120000 },
  { label: "5min", ms: 300000 },
  { label: "10min", ms: 600000 },
];

/** Annealing start temperature presets, matching the reference tool. */
const INTENSITIES = [
  { label: "Focused", t0: 2.5, hint: "stays near the seed" },
  { label: "Balanced", t0: 6, hint: "the default" },
  { label: "Exploratory", t0: 12, hint: "roams further, slower to settle" },
];

const fmt = (tick: number | null) =>
  tick === null ? "—" : `${((tick * SIM_TICK_MS) / 1000).toFixed(3)}s`;

/** How many search workers to run in parallel. */
function workerCount(): number {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(8, cores - 1));
}

/**
 * Admin-gated entry point for the Brute optimizer. Non-admins see a
 * "still in development" notice instead of the tool.
 */
export function BruteView({ isAdmin }: { isAdmin?: boolean }) {
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center space-y-2">
        <Cpu className="w-8 h-8 text-slate-600" />
        <p className="text-slate-400 text-sm font-medium">This feature is still in development.</p>
        <p className="text-slate-600 text-xs">Check back soon.</p>
      </div>
    );
  }
  return <BruteRunner />;
}

/**
 * The Brute optimizer. Pick a level and arrow, seed the search from any run on
 * the level's TAS board (or start from the fastest), let it churn, then keep or
 * submit whatever it finds. The search itself lives in `tas-brute.ts`; this is
 * the control room around it.
 */
export function BruteRunner() {
  const [levelId, setLevelId] = React.useState(LEVELS[0]?.id ?? "");
  const [levelName, setLevelName] = React.useState(LEVELS[0]?.name ?? "");
  const [budgetMs, setBudgetMs] = React.useState(BUDGETS[1].ms);
  const [t0, setT0] = React.useState(6);
  const [refine, setRefine] = React.useState(true);
  const [entries, setEntries] = React.useState<TasEntry[]>([]);
  const [seedId, setSeedId] = React.useState<string>("auto");
  // The level's real-game runs, so the search can seed from a human run when no
  // TAS submission exists yet.
  const [humanEntries, setHumanEntries] = React.useState<LeaderboardEntry[]>([]);

  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<BruteProgress | null>(null);
  const [result, setResult] = React.useState<BruteResult | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);

  // Draw-a-line mode: a route sketched on the map becomes the seed run.
  const [bruteTab, setBruteTab] = React.useState<"optimize" | "draw">("optimize");
  const [drawOpen, setDrawOpen] = React.useState(false);
  const [drawnPath, setDrawnPath] = React.useState<{ x: number; y: number }[]>([]);
  const [drawArrow, setDrawArrow] = React.useState(ARROWS[0]);
  const [drawLevelData, setDrawLevelData] = React.useState<RawLevelData | null>(null);
  const [drawGeometry, setDrawGeometry] = React.useState<SimGeometry>({
    walls: [],
    zones: [],
    portals: [],
  });
  const [drawError, setDrawError] = React.useState<string | null>(null);
  // The input stream the drawn line converts to, held until "Use as seed" or a run.
  const [drawnSeed, setDrawnSeed] = React.useState<{
    symbols: number[];
    arrow: string;
    ms: number | null;
  } | null>(null);

  const workersRef = React.useRef<Worker[]>([]);
  const stopRef = React.useRef(false);
  /** Resolver for the in-flight search promise, so a Stop can settle it. */
  const settleRef = React.useRef<((result: BruteResultLite | null) => void) | null>(null);
  /** Geometry + arrow of the run in flight, so a Stop can rebuild its trajectory. */
  const levelDataRef = React.useRef<RawLevelData | null>(null);
  const arrowRef = React.useRef<string>("");
  /** Level geometry of the last run, kept so the preview can draw the map. */
  const [geometry, setGeometry] = React.useState<SimGeometry>({
    walls: [],
    zones: [],
    portals: [],
  });

  // Load the level's TAS board so a run can be chosen as the seed.
  React.useEffect(() => {
    let cancelled = false;
    fetchTasBoard(levelId)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    fetchLeaderboard(levelId)
      .then((list) => {
        if (!cancelled) setHumanEntries(list);
      })
      .catch(() => {
        if (!cancelled) setHumanEntries([]);
      });
    setResult(null);
    setProgress(null);
    setSeedId("auto");
    return () => {
      cancelled = true;
    };
  }, [levelId]);

  const seedEntry = React.useMemo(() => {
    if (entries.length === 0) return null;
    if (seedId === "auto") return entries[0];
    return entries.find((e) => e.id === seedId) ?? entries[0];
  }, [entries, seedId]);

  const humanSeed = React.useMemo(() => {
    // "auto" means "the fastest run available": the fastest TAS entry if the
    // level has one, otherwise the fastest real-game run. Without the fallback
    // a level whose TAS board is still empty had no usable default seed and the
    // run failed with "No run to seed from".
    if (seedId === "auto") return entries.length === 0 ? (humanEntries[0] ?? null) : null;
    return humanEntries.find((h) => `human-${h.run_id}` === seedId) ?? null;
  }, [humanEntries, seedId, entries.length]);

  const canSeed = entries.length > 0 || humanEntries.length > 0 || !!drawnSeed;

  const seedTimeMs = seedEntry?.timeMs ?? null;

  // Load the level geometry when the draw panel opens, so the map is visible
  // to trace over even before any run has been chosen.
  React.useEffect(() => {
    if (!drawOpen) return;
    let cancelled = false;
    fetch(`/api/level-details/${encodeURIComponent(levelId)}`, {
      signal: AbortSignal.timeout(20000),
    })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`Level request failed (${r.status})`)),
      )
      .then((payload: { levelInfo?: { data?: RawLevelData } }) => {
        if (cancelled) return;
        const data = payload.levelInfo?.data ?? null;
        setDrawLevelData(data);
        setDrawGeometry(data ? levelGeometry(data) : { walls: [], zones: [], portals: [] });
      })
      .catch((e) => {
        if (!cancelled) setDrawError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [drawOpen, levelId]);

  /** Turn the sketched route into an input stream and preview its time. */
  const convertDraw = async () => {
    if (!drawLevelData) {
      setDrawError("Level geometry is still loading.");
      return;
    }
    const waypoints = simplifyStroke(drawnPath, 24);
    if (waypoints.length < 2) {
      setDrawError("Draw a longer line first.");
      return;
    }
    setDrawError(null);
    const symbols = await waypointsToSymbols({
      waypoints,
      levelData: drawLevelData,
      arrowName: drawArrow,
    });
    if (!symbols.length) {
      setDrawError("Could not turn that line into a run.");
      return;
    }
    const sim = await simulateRun(
      encodeInputSymbols(symbols),
      symbols.length,
      drawLevelData,
      {},
      drawArrow,
    );
    const ms = sim.finishTick !== null ? Math.round(sim.finishTick * SIM_TICK_MS) : null;
    setDrawnSeed({ symbols, arrow: drawArrow, ms });
  };

  // Terminate a running search and keep whatever best it had reached.
  const stop = React.useCallback(() => {
    stopRef.current = true;
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];
    settleRef.current?.(null);
    settleRef.current = null;
    setRunning(false);
    const p = progress;
    if (p?.symbols && p.bestTimeMs !== null && levelDataRef.current) {
      const symbols = p.symbols;
      void simulateRun(
        encodeInputSymbols(symbols),
        symbols.length,
        levelDataRef.current,
        {},
        arrowRef.current,
      )
        .then((sim) => {
          setResult({
            symbols,
            inputs: encodeInputSymbols(symbols),
            inputCount: symbols.length,
            timeMs: Math.round(p.bestTimeMs!),
            sim,
            improved:
              p.seedFinishTick === null || (p.bestFinishTick ?? Infinity) < p.seedFinishTick,
            bestFinishTick: p.bestFinishTick,
            bestTimeMs: p.bestTimeMs,
            seedFinishTick: p.seedFinishTick,
            generations: p.generations,
            evaluations: p.evaluations,
          });
        })
        .catch(() => {});
      setStatus(`Stopped at ${(p.bestTimeMs / 1000).toFixed(3)}s — kept the best found.`);
    } else {
      setStatus("Stopped.");
    }
  }, [progress]);

  // Kill any in-flight workers when the view unmounts.
  React.useEffect(
    () => () => {
      workersRef.current.forEach((w) => w.terminate());
      workersRef.current = [];
    },
    [],
  );

  const start = async () => {
    // Resolve the seed. A drawn line wins if one exists; otherwise a TAS entry
    // carries its inputs, or a human run has its replay fetched. Human seeding
    // is what lets a level whose TAS board is still empty be optimized at all.
    let seedInputs = "";
    let seedArrow = "";
    let seedCount = 0;
    let seedMs: number | null = null;
    if (drawnSeed) {
      seedInputs = encodeInputSymbols(drawnSeed.symbols);
      seedCount = drawnSeed.symbols.length;
      seedArrow = drawnSeed.arrow;
      seedMs = drawnSeed.ms;
    } else if (seedEntry) {
      seedInputs = seedEntry.inputs;
      seedArrow = seedEntry.arrowName;
      seedCount = seedEntry.inputCount;
      seedMs = seedEntry.timeMs;
    } else if (humanSeed) {
      if (humanSeed.replay_available === 0) {
        setError("That run has no replay to seed from. Pick another run or add a TAS entry.");
        return;
      }
      const loaded = await fetchRunInputs(humanSeed.run_id);
      if (!loaded) {
        setError("Could not load that run's replay.");
        return;
      }
      seedInputs = loaded.inputs;
      seedCount = loaded.inputCount;
      seedArrow = loaded.arrowName || humanSeed.arrow_name;
      seedMs = Math.round(humanSeed.completion_time * 1000);
    } else {
      setError("No run to seed from. Pick a run to optimize.");
      return;
    }

    setRunning(true);
    setError(null);
    setStatus(null);
    setResult(null);
    setProgress(null);
    stopRef.current = false;
    try {
      const levelRes = await fetch(`/api/level-details/${encodeURIComponent(levelId)}`, {
        signal: AbortSignal.timeout(20000),
      });
      if (!levelRes.ok) throw new Error(`Level request failed (${levelRes.status})`);
      const payload = (await levelRes.json()) as { levelInfo?: { data?: RawLevelData } };
      const levelData = payload.levelInfo?.data ?? null;
      if (!levelData) throw new Error("Level has no geometry");
      setGeometry(levelGeometry(levelData));
      levelDataRef.current = levelData;
      arrowRef.current = seedArrow;

      const seedSymbols = seedFromInputs(seedInputs, seedCount || undefined);

      // Fan the search out over several workers, each with its own RNG seed, and
      // keep the best line any of them finds. Independent restarts beat one long
      // run because the annealer's reheat cycle can stall on a plateau; a fresh
      // seed escapes it. Every worker runs off-thread, so the page stays live.
      const n = workerCount();
      const workers: Worker[] = [];
      for (let i = 0; i < n; i++) {
        workers.push(
          new Worker(new URL("../lib/tas-brute.worker.ts", import.meta.url), { type: "module" }),
        );
      }
      workersRef.current = workers;

      const out = await new Promise<BruteResultLite | null>((resolve, reject) => {
        settleRef.current = resolve;
        let remaining = n;
        let best: BruteResultLite | null = null;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          settleRef.current = null;
          resolve(best);
        };
        // Each worker streams its own progress, but the panel is a single row of
        // stats. Keep a per-worker ledger and sum the counters — showing just the
        // last worker's snapshot made Generations/Rollouts jump around (they are
        // independent per worker) instead of climbing monotonically. The best
        // tick is the minimum across workers, so it only ever improves.
        const workerProgress = new Map<number, BruteProgress>();
        const publishProgress = () => {
          const ps = [...workerProgress.values()];
          if (ps.length === 0) return;
          let bestTick: number | null = null;
          for (const p of ps) {
            if (p.bestFinishTick !== null && (bestTick === null || p.bestFinishTick < bestTick)) {
              bestTick = p.bestFinishTick;
            }
          }
          const leader =
            ps.find((p) => p.bestFinishTick === bestTick) ??
            ps.reduce((a, b) => (b.generations > a.generations ? b : a));
          setProgress({
            bestFinishTick: bestTick,
            bestTimeMs: leader.bestTimeMs,
            seedFinishTick: leader.seedFinishTick,
            generations: ps.reduce((sum, p) => sum + p.generations, 0),
            evaluations: ps.reduce((sum, p) => sum + p.evaluations, 0),
            symbols: leader.symbols,
          });
        };
        workers.forEach((worker, i) => {
          worker.onmessage = (
            ev: MessageEvent<
              | { type: "progress"; progress: BruteProgress }
              | { type: "done"; result: BruteResultLite | null }
              | { type: "error"; message: string }
            >,
          ) => {
            const m = ev.data;
            if (m.type === "progress") {
              workerProgress.set(i, m.progress);
              publishProgress();
            } else if (m.type === "done") {
              if (m.result && (!best || m.result.timeMs < best.timeMs)) best = m.result;
              if (--remaining === 0) finish();
            } else if (m.type === "error") {
              if (--remaining === 0) {
                if (best) finish();
                else reject(new Error(m.message));
              }
            }
          };
          worker.onerror = (ev) => {
            if (--remaining === 0) {
              if (best) finish();
              else reject(new Error(ev.message || "A search worker crashed."));
            }
          };
          worker.postMessage({
            type: "start",
            options: {
              seedSymbols,
              levelData,
              arrowName: seedArrow,
              budgetMs,
              t0,
              refine,
              rngSeed: (Date.now() ^ ((i + 1) * 0x9e3779b9)) & 0x7fffffff,
            },
          });
        });
      });

      if (stopRef.current) return;
      workersRef.current.forEach((w) => w.terminate());
      workersRef.current = [];
      if (!out) {
        setError("The search could not simulate this level.");
        return;
      }
      const sim = await simulateRun(out.inputs, out.inputCount, levelData, {}, seedArrow);
      const result: BruteResult = { ...out, sim };
      setResult(result);
      const delta = seedMs !== null ? seedMs - result.timeMs : null;
      setStatus(
        delta !== null && delta > 0
          ? `Found ${(result.timeMs / 1000).toFixed(3)}s — ${(delta / 1000).toFixed(3)}s faster than the seed (${n}× search).`
          : `No improvement found in ${(result.timeMs / 1000).toFixed(3)}s. Try a longer budget.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Cpu className="w-5 h-5 text-[var(--app-accent)]" /> Brute optimizer
        </h2>
        <p className="text-slate-500 text-sm">
          Let the real physics engine hunt for a faster line. It seeds from a run on the level's TAS
          board — or any human run when the board is still empty — then tries tighter holds, brakes
          and counter-steers to shave the finish time.
        </p>
      </div>

      <div className="flex items-center gap-1 border-b border-white/5">
        {(
          [
            ["optimize", "Optimize"],
            ["draw", "Draw Seed"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-xs font-bold uppercase tracking-widest transition-colors",
              bruteTab === key
                ? "border-[var(--app-accent)] text-[var(--app-accent)]"
                : "border-transparent text-slate-500 hover:text-slate-300",
            )}
            onClick={() => setBruteTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={cn(bruteTab !== "optimize" && "hidden")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Level">
            <LevelPicker
              value={levelId}
              onChange={(l) => {
                setLevelId(l.id);
                setLevelName(l.name);
              }}
              className="w-full"
            />
          </Field>

          <Field label="Seed run">
            <Select value={seedId} onValueChange={setSeedId} disabled={!canSeed}>
              <SelectTrigger className="h-9 text-xs bg-white/5 border-white/10">
                <SelectValue placeholder={canSeed ? "Fastest" : "No runs"} />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-72">
                {entries.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                      TAS board
                    </SelectLabel>
                    <SelectItem value="auto" className="text-xs">
                      Fastest TAS run
                    </SelectItem>
                    {entries.map((e) => (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {e.username} — {(e.timeMs / 1000).toFixed(3)}s ({e.arrowName})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {humanEntries.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                      Human runs
                    </SelectLabel>
                    {entries.length === 0 && (
                      <SelectItem value="auto" className="text-xs">
                        Fastest run
                      </SelectItem>
                    )}
                    {humanEntries.slice(0, 25).map((h) => (
                      <SelectItem key={h.run_id} value={`human-${h.run_id}`} className="text-xs">
                        {h.username} — {h.completion_time.toFixed(3)}s ({h.arrow_name})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Time budget">
            <Select value={String(budgetMs)} onValueChange={(v) => setBudgetMs(Number(v))}>
              <SelectTrigger className="h-9 text-xs bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                {BUDGETS.map((b) => (
                  <SelectItem key={b.ms} value={String(b.ms)} className="text-xs">
                    Search {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Intensity">
            <Select value={String(t0)} onValueChange={(v) => setT0(Number(v))}>
              <SelectTrigger className="h-9 text-xs bg-white/5 border-white/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                {INTENSITIES.map((i) => (
                  <SelectItem key={i.t0} value={String(i.t0)} className="text-xs">
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Refine (1-tick polish)">
            <Button
              variant="outline"
              className={cn(
                "h-9 w-full text-xs justify-start",
                refine
                  ? "border-[var(--app-accent)]/40 text-[var(--app-accent)]"
                  : "text-slate-400",
              )}
              onClick={() => setRefine((r) => !r)}
            >
              <Check className={cn("w-3.5 h-3.5 mr-1", refine ? "opacity-100" : "opacity-0")} />
              {refine ? "On" : "Off"}
            </Button>
          </Field>

          <div className="flex items-end">
            {running ? (
              <Button variant="outline" className="h-9 w-full text-xs" onClick={stop}>
                <Square className="w-3.5 h-3.5 mr-1" /> Stop
              </Button>
            ) : (
              <Button
                className="h-9 w-full text-xs"
                onClick={() => void start()}
                disabled={!canSeed}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" /> Optimize
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Draw Seed tab: sketch a line on the map, convert it to inputs, seed the search. */}
      <div className={cn(bruteTab !== "draw" && "hidden")}>
        <div className="rounded-lg border border-white/5 bg-black/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className={cn(
                "h-8 text-xs",
                drawOpen
                  ? "border-[var(--app-accent)]/40 text-[var(--app-accent)]"
                  : "text-slate-300",
              )}
              onClick={() => setDrawOpen((v) => !v)}
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              {drawOpen ? "Close drawing" : "Draw a line"}
            </Button>
            {drawnSeed && (
              <span className="text-[11px] text-slate-400">
                Drawn seed:{" "}
                <span className="font-mono text-[var(--app-accent)]">
                  {drawnSeed.ms !== null ? `${(drawnSeed.ms / 1000).toFixed(3)}s` : "DNF"}
                </span>{" "}
                · {drawnSeed.arrow} · {drawnSeed.symbols.length} inputs — the search will seed from
                it.
              </span>
            )}
          </div>

          {drawOpen && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500">
                Drag over the map to trace the route you want the arrow to take. The engine follows
                your line with its real physics, turning the sketch into inputs; then the optimizer
                refines that line. Trace through the level, start to finish.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                  Arrow
                </span>
                <Select value={drawArrow} onValueChange={setDrawArrow}>
                  <SelectTrigger className="h-8 w-40 text-xs bg-white/5 border-white/10">
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
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-slate-400"
                  onClick={() => {
                    setDrawnPath([]);
                    setDrawnSeed(null);
                    setDrawError(null);
                  }}
                  disabled={drawnPath.length === 0}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => void convertDraw()}
                  disabled={drawnPath.length < 2}
                >
                  Convert to inputs
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void start()}
                  disabled={!drawnSeed || running}
                >
                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Optimize this line
                </Button>
              </div>
              <ReplayStage
                sim={EMPTY_SIM}
                geometry={drawGeometry}
                frame={0}
                playing={false}
                speed={1}
                bodyColor="#8ab4ff"
                trail="#8ab4ff"
                thrust="#ffd166"
                arrow={arrowKind(drawArrow)}
                arrowRadius={arrowConstants(drawArrow).radius ?? 16}
                replayTimeMs={0}
                onTogglePlay={() => {}}
                onScrub={() => {}}
                onSpeed={() => {}}
                hideControls
                onDrawPath={setDrawnPath}
                drawnPath={drawnPath}
              />
              {drawError && <p className="text-xs text-red-400">{drawError}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-white/5 bg-black/30 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <Stat
            label="Seed"
            value={
              seedEntry
                ? `${seedEntry.inputCount} ticks`
                : humanSeed
                  ? `${humanSeed.arrow_name} (human)`
                  : "—"
            }
            raw={
              seedEntry
                ? `${(seedEntry.timeMs / 1000).toFixed(3)}s`
                : humanSeed
                  ? `${humanSeed.completion_time.toFixed(3)}s`
                  : "—"
            }
          />
          <Stat
            label="Best found"
            value={progress ? fmt(progress.bestFinishTick) : "—"}
            highlight
          />
          <Stat label="Generations" value={progress ? String(progress.generations) : "0"} />
          <Stat label="Rollouts" value={progress ? progress.evaluations.toLocaleString() : "0"} />
        </div>

        {running && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--app-accent)]" />
            Searching for a faster line…
          </div>
        )}
        {status && (
          <p className={cn("text-xs", result?.improved ? "text-emerald-400" : "text-slate-500")}>
            {status}
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {result && result.sim.path.length > 1 && (
        <ResultPreview
          result={result}
          arrowName={seedEntry?.arrowName ?? humanSeed?.arrow_name ?? "Narrow Arrow"}
          geometry={geometry}
        />
      )}

      {result && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-9 text-xs"
            onClick={() => setSubmitOpen(true)}
            disabled={!result.improved}
          >
            <Send className="w-3.5 h-3.5 mr-1" /> Submit as my TAS
          </Button>
          <span className="text-[11px] text-slate-500">
            Posts the optimized run to the level's TAS board under your name.
          </span>
        </div>
      )}

      {result && (
        <TasSubmitDialog
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          levelId={levelId}
          levelName={levelName || levelId}
          arrowName={seedEntry?.arrowName ?? humanSeed?.arrow_name ?? "Narrow Arrow"}
          timeMs={result.timeMs}
          inputs={result.inputs}
          inputCount={result.inputCount}
          onSubmitted={() =>
            void fetchTasBoard(levelId)
              .then(setEntries)
              .catch(() => {})
          }
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
        {label}
      </span>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  raw,
  highlight,
}: {
  label: string;
  value: string;
  raw?: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
        {label}
      </span>
      <span
        className={cn(
          "font-mono",
          highlight ? "text-[var(--app-accent)] font-bold" : "text-slate-200",
        )}
      >
        {value}
      </span>
      {raw && <span className="font-mono text-slate-500 text-[11px]">{raw}</span>}
    </div>
  );
}

/**
 * The optimized run's trajectory, replayed on the shared stage. The seed isn't
 * overlaid because the optimizer doesn't return it; the point here is to see
 * the new line the search found.
 */
function ResultPreview({
  result,
  arrowName,
  geometry,
}: {
  result: BruteResult;
  arrowName: string;
  geometry: SimGeometry;
}) {
  const [frame, setFrame] = React.useState(0);
  const [playing, setPlaying] = React.useState(true);
  const [speed, setSpeed] = React.useState(1);
  const pathLength = result.sim.path.length;

  // Playback advances inside ReplayStage via refs; the settled frame is reported
  // back through onFrameCommit, so this component does not re-render per frame.

  return (
    <div className="rounded-lg border border-white/5 bg-black/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <Timer className="w-3.5 h-3.5 text-[var(--app-accent)]" />
        <span className="font-mono text-[var(--app-accent)] font-bold">
          {(result.timeMs / 1000).toFixed(3)}s
        </span>
        <span>· {result.inputCount} inputs</span>
        {result.improved && (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <Trophy className="w-3 h-3" /> improved
          </span>
        )}
      </div>
      <ReplayStage
        sim={result.sim}
        geometry={geometry}
        frame={frame}
        playing={playing}
        speed={speed}
        bodyColor="#8ab4ff"
        trail="#8ab4ff"
        thrust="#ffd166"
        arrow={arrowKind(arrowName)}
        arrowRadius={arrowConstants(arrowName).radius ?? 16}
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
        onFrameCommit={setFrame}
      />
    </div>
  );
}
