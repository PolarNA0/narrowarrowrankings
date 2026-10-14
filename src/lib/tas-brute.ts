/**
 * A local trajectory optimizer for TAS runs.
 *
 * Given a working run, it searches nearby input sequences for a faster finish
 * using the real physics engine. It is the automated version of what the TAS
 * editor does by hand with +/-: nudge a hold, add a brake or a counter-steer
 * before a turn, re-simulate and keep whatever finishes sooner.
 *
 * The search space (4 symbols per tick, ~3000 ticks) is far too large to brute
 * force, so this is a genetic search over run-length *segments* rather than
 * ticks. A genome is a list of `{ symbol, length }` holds; mutations resize,
 * split, merge, insert (brake / counter-steer / neutral), delete and duplicate
 * holds, and crossover splices a prefix of one run onto a suffix of another.
 * Fitness rolls the whole run out with the engine and scores the finish tick,
 * so it captures downstream consequences — a corner taken "cheaper" that costs
 * the next straight is correctly judged worse.
 *
 * It cannot prove a run is optimal; it only ever reports a run that finishes
 * sooner. Energy coupling between corners means a purely local edit can lose
 * overall, which is exactly why the search must be free to add or remove
 * structural holds, not just shrink existing ones.
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
}

export interface BruteResult extends BruteProgress {
  symbols: number[];
  inputs: string;
  inputCount: number;
  timeMs: number;
  /** Full trajectory of the best run, for the viewer. */
  sim: SimResult;
  /** True when the search improved on the seed. */
  improved: boolean;
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
  /** Polled between generations; return true to stop early. */
  shouldStop?: () => boolean;
  /** Deterministic seed for the search; defaults to a time-based value. */
  rngSeed?: number;
  /** Population size. Larger searches more per generation but yields slower. */
  population?: number;
}

const TICK_MS = 1000 / 240;
const DNF = Number.POSITIVE_INFINITY;
const SYMBOLS = [0, 1, 2, 3];
/** Opposite steer symbol, used to build a counter-steer proposal. */
const OPPOSITE: Record<number, number> = { 0: 3, 1: 2, 2: 1, 3: 0 };

function toSegments(symbols: number[]): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let current = symbols[0];
  for (let i = 1; i <= symbols.length; i++) {
    if (i === symbols.length || symbols[i] !== current) {
      segments.push({ symbol: current, length: i - start });
      start = i;
      current = symbols[i];
    }
  }
  return segments;
}

function toSymbols(segments: Segment[]): number[] {
  const out: number[] = [];
  for (const s of segments) for (let i = 0; i < s.length; i++) out.push(s.symbol);
  return out;
}

/** Drop empty segments and merge neighbours that hold the same symbol. */
function normalise(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    if (s.length <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.symbol === s.symbol) last.length += s.length;
    else out.push({ symbol: s.symbol, length: s.length });
  }
  return out.length ? out : [{ symbol: 0, length: 1 }];
}

const clone = (segments: Segment[]): Segment[] => segments.map((s) => ({ ...s }));

/** A small deterministic PRNG (xorshift32) so runs are reproducible. */
function makeRng(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state = state >>> 0;
    return state / 4294967296;
  };
}

/**
 * Propose a neighbour of a genome. The move mix is deliberate: the resize and
 * replace moves explore tightness, while the insert/dup moves let the search
 * discover a brake or a counter-steer before a turn that no resize could.
 */
function mutate(genome: Segment[], rng: () => number): Segment[] {
  const g = clone(genome);
  const ri = (n: number) => Math.floor(rng() * n);
  const k = ri(11);
  const i = ri(g.length);

  if (k === 0) g[i].length = Math.max(1, g[i].length + (ri(41) - 20));
  else if (k === 1) g[i].symbol = SYMBOLS[ri(4)];
  else if (k === 2) g.splice(i, 0, { symbol: SYMBOLS[ri(4)], length: 1 + ri(80) });
  else if (k === 3) {
    if (g.length > 2) g.splice(i, 1);
  } else if (k === 4) {
    if (g[i].length > 2) {
      const a = 1 + ri(g[i].length - 1);
      g.splice(
        i,
        1,
        { symbol: g[i].symbol, length: a },
        { symbol: SYMBOLS[ri(4)], length: g[i].length - a },
      );
    }
  } else if (k === 5) {
    const j = i + 1;
    if (j < g.length) {
      g[i] = { symbol: g[i].symbol, length: g[i].length + g[j].length };
      g.splice(j, 1);
    }
  } else if (k === 6) {
    // Counter-steer before the segment at i.
    const next = g[Math.min(i + 1, g.length - 1)];
    g.splice(i, 0, { symbol: OPPOSITE[next.symbol], length: 1 + ri(50) });
  } else if (k === 7) {
    // Brake pre-roll.
    g.splice(i, 0, { symbol: 3, length: 1 + ri(60) });
  } else if (k === 8) {
    // Brake, then steer — the classic "settle then turn" setup.
    const a = 1 + ri(40);
    const b = 1 + ri(60);
    const sym = g[i].symbol === 3 ? 1 : g[i].symbol;
    g.splice(i, 1, { symbol: 3, length: a }, { symbol: sym, length: b });
  } else if (k === 9) {
    const len = 1 + ri(8);
    const sym = SYMBOLS[ri(4)];
    for (let j = 0; j < len && i + j < g.length; j++) g[i + j].symbol = sym;
  } else {
    const len = 1 + ri(3);
    const block = g.slice(i, i + len).map((s) => ({ ...s }));
    const j = ri(g.length);
    g.splice(j, 0, ...block);
  }
  return normalise(g);
}

/** Splice a prefix of `a` onto a suffix of `b`, cut at random tick boundaries. */
function crossover(a: Segment[], b: Segment[], rng: () => number): Segment[] {
  const ri = (n: number) => Math.floor(rng() * n);
  const totalA = a.reduce((s, x) => s + x.length, 0);
  const totalB = b.reduce((s, x) => s + x.length, 0);
  const cutA = 1 + ri(Math.max(1, totalA - 1));
  const cutB = 1 + ri(Math.max(1, totalB - 1));

  const prefix: Segment[] = [];
  let acc = 0;
  for (const s of a) {
    const remain = cutA - acc;
    if (remain <= 0) break;
    prefix.push({ symbol: s.symbol, length: Math.min(s.length, remain) });
    acc += s.length;
  }
  const suffix: Segment[] = [];
  acc = 0;
  for (const s of b) {
    const remain = cutB - acc;
    if (remain <= 0) suffix.push({ ...s });
    else if (s.length > remain) suffix.push({ symbol: s.symbol, length: s.length - remain });
    acc += s.length;
  }
  return normalise([...prefix, ...suffix]);
}

/** Greedy per-segment length descent to polish a genome. */
function localSearch(
  genome: Segment[],
  fitness: (g: Segment[]) => number,
  passes: number,
): { genome: Segment[]; fitness: number } {
  let best = clone(genome);
  let bestFit = fitness(best);
  for (let p = 0; p < passes; p++) {
    let improved = false;
    for (let i = 0; i < best.length; i++) {
      for (const d of [-4, -2, -1, 1, 2, 4]) {
        const g = clone(best);
        g[i].length = Math.max(1, g[i].length + d);
        const f = fitness(normalise(g));
        if (f < bestFit) {
          best = normalise(g);
          bestFit = f;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { genome: best, fitness: bestFit };
}

/**
 * Search for a faster run near `seedSymbols`. Runs on the calling thread in
 * chunks, yielding between generations so the UI can paint progress and a stop
 * request can be honoured.
 */
export async function optimizeRun(options: BruteOptions): Promise<BruteResult | null> {
  const { seedSymbols, levelData, arrowName, budgetMs } = options;
  if (seedSymbols.length === 0) return null;

  const engine = await createReplayEngine(levelData, arrowName);
  if (!engine) return null;

  const maxTicks = Math.max(seedSymbols.length * 2, 6000);
  let evaluations = 0;

  // Roll a whole run out from the spawn and return its finish tick, or DNF.
  const rollout = (symbols: number[]): number => {
    evaluations++;
    engine.reset();
    const n = Math.min(symbols.length, maxTicks);
    for (let i = 0; i < n; i++) {
      const code = engine.stepCode(symbols[i]);
      if (code === 1) return i + 1;
      if (code === 2) return DNF;
    }
    return DNF;
  };

  // Fitness is memoised on the symbol string: crossover and local search both
  // revisit genomes, and a cache turns a re-evaluation into a map lookup.
  const cache = new Map<string, number>();
  const fitness = (genome: Segment[]): number => {
    const symbols = toSymbols(genome);
    const key = symbols.join("");
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = rollout(symbols);
    if (cache.size < 60000) cache.set(key, value);
    return value;
  };

  const seedGenome = toSegments(seedSymbols);
  const seedFinishTick = await (async () => {
    const f = fitness(seedGenome);
    return Number.isFinite(f) ? f : null;
  })();

  const rng = makeRng(options.rngSeed ?? Date.now() & 0x7fffffff);
  const popSize = options.population ?? 60;
  const elite = Math.max(2, Math.floor(popSize / 9));

  let population: Segment[][] = [clone(seedGenome)];
  while (population.length < popSize)
    population.push(mutate(population[Math.floor(rng() * population.length)], rng));
  let scores = population.map(fitness);

  let bestGenome = clone(population[0]);
  let bestFit = scores[0];
  for (let i = 1; i < population.length; i++)
    if (scores[i] < bestFit) {
      bestFit = scores[i];
      bestGenome = clone(population[i]);
    }

  const started = Date.now();
  let generations = 0;
  let lastReport = 0;
  const report = () => {
    const now = Date.now();
    if (now - lastReport < 250) return;
    lastReport = now;
    options.onProgress?.({
      bestFinishTick: Number.isFinite(bestFit) ? bestFit : null,
      bestTimeMs: Number.isFinite(bestFit) ? bestFit * TICK_MS : null,
      seedFinishTick,
      generations,
      evaluations,
    });
  };

  while (Date.now() - started < budgetMs) {
    if (options.shouldStop?.()) break;
    generations++;

    const children: Segment[][] = [];
    while (children.length < popSize - elite) {
      if (rng() < 0.35)
        children.push(
          crossover(
            population[Math.floor(rng() * elite)],
            population[Math.floor(rng() * popSize)],
            rng,
          ),
        );
      else children.push(mutate(population[Math.floor(rng() * elite)], rng));
    }
    const childScores = children.map(fitness);

    const combined = [
      ...population.map((g, i) => ({ g, f: scores[i] })),
      ...children.map((g, i) => ({ g, f: childScores[i] })),
    ].sort((a, b) => a.f - b.f);
    population = combined.slice(0, popSize).map((x) => x.g);
    scores = combined.slice(0, popSize).map((x) => x.f);

    if (scores[0] < bestFit) {
      bestFit = scores[0];
      bestGenome = clone(population[0]);
    }

    if (generations % 40 === 0) {
      const ls = localSearch(bestGenome, fitness, 3);
      if (ls.fitness < bestFit) {
        bestFit = ls.fitness;
        bestGenome = ls.genome;
        population[0] = clone(ls.genome);
        scores[0] = ls.fitness;
      }
    }

    report();
    // Yield so React can render progress and a Stop press can be observed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (!Number.isFinite(bestFit)) {
    // Nothing finished; keep the seed if it at least finished, else fail.
    if (seedFinishTick === null) return null;
    bestGenome = clone(seedGenome);
    bestFit = seedFinishTick;
  }

  options.onProgress?.({
    bestFinishTick: Number.isFinite(bestFit) ? bestFit : null,
    bestTimeMs: Number.isFinite(bestFit) ? bestFit * TICK_MS : null,
    seedFinishTick,
    generations,
    evaluations,
  });

  const symbols = toSymbols(bestGenome);

  // Re-simulate the winning run to record the trajectory for the viewer.
  const sim: SimResult = await simulateRun(
    encodeInputSymbols(symbols),
    symbols.length,
    levelData,
    {},
    arrowName,
  );

  return {
    symbols,
    inputs: encodeInputSymbols(symbols),
    inputCount: symbols.length,
    timeMs: Math.round(bestFit * TICK_MS),
    sim,
    improved: seedFinishTick === null || bestFit < seedFinishTick,
    bestFinishTick: Number.isFinite(bestFit) ? bestFit : null,
    bestTimeMs: Number.isFinite(bestFit) ? bestFit * TICK_MS : null,
    seedFinishTick,
    generations,
    evaluations,
  };
}

/** Decode a run's stored input string into the symbols the optimizer consumes. */
export function seedFromInputs(inputs: string, inputCount?: number): number[] {
  return decodeInputSymbols(inputs, inputCount);
}
