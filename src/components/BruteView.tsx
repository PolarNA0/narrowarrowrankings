import * as React from "react";
import {
  Check,
  Cpu,
  Loader2,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Square,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { LevelPicker, siteIdOf } from "@/components/LevelPicker";
import { fetchTasBoard, type TasEntry } from "@/lib/tas-leaderboard";
import { fetchSiteLevel, fetchSiteScores, siteLevelToRawData, type SiteScoreEntry } from "@/lib/site-levels";
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

/** Quick-pick budgets (seconds). A typed amount is authoritative; `0` = no cap. */
const BUDGET_PRESETS = [15, 30, 60, 120, 300, 600];

/** Search presets: broad strokes at a high temperature vs fine, careful ones. */
const INTENSITIES = [
  { label: "Fast", t0: 12, scale: 1.6, hint: "broad strokes, quick to explore" },
  { label: "Balanced", t0: 6, scale: 1, hint: "the default" },
  { label: "Slow", t0: 2.5, scale: 0.45, hint: "fine strokes, thorough polish" },
] as const;

const fmt = (tick: number | null) =>
  tick === null ? "—" : `${((tick * SIM_TICK_MS) / 1000).toFixed(3)}s`;

/** How many search workers to run in parallel. */
function workerCount(): number {
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(8, cores - 1));
}

/**
 * Entry point for the Brute optimizer. Public: anyone can open the tool and
 * run one or more searches. (It was admin-gated while it was in development.)
 */
export function BruteView() {
  return <BruteRunner />;
}

/** Live status of one search, surfaced to the sub-tab bar. */
export interface BruteSearchState {
  id: number;
  label: string;
  running: boolean;
  bestTick: number | null;
}

/** Default name for a freshly added search tab. */
function defaultLabel(i: number) {
  return `Search ${i}`;
}

/**
 * The Brute optimizer. Pick a level and arrow, seed the search from any run on
 * the level's TAS board (or start from the fastest), let it churn, then keep or
 * submit whatever it finds. The search itself lives in `tas-brute.ts`; this is
 * the control room around it.
 */
export function BruteRunner() {
  // Each sub-tab is one independent search. They all run at once (each fans out
  // over its own workers), so a user can chase several levels or seeds in
  // parallel; the tab bar shows which are still searching and their best time.
  const [ids, setIds] = React.useState<number[]>([1]);
  const [active, setActive] = React.useState(1);
  const nextId = React.useRef(2);
  const [states, setStates] = React.useState<Record<number, BruteSearchState>>({});

  const addTab = React.useCallback(() => {
    const id = nextId.current++;
    setIds((prev) => [...prev, id]);
    setActive(id);
  }, []);

  const closeTab = React.useCallback(
    (id: number) => {
      setIds((prev) => {
        const next = prev.filter((x) => x !== id);
        if (next.length === 0) return prev; // keep at least one tab open
        return next;
      });
      setStates((prev) => {
        const { [id]: _drop, ...rest } = prev;
        return rest;
      });
      setActive((cur) => {
        if (cur !== id) return cur;
        const remaining = ids.filter((x) => x !== id);
        return remaining[remaining.length - 1] ?? cur;
      });
    },
    [ids],
  );

  const report = React.useCallback((state: BruteSearchState) => {
    setStates((prev) => {
      const old = prev[state.id];
      if (
        old &&
        old.label === state.label &&
        old.running === state.running &&
        old.bestTick === state.bestTick
      ) {
        return prev; // avoid a render loop from an unchanged report
      }
      return { ...prev, [state.id]: state };
    });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 overflow-x-auto">
        {ids.map((id) => {
          const st = states[id];
          const isActive = id === active;
          return (
            <div
              key={id}
              className={cn(
                "group flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-xs whitespace-nowrap transition-colors",
                isActive
                  ? "border-[var(--app-accent)] text-white"
                  : "border-transparent text-slate-500 hover:text-slate-300",
              )}
            >
              <button className="flex items-center gap-1.5" onClick={() => setActive(id)}>
                {st?.running && (
                  <Loader2 className="w-3 h-3 animate-spin text-[var(--app-accent)]" />
                )}
                <span className="font-medium">{st?.label ?? defaultLabel(id)}</span>
                {st?.bestTick != null && (
                  <span className="font-mono text-[10px] text-slate-500">
                    {((st.bestTick * SIM_TICK_MS) / 1000).toFixed(3)}s
                  </span>
                )}
              </button>
              {ids.length > 1 && (
                <button
                  className="text-slate-600 hover:text-red-400"
                  aria-label={`Close ${st?.label ?? defaultLabel(id)}`}
                  onClick={() => closeTab(id)}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          className="ml-1 rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-white"
          aria-label="Add search"
          onClick={addTab}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {ids.map((id) => (
        <div key={id} className={cn(id !== active && "hidden")}>
          <BruteSearch id={id} onStateChange={report} />
        </div>
      ))}
    </div>
  );
}

/**
 * One independent search: the level/seed/budget controls, the run/stop button,
 * and the result preview. Kept mounted while its sub-tab is hidden so a search
 * keeps running when the user switches tabs.
 */
function BruteSearch({
  id,
  onStateChange,
}: {
  id: number;
  onStateChange: (state: BruteSearchState) => void;
}) {
  const [levelId, setLevelId] = React.useState(LEVELS[0]?.id ?? "");
  const [levelName, setLevelName] = React.useState(LEVELS[0]?.name ?? "");
  const [budgetSecs, setBudgetSecs] = React.useState(30);
  const [t0, setT0] = React.useState(6);
  const [scale, setScale] = React.useState(1);
  const [refine, setRefine] = React.useState(true);
  const [entries, setEntries] = React.useState<TasEntry[]>([]);
  const [seedId, setSeedId] = React.useState<string>("auto");
  // Which arrow's human board feeds the seed picker. "" merges all three; a
  // specific arrow shows its own board, so a WR on a less-played arrow (which
  // the global top-150 can miss) is still selectable as a seed.
  const [seedArrow, setSeedArrow] = React.useState<string>("");
  // The level's real-game runs, so the search can seed from a human run when no
  // TAS submission exists yet.
  const [humanEntries, setHumanEntries] = React.useState<LeaderboardEntry[]>([]);
  // A site level's own board, used instead of the TAS board as the seed source.
  const [siteEntries, setSiteEntries] = React.useState<SiteScoreEntry[]>([]);

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

  // The search budget. A typed amount (seconds) is authoritative; 0 means "run
  // until stopped", which the search reads as an uncapped budget.
  const budgetMs = Math.max(0, Math.round(budgetSecs * 1000));

  // A site level is picked as `site:<id>` and lives only on this site, so its
  // board is the site leaderboard (not the TAS board) and its geometry comes
  // from the site API (it does not exist upstream).
  const siteId = siteIdOf(levelId);
  const isSiteLevel = siteId !== null;

  // Load the level's seed runs. A site level's own board is the seed source; a
  // regular level's is the TAS board (with the real-game board as a fallback).
  React.useEffect(() => {
    let cancelled = false;
    if (siteId) {
      setEntries([]);
      setHumanEntries([]);
      fetchSiteScores(siteId)
        .then((scores) => {
          if (!cancelled) setSiteEntries(scores);
        })
        .catch(() => {
          if (!cancelled) setSiteEntries([]);
        });
    } else {
      setSiteEntries([]);
      fetchTasBoard(levelId)
        .then((list) => {
          if (!cancelled) setEntries(list);
        })
        .catch(() => {
          if (!cancelled) setEntries([]);
        });
      fetchLeaderboard(levelId, false, false, seedArrow || undefined)
        .then((list) => {
          if (!cancelled) setHumanEntries(list);
        })
        .catch(() => {
          if (!cancelled) setHumanEntries([]);
        });
    }
    setResult(null);
    setProgress(null);
    setSeedId("auto");
    return () => {
      cancelled = true;
    };
  }, [levelId, seedArrow, siteId]);

  const seedEntry = React.useMemo(() => {
    if (entries.length === 0) return null;
    if (seedId === "auto") return entries[0];

    // Only resolve here when the selection is actually a TAS entry; a human
    // selection must not fall back to the fastest TAS run (that silently seeded
    // from the TAS board and ignored the picked human run).
    return entries.find((e) => e.id === seedId) ?? null;
  }, [entries, seedId]);

  const humanSeed = React.useMemo(() => {
    // "auto" means "the fastest run available": the fastest TAS entry if the
    // level has one, otherwise the fastest real-game run. Without the fallback
    // a level whose TAS board is still empty had no usable default seed and the
    // run failed with "No run to seed from".
    if (seedId === "auto") return entries.length === 0 ? (humanEntries[0] ?? null) : null;
    return humanEntries.find((h) => `human-${h.run_id}` === seedId) ?? null;
  }, [humanEntries, seedId, entries.length]);

  // A site level's own board is its seed source; it carries the input string
  // directly, so no replay fetch is needed.
  const siteSeed = React.useMemo(() => {
    if (!isSiteLevel || siteEntries.length === 0) return null;
    if (seedId === "auto") return siteEntries[0];
    return siteEntries.find((e) => e.id === seedId) ?? null;
  }, [isSiteLevel, siteEntries, seedId]);

  const canSeed = entries.length > 0 || humanEntries.length > 0 || siteEntries.length > 0 || !!drawnSeed;

  const seedTimeMs = seedEntry?.timeMs ?? siteSeed?.timeMs ?? null;

  const label = `${levelName || levelId}${seedEntry ? ` · ${(seedEntry.timeMs / 1000).toFixed(3)}s` : ""}`;

  // Report this search's live status up to the sub-tab bar.
  React.useEffect(() => {
    onStateChange({
      id,
      label,
      running,
      bestTick: progress?.bestFinishTick ?? null,
    });
  }, [id, label, running, progress, onStateChange]);

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
    } else if (siteSeed) {
      seedInputs = siteSeed.inputs;
      seedArrow = siteSeed.arrowName;
      seedCount = siteSeed.inputCount;
      seedMs = siteSeed.timeMs;
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
      // A site level does not exist upstream, so its geometry comes from the
      // site API; a regular level comes from the level-details route.
      let levelData: RawLevelData | null;
      if (siteId) {
        const rec = await fetchSiteLevel(siteId);
        levelData = rec ? siteLevelToRawData(rec) : null;
      } else {
        const levelRes = await fetch(`/api/level-details/${encodeURIComponent(levelId)}`, {
          signal: AbortSignal.timeout(20000),
        });
        if (!levelRes.ok) throw new Error(`Level request failed (${levelRes.status})`);
        const payload = (await levelRes.json()) as { levelInfo?: { data?: RawLevelData } };
        levelData = payload.levelInfo?.data ?? null;
      }
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
      // Each basin gets a spread of temperature/scale around the chosen mode, so
      // the parallel workers explore different neighbourhoods instead of all
      // retreading the same one.
      const BASIN_SPREAD = [
        { dt: 1.8, ds: 1.35 },
        { dt: 1, ds: 1 },
        { dt: 0.55, ds: 0.6 },
        { dt: 0.9, ds: 1.1 },
      ];
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
          const basin = BASIN_SPREAD[i % BASIN_SPREAD.length];
          worker.postMessage({
            type: "start",
            options: {
              seedSymbols,
              levelData,
              arrowName: seedArrow,
              budgetMs,
              t0: t0 * basin.dt,
              scale: scale * basin.ds,
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
            <div className="space-y-1.5">
              <Select
                value={seedArrow || "all"}
                onValueChange={(v) => setSeedArrow(v === "all" ? "" : v)}
              >
                <SelectTrigger
                  className="h-8 text-[11px] bg-white/5 border-white/10"
                  aria-label="Arrow to list seed runs for"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200">
                  <SelectItem value="all" className="text-xs">
                    All arrows
                  </SelectItem>
                  {ARROWS.map((a) => (
                    <SelectItem key={a} value={a} className="text-xs">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={seedId} onValueChange={setSeedId} disabled={!canSeed}>
                <SelectTrigger className="h-9 text-xs bg-white/5 border-white/10">
                  <SelectValue placeholder={canSeed ? "Fastest" : "No runs"} />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-72">
                  {siteEntries.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-[10px] uppercase tracking-widest text-slate-500">
                        Site leaderboard
                      </SelectLabel>
                      <SelectItem value="auto" className="text-xs">
                        Fastest site run
                      </SelectItem>
                      {siteEntries.map((e) => (
                        <SelectItem key={e.id} value={e.id} className="text-xs">
                          {e.username} — {(e.timeMs / 1000).toFixed(3)}s ({e.arrowName})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
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
                        {seedArrow ? `${seedArrow} runs` : "Human runs"}
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
            </div>
          </Field>

          <Field label="Time budget">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  step={5}
                  value={budgetSecs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setBudgetSecs(Number.isFinite(v) ? Math.max(0, v) : 0);
                  }}
                  className="h-9 text-xs bg-white/5 border-white/10 font-mono"
                  aria-label="Search budget in seconds"
                />
                <span className="text-[11px] text-slate-500 shrink-0">sec</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {BUDGET_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBudgetSecs(s)}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                      budgetSecs === s
                        ? "border-[var(--app-accent)]/50 text-[var(--app-accent)]"
                        : "border-white/10 text-slate-500 hover:text-slate-300",
                    )}
                  >
                    {s >= 60 ? `${s / 60}m` : `${s}s`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setBudgetSecs(0)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                    budgetSecs === 0
                      ? "border-[var(--app-accent)]/50 text-[var(--app-accent)]"
                      : "border-white/10 text-slate-500 hover:text-slate-300",
                  )}
                >
                  ∞
                </button>
              </div>
              {budgetSecs === 0 && (
                <p className="text-[10px] text-slate-500">Runs until you press Stop.</p>
              )}
            </div>
          </Field>

          <Field label="Intensity">
            <Select
              value={String(t0)}
              onValueChange={(v) => {
                const preset = INTENSITIES.find((i) => String(i.t0) === v);
                setT0(Number(v));
                if (preset) setScale(preset.scale);
              }}
            >
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
          arrowName={seedEntry?.arrowName ?? siteSeed?.arrowName ?? humanSeed?.arrow_name ?? "Narrow Arrow"}
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
            <Send className="w-3.5 h-3.5 mr-1" /> {isSiteLevel ? "Submit to site board" : "Submit as my TAS"}
          </Button>
          <span className="text-[11px] text-slate-500">
            {isSiteLevel
              ? "Posts the optimized run to this site level's leaderboard under your name."
              : "Posts the optimized run to the level's TAS board under your name."}
          </span>
        </div>
      )}

      {result && (
        <TasSubmitDialog
          open={submitOpen}
          onOpenChange={setSubmitOpen}
          levelId={siteId ?? levelId}
          levelName={levelName || levelId}
          arrowName={seedEntry?.arrowName ?? siteSeed?.arrowName ?? humanSeed?.arrow_name ?? "Narrow Arrow"}
          timeMs={result.timeMs}
          inputs={result.inputs}
          inputCount={result.inputCount}
          kind={isSiteLevel ? "site" : "tas"}
          onSubmitted={() => {
            if (siteId) {
              void fetchSiteScores(siteId)
                .then(setSiteEntries)
                .catch(() => {});
            } else {
              void fetchTasBoard(levelId)
                .then(setEntries)
                .catch(() => {});
            }
          }}
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
