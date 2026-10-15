/**
 * A local trajectory optimizer for TAS runs.
 *
 * Given a working run, it searches nearby input sequences for a faster finish
 * using the game's real physics engine. It is the automated version of what the
 * TAS editor does by hand with +/-: nudge a hold, add a brake or a counter-steer
 * before a turn, re-simulate and keep whatever finishes sooner.
 *
 * The search is simulated annealing over the run-length-encoded input stream
 * (segments = runs of one symbol). A single random edit — boundary shift,
 * symbol swap, insert, delete, split, merge — proposes a neighbour; a downhill
 * move is always taken and an uphill one with probability exp(-dE/T), so the
 * search can escape a corner that a greedy descent would jam on. The
 * temperature cools by 0.9997 per accepted step and reheats to 2.0 when it gets
 * too cold, which keeps a long budget productive instead of freezing early.
 * A final 1-tick coordinate-descent polish then squeezes every remaining
 * boundary by ±1 and by insert/delete, which is what turns a good line into a
 * record.
 *
 * The search space (4 symbols per tick, ~3000 ticks) is far too large to brute
 * force, and Energy coupling between corners means a purely local edit can lose
 * overall — which is exactly why the annealer is free to add or remove
 * structural holds, not just shrink existing ones. Every candidate is scored by
 * rolling the whole run out with the engine, so it captures downstream
 * consequences: a corner taken "cheaper" that costs the next straight is
 * correctly judged worse. It cannot prove a run is optimal; it only ever
 * reports a run that finishes sooner.
 */
import {
  createReplayEngine,
  simulateRun,
  type RawLevelData,
  type SimResult,
} from "@/lib/replay-sim";
import { decodeInputSymbols, encodeInputSymbols } from "@/lib/replay";

/** A run-length segment: one input symbol held for `length` consecutive ticks. */
export interface Segment {
  symbol: number;
  length: number;
}

export interface BruteProgress {
  /** Best finish tick found so far (1-based), or null if nothing finishes yet. */
  bestFinishTick: number | null;
  bestTimeMs: number | null;
  /** Finish tick of the seed run, for comparison. */
  seedFinishTick: number | null;
  generations: number;
  evaluations: number;
  /** Best input stream so far, so a Stop can keep it without waiting for `done`. */
  symbols?: number[];
}

export interface BruteResultLite extends BruteProgress {
  symbols: number[];
  inputs: string;
  inputCount: number;
  timeMs: number;
  /** True when the search improved on the seed. */
  improved: boolean;
}

export interface BruteResult extends BruteResultLite {
  /** Full trajectory of the best run, for the viewer. */
  sim: SimResult;
}

export interface BruteOptions {
  /** The starting run to optimize, as decoded 2-bit symbols. */
  seedSymbols: number[];
  levelData: RawLevelData;
  arrowName: string;
  /** Wall-clock budget in milliseconds. */
  budgetMs: number;
  /** Called whenever a new best run is found (throttled). */
  onProgress?: (progress: BruteProgress) => void;
  /** Polled between evaluations; return true to stop early. */
  shouldStop?: () => boolean;
  /** Deterministic seed for the search; defaults to a time-based value. */
  rngSeed?: number;
  /**
   * Annealing start temperature — the "intensity" knob. Low stays near the seed
   * (Focused), high wanders further before settling (Exploratory). Default 6.
   */
  t0?: number;
  /** Run the 1-tick coordinate-descent polish after annealing. Default true. */
  refine?: boolean;
}

const TICK_MS = 1000 / 240;
export const DNF = 1e9;
export const SYMS = [0, 1, 2, 3];

/** A 32-bit LCG — deterministic, so a seed always reproduces the same search. */
export function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function toSegs(flat: number[]): Segment[] {
  const out: Segment[] = [];
  if (flat.length === 0) return [{ symbol: 0, length: 1 }];
  let current = flat[0];
  let length = 0;
  for (const x of flat) {
    if (x === current) length++;
    else {
      out.push({ symbol: current, length });
      current = x;
      length = 1;
    }
  }
  out.push({ symbol: current, length });
  return out;
}

export function expand(segs: Segment[]): number[] {
  const out: number[] = [];
  for (const s of segs) for (let i = 0; i < s.length; i++) out.push(s.symbol);
  return out;
}

/** Drop empty segments and merge neighbours that hold the same symbol. */
export function normalise(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    if (s.length <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.symbol === s.symbol) last.length += s.length;
    else out.push({ symbol: s.symbol, length: s.length });
  }
  return out.length ? out : [{ symbol: 0, length: 1 }];
}

/**
 * One random edit to the segment list: boundary shift, symbol swap, insert,
 * delete, split, merge, length reset, or a "move" that shifts one segment's
 * mass into its neighbour. The mix lets the search discover a brake or a
 * counter-steer that no pure resize could.
 */
export function mutate(segs: Segment[], rnd: () => number): Segment[] {
  const r = (n: number) => Math.floor(rnd() * n);
  const pick = (a: number[]) => a[r(a.length)];
  const s = segs.map((x) => ({ ...x }));
  if (s.length < 2) {
    const m = r(3);
    if (m === 0) s[0].symbol = pick(SYMS.filter((x) => x !== s[0].symbol));
    else if (m === 1) s[0].length = Math.max(1, 1 + r(48));
    else s.push({ symbol: pick(SYMS), length: 1 + r(16) });
    return s;
  }
  const m = r(8);
  const b = 1 + r(s.length - 1);
  if (m === 0) {
    const dl = (r(2) ? 1 : -1) * (1 + r(16));
    if (dl > 0) {
      if (s[b].length > dl) {
        s[b - 1].length += dl;
        s[b].length -= dl;
      }
    } else {
      const dd = -dl;
      if (s[b - 1].length > dd) {
        s[b - 1].length -= dd;
        s[b].length += dd;
      }
    }
  } else if (m === 1) {
    const i = r(s.length);
    s[i].symbol = pick(SYMS.filter((x) => x !== s[i].symbol));
  } else if (m === 2) {
    s.splice(1 + r(s.length), 0, { symbol: pick(SYMS), length: 1 + r(16) });
  } else if (m === 3) {
    s.splice(r(s.length), 1);
  } else if (m === 4) {
    const i = r(s.length);
    if (s[i].length > 1) {
      const cut = 1 + r(s[i].length - 1);
      s.splice(
        i,
        1,
        { symbol: s[i].symbol, length: cut },
        { symbol: pick(SYMS), length: s[i].length - cut },
      );
    }
  } else if (m === 5) {
    const i = r(s.length - 1);
    const sym = pick(SYMS);
    s.splice(i, 2, { symbol: sym, length: s[i].length + s[i + 1].length });
  } else if (m === 6) {
    const i = r(s.length);
    s[i].length = Math.max(1, 1 + r(48));
  } else {
    const i = r(s.length - 1);
    const move = s[i].length;
    s[i].length = 1;
    s[i + 1].length += move - 1;
  }
  return normalise(s);
}

export interface SimFn {
  (flat: number[]): number;
}

export interface SearchHooks {
  onBest?: (flat?: number[]) => void;
  shouldStop?: () => boolean;
}

/** Simulated annealing over the segment list. Returns the best stream found. */
export function anneal(
  sim: SimFn,
  seedFlat: number[],
  rngSeed: number,
  t0: number,
  budgetMs: number,
  hooks: SearchHooks,
): { flat: number[]; best: number; steps: number } {
  const rnd = makeRng(rngSeed);
  let cur = toSegs(seedFlat);
  let curScore = sim(seedFlat);
  let bestFlat = seedFlat.slice();
  let best = curScore;
  let T = t0;
  let steps = 0;
  const start = Date.now();
  let lastReport = 0;
  while (Date.now() - start < budgetMs) {
    if (hooks.shouldStop?.()) break;
    steps++;
    const cand = mutate(cur, rnd);
    const flat = expand(cand);
    const sc = sim(flat);
    const dE = sc - curScore;
    if (dE < 0 || rnd() < Math.exp(-dE / Math.max(0.05, T))) {
      cur = cand;
      curScore = sc;
      if (sc < best) {
        best = sc;
        bestFlat = flat;
        hooks.onBest?.(bestFlat);
      }
    }
    T *= 0.9997;
    // Reheat when too cold so a long budget keeps exploring instead of freezing.
    if (T < 0.15) {
      T = 2.0;
      cur = toSegs(bestFlat);
      curScore = best;
    }
    const now = Date.now();
    if (now - lastReport > 400) {
      lastReport = now;
      hooks.onBest?.();
    }
  }
  return { flat: bestFlat, best, steps };
}

/**
 * 1-tick coordinate-descent polish: nudge each segment boundary by ±1..24 and
 * insert/delete one tick, repeating until no single move improves the finish.
 */
export function refine(
  sim: SimFn,
  seedFlat: number[],
  budgetMs: number,
  hooks: SearchHooks,
  win: [number, number] | null = null,
): { flat: number[]; best: number; passes: number } {
  let flat = seedFlat.slice();
  let best = sim(flat);
  const start = Date.now();
  const outOfTime = () => budgetMs > 0 && Date.now() - start > budgetMs;
  const W0 = win ? win[0] : 0;
  const W1 = win ? win[1] : flat.length;
  const inWindow = (tick: number) => tick >= W0 - 24 && tick <= W1 + 24;
  let improved = true;
  let pass = 0;
  while (improved && pass < 30) {
    if (outOfTime() || hooks.shouldStop?.()) break;
    improved = false;
    pass++;
    const segs = toSegs(flat);
    const starts: number[] = [];
    {
      let off = 0;
      for (const s of segs) {
        starts.push(off);
        off += s.length;
      }
    }
    for (let i = 1; i < segs.length; i++) {
      if (!inWindow(starts[i])) continue;
      for (let d = 1; d <= 24; d++) {
        for (const dir of [1, -1]) {
          if (outOfTime() || hooks.shouldStop?.()) return { flat, best, passes: pass };
          const s2 = segs.map((x) => ({ ...x }));
          const dl = dir * d;
          if (dl > 0) {
            if (s2[i - 1].length <= dl) continue;
            s2[i - 1].length -= dl;
            s2[i].length += dl;
          } else {
            const dd = -dl;
            if (s2[i].length <= dd) continue;
            s2[i].length -= dd;
            s2[i - 1].length += dd;
          }
          const sc = sim(expand(s2));
          if (sc < best) {
            best = sc;
            flat = expand(s2);
            improved = true;
            hooks.onBest?.(flat);
          }
        }
      }
    }
    const segs2 = toSegs(flat);
    let off2 = 0;
    for (let i = 0; i < segs2.length; i++) {
      const b = off2;
      off2 += segs2[i].length;
      if (!inWindow(b)) continue;
      for (const sym of SYMS) {
        if (outOfTime() || hooks.shouldStop?.()) return { flat, best, passes: pass };
        if (sym !== segs2[i].symbol) {
          const a = segs2.map((x) => ({ ...x }));
          a.splice(i, 0, { symbol: sym, length: 1 });
          const sc = sim(expand(a));
          if (sc < best) {
            best = sc;
            flat = expand(a);
            improved = true;
            hooks.onBest?.(flat);
            continue;
          }
        }
        if (segs2[i].length > 1) {
          const c2 = segs2.map((x) => ({ ...x }));
          c2[i].length -= 1;
          const sc = sim(expand(c2));
          if (sc < best) {
            best = sc;
            flat = expand(c2);
            improved = true;
            hooks.onBest?.(flat);
          }
        }
      }
    }
  }
  return { flat, best, passes: pass };
}

/**
 * Search for a faster run near `seedSymbols`: annealing first, then a 1-tick
 * refine of whatever it found. Runs on the calling thread, yielding between
 * phases so the UI can paint progress and a stop request can be honoured.
 *
 * Returns the winning input stream and its score — no trajectory. The caller
 * rebuilds the trajectory once for the single winning run (a `simulateRun`
 * per worker would waste the cores this is meant to use).
 */
export async function optimizeRunLite(options: BruteOptions): Promise<BruteResultLite | null> {
  const { seedSymbols, levelData, arrowName, budgetMs } = options;
  if (seedSymbols.length === 0) return null;

  const engine = await createReplayEngine(levelData, arrowName);
  if (!engine) return null;

  const maxTicks = Math.max(seedSymbols.length + 600, 6000);
  let evaluations = 0;

  // Memoise scores on the flat symbol string — the annealer and the refiner
  // both revisit streams, and a cache turns a re-evaluation into a lookup.
  const cache = new Map<string, number>();
  const sim: SimFn = (flat) => {
    const n = Math.min(flat.length, maxTicks);
    const key = flat.length <= maxTicks ? flat.join("") : flat.slice(0, maxTicks).join("");
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    evaluations++;
    engine.reset();
    let out = DNF;
    for (let i = 0; i < n; i++) {
      const code = engine.stepCode(flat[i]);
      if (code === 1) {
        out = i + 1;
        break;
      }
      if (code === 2) break;
    }
    if (cache.size < 120000) cache.set(key, out);
    return out;
  };

  const seedScore = sim(seedSymbols);
  const seedFinishTick = seedScore < DNF ? seedScore : null;

  let bestFlat = seedSymbols.slice();
  let bestScore = seedScore;
  let steps = 0;
  let lastReport = 0;

  const report = () => {
    const now = Date.now();
    if (now - lastReport < 300) return;
    lastReport = now;
    options.onProgress?.({
      bestFinishTick: bestScore < DNF ? bestScore : null,
      bestTimeMs: bestScore < DNF ? bestScore * TICK_MS : null,
      seedFinishTick,
      generations: steps,
      evaluations,
      symbols: bestFlat,
    });
  };

  const hooks: SearchHooks = {
    onBest: (flat) => {
      if (flat) {
        bestFlat = flat;
        bestScore = sim(flat);
      }
      report();
    },
    shouldStop: options.shouldStop,
  };

  // Anneal for the bulk of the budget, then spend the rest polishing by 1 tick.
  const wantRefine = options.refine !== false;
  const refineBudget = wantRefine ? Math.max(1500, Math.floor(budgetMs * 0.4)) : 0;
  const annealBudget = wantRefine ? Math.max(1000, budgetMs - refineBudget) : budgetMs;

  const annealed = anneal(
    sim,
    seedSymbols,
    options.rngSeed ?? Date.now() & 0x7fffffff,
    options.t0 ?? 6.0,
    annealBudget,
    hooks,
  );
  steps = annealed.steps;
  if (annealed.best < bestScore) {
    bestScore = annealed.best;
    bestFlat = annealed.flat;
  }

  if (wantRefine) {
    await new Promise((resolve) => setTimeout(resolve, 0));

    const polished = refine(sim, bestFlat, refineBudget, hooks);
    if (polished.best < bestScore) {
      bestScore = polished.best;
      bestFlat = polished.flat;
    }
  }

  if (bestScore >= DNF) {
    // Nothing finished; keep the seed if it at least finished, else fail.
    if (seedFinishTick === null) return null;
    bestFlat = seedSymbols.slice();
    bestScore = seedFinishTick;
  }

  options.onProgress?.({
    bestFinishTick: bestScore < DNF ? bestScore : null,
    bestTimeMs: bestScore < DNF ? bestScore * TICK_MS : null,
    seedFinishTick,
    generations: steps,
    evaluations,
    symbols: bestFlat,
  });

  const symbols = bestFlat;

  return {
    symbols,
    inputs: encodeInputSymbols(symbols),
    inputCount: symbols.length,
    timeMs: Math.round(bestScore * TICK_MS),
    improved: seedFinishTick === null || bestScore < seedFinishTick,
    bestFinishTick: bestScore < DNF ? bestScore : null,
    bestTimeMs: bestScore < DNF ? bestScore * TICK_MS : null,
    seedFinishTick,
    generations: steps,
    evaluations,
  };
}

/**
 * `optimizeRunLite` plus the winning run's trajectory, for a caller that wants a
 * single self-contained result (e.g. one worker). The parallel driver calls
 * `optimizeRunLite` directly so it simulates the winner exactly once.
 */
export async function optimizeRun(options: BruteOptions): Promise<BruteResult | null> {
  const lite = await optimizeRunLite(options);
  if (!lite) return null;
  const sim: SimResult = await simulateRun(
    lite.inputs,
    lite.inputCount,
    options.levelData,
    {},
    options.arrowName,
  );
  return { ...lite, sim };
}

/** Decode a run's stored input string into the symbols the optimizer consumes. */
export function seedFromInputs(inputs: string, inputCount?: number): number[] {
  return decodeInputSymbols(inputs, inputCount);
}
