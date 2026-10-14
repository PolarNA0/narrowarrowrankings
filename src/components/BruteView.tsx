import * as React from "react";
import { Cpu, Loader2, Send, Sparkles, Square, Timer, Trophy } from "lucide-react";
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
  arrowConstants,
  levelGeometry,
  type RawLevelData,
  type SimGeometry,
} from "@/lib/replay-sim";
import { arrowKind } from "@/lib/arrow-sprites";
import { ReplayStage } from "@/components/ReplayViewer";
import { TasSubmitDialog } from "@/components/TasSubmitDialog";
import { fetchTasBoard, type TasEntry } from "@/lib/tas-leaderboard";
import { optimizeRun, seedFromInputs, type BruteProgress, type BruteResult } from "@/lib/tas-brute";
import { SIM_TICK_MS } from "@/lib/replay-sim";

const BUDGETS = [
  { label: "15s", ms: 15000 },
  { label: "30s", ms: 30000 },
  { label: "60s", ms: 60000 },
  { label: "2min", ms: 120000 },
];

const fmt = (tick: number | null) =>
  tick === null ? "—" : `${((tick * SIM_TICK_MS) / 1000).toFixed(3)}s`;

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
  const [budgetMs, setBudgetMs] = React.useState(BUDGETS[1].ms);
  const [entries, setEntries] = React.useState<TasEntry[]>([]);
  const [seedId, setSeedId] = React.useState<string>("auto");

  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<BruteProgress | null>(null);
  const [result, setResult] = React.useState<BruteResult | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);

  const stopRef = React.useRef(false);
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

  const seedTimeMs = seedEntry?.timeMs ?? null;

  const start = async () => {
    if (!seedEntry) {
      setError("No TAS run to optimize on this level. Add one from the TAS editor first.");
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

      const seedSymbols = seedFromInputs(seedEntry.inputs, seedEntry.inputCount);
      const out = await optimizeRun({
        seedSymbols,
        levelData,
        arrowName: seedEntry.arrowName,
        budgetMs,
        onProgress: setProgress,
        shouldStop: () => stopRef.current,
      });
      if (!out) {
        setError("The search could not simulate this level.");
        return;
      }
      setResult(out);
      const delta = seedTimeMs !== null ? seedTimeMs - out.timeMs : null;
      setStatus(
        delta !== null && delta > 0
          ? `Found ${(out.timeMs / 1000).toFixed(3)}s — ${(delta / 1000).toFixed(3)}s faster than the seed.`
          : `No improvement found in ${(out.timeMs / 1000).toFixed(3)}s. Try a longer budget.`,
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
          board, then tries tighter holds, brakes and counter-steers to shave the finish time.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Level">
          <Select value={levelId} onValueChange={setLevelId}>
            <SelectTrigger className="h-9 text-xs bg-white/5 border-white/10">
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
        </Field>

        <Field label="Seed run">
          <Select value={seedId} onValueChange={setSeedId} disabled={entries.length === 0}>
            <SelectTrigger className="h-9 text-xs bg-white/5 border-white/10">
              <SelectValue placeholder={entries.length ? "Fastest" : "No TAS runs"} />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1a] border-white/10 text-slate-200 max-h-72">
              <SelectItem value="auto" className="text-xs">
                Fastest on the board
              </SelectItem>
              {entries.map((e) => (
                <SelectItem key={e.id} value={e.id} className="text-xs">
                  {e.username} — {(e.timeMs / 1000).toFixed(3)}s ({e.arrowName})
                </SelectItem>
              ))}
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

        <div className="flex items-end">
          {running ? (
            <Button
              variant="outline"
              className="h-9 w-full text-xs"
              onClick={() => {
                stopRef.current = true;
              }}
            >
              <Square className="w-3.5 h-3.5 mr-1" /> Stop
            </Button>
          ) : (
            <Button
              className="h-9 w-full text-xs"
              onClick={() => void start()}
              disabled={entries.length === 0}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1" /> Optimize
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-white/5 bg-black/30 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <Stat
            label="Seed"
            value={seedEntry ? `${seedEntry.inputCount} ticks` : "—"}
            raw={seedTimeMs !== null ? `${(seedTimeMs / 1000).toFixed(3)}s` : "—"}
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
          arrowName={seedEntry?.arrowName ?? "Narrow Arrow"}
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
          levelName={LEVELS.find((l) => l.id === levelId)?.name ?? levelId}
          arrowName={seedEntry?.arrowName ?? "Narrow Arrow"}
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

  React.useEffect(() => {
    if (!playing) return;
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
  }, [playing, pathLength, speed]);

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
      />
    </div>
  );
}
