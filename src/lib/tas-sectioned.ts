/**
 * Sectioned optimizer for TAS runs.
 *
 * The whole-run annealer in `tas-brute.ts` scores a candidate by replaying it
 * end to end, so a change to tick 40 is only "good" once the run still finishes
 * thousands of ticks later — the finish is the only signal, and it is far away.
 * This searches one *section* at a time instead: the run is cut at boundaries,
 * and each section is optimized against a gate at its end, with the state at
 * the section's start held fixed. The gate gives every candidate an immediate,
 * local score, so a section can be improved even when the whole-run finish is
 * out of reach, and the winner is locked in before the next section is searched.
 *
 * Round over round the boundaries rotate, so a boundary that lands mid-corner
 * (where neither side can improve alone) is tried elsewhere. A round that
 * improves the finish becomes the new baseline and the next round starts from
 * it, so gains compound. When a section cannot reach its gate the round is
 * abandoned and the next round drops the hard gates for soft waypoint guides,
 * which the search can approach gradually instead of having to cross.
 *
 * Every section search reuses the same simulated-annealing core as the
 * whole-run search (see `tas-brute.ts`), so the two share a mutation set and a
 * reheat schedule; only the score and the search window differ.
 */
import { createReplayEngine, type RawLevelData, type ReplayEngine } from "@/lib/replay-sim";
import { decodeInputSymbols, encodeInputSymbols } from "@/lib/replay";
import { anneal, refine, scoreEval, type SearchHooks, type SimFn } from "@/lib/tas-brute";

const TICK_MS = 1000 / 240;
/** Cost of a section that never reaches its gate; a gate cross always beats it. */
const MISS = 1e6;

/** A route guide the user drew. The search is rewarded for passing them in order. */
export interface Waypoint {
  x: number;
  y: number;
}

/** Per-worker search personality, mirroring the competitor's tuning knobs. */
export interface SearchTuning {
  /** Multiplies the annealing temperature. */
  explore: number;
  /** Multiplies the reheat floor. */
  reheat: number;
  /** How many mutations the annealer applies per step (basin jumps). */
  bold: number;
  /** Micro-input reward weight (0..1): trades time for choppier, cleaner input. */
  micro: number;
  /** Divergence reward weight (0..1): pays to stay off the baseline. */
  divergence: number;
}

export const DEFAULT_TUNING: SearchTuning = {
  explore: 1,
  reheat: 1,
  bold: 1,
  micro: 0,
  divergence: 0,
};

/** A search personality preset. The parallel workers each get one. */
export const TUNING_ARMS: SearchTuning[] = [
  { explore: 1, reheat: 1, bold: 1, micro: 0, divergence: 0 },
  { explore: 1.7, reheat: 0.5, bold: 2, micro: 0, divergence: 0.5 },
  { explore: 0.55, reheat: 1.5, bold: 1, micro: 0.6, divergence: 0 },
  { explore: 1.2, reheat: 0.8, bold: 1, micro: 0.3, divergence: 1 },
];

export interface SectionedOptions {
  seedSymbols: number[];
  levelData: RawLevelData;
  arrowName: string;
  budgetMs: number;
  onProgress?: (p: SectionedProgress) => void;
  shouldStop?: () => boolean;
  rngSeed?: number;
  /** Target number of sections; `auto` picks from the run length. */
  sections?: number | "auto";
  /** Route guides: the search is rewarded for passing them in order. */
  waypoints?: Waypoint[];
  tuning?: SearchTuning;
  /** Momentum: weight on the section's exit speed vs raw crossing tick. */
  momentum?: number;
  /** Ticks of credit per waypoint passed. */
  wpBonus?: number;
}

export interface SectionedProgress {
  bestFinishTick: number | null;
  bestTimeMs: number | null;
  seedFinishTick: number | null;
  round: number;
  sections: number;
  evaluations: number;
  symbols?: number[];
  log?: string;
}

export interface SectionedResult {
  symbols: number[];
  inputs: string;
  inputCount: number;
  timeMs: number;
  improved: boolean;
  bestFinishTick: number | null;
  bestTimeMs: number | null;
  seedFinishTick: number | null;
  rounds: number;
  evaluations: number;
}

/** One section of the run: the ticks it covers and the gate at its end. */
interface Section {
  startTick: number;
  /** Tick the gate sits at, or null for the final section (finish is the gate). */
  gateTick: number | null;
  startSnap: string | null;
}

/** A gate the search must cross: a point, a heading, and a radius/slab. */
interface Gate {
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
  disc: boolean;
}

/**
 * Section boundaries for a run of `ticks`. `auto` picks roughly one section per
 * 480 ticks (2s of run), clamped so short runs still split and long runs do not
 * fragment. `offset` rotates the boundaries round over round so a boundary that
 * landed mid-corner is retried elsewhere. Mirrors the competitor's `bf`.
 */
export function sectionBoundaries(ticks: number, sections: number | "auto", offset = 0): number[] {
  const count =
    sections === "auto"
      ? Math.max(2, Math.min(14, Math.round(ticks / 480)))
      : Math.max(1, Math.round(sections));
  const out: number[] = [];
  for (let i = 1; i < count; i++) {
    const b = Math.round(((i + offset) * ticks) / count);
    if (b > 60 && b < ticks - 60 && !out.includes(b)) out.push(b);
  }
  return out;
}

/**
 * The gate a section is scored against: the baseline pose at the boundary tick,
 * with the heading taken from the velocity there (or, for a waypoint gate, from
 * the waypoint toward the next one). A plain gate is a slab the arrow must cross
 * heading forward; a waypoint gate is a disc it must touch.
 */
function buildGate(
  pts: number[],
  at: number,
  next: number,
  wp: Waypoint | null,
  nextWp: Waypoint | null,
): Gate {
  const x = pts[at * 4] ?? 0;
  const y = pts[at * 4 + 1] ?? 0;
  const vx = pts[at * 4 + 2] ?? 0;
  const vy = pts[at * 4 + 3] ?? 0;
  const speed = Math.max(0.05, Math.hypot(vx, vy));
  let dx = vx / speed;
  let dy = vy / speed;
  if (wp) {
    const target = nextWp ?? { x: pts[next * 4] ?? 0, y: pts[next * 4 + 1] ?? 0 };
    const d = Math.hypot(target.x - wp.x, target.y - wp.y);
    if (d > 1) {
      dx = (target.x - wp.x) / d;
      dy = (target.y - wp.y) / d;
    }
    return { x: wp.x, y: wp.y, dx, dy, r: 40, disc: true };
  }
  return { x, y, dx, dy, r: 40, disc: false };
}

/**
 * The section search's scoring loop. It plays a candidate from the section's
 * start snapshot, sampling the arrow's pose only as often as it must (skipping
 * ahead by the ticks it cannot reach the gate in), and returns a cost where a
 * gate cross always beats a miss. Waypoint credit and the micro/divergence
 * rewards steer the search; the crossing tick stays the true simulated value.
 */
class SectionSim {
  private engine: ReplayEngine;
  private ref: number[];
  private maxTicks: number;
  private stride = 48;
  private cps: { at: number; snap: string; wp: number; dmin: number }[] = [];
  private cache = new Map<string, number>();
  private startSnap: string | null;
  private gate: Gate | null;
  private slab: number;
  private vmax: number;
  private minTicks: number;
  private D: number;
  private baseSpeed: number;
  private mw: number;
  private micro: number;
  private div: number;
  private bpath: number[] | null;
  private waypoints: Waypoint[];
  private wpRadius: number;
  private wpReach: number;
  private wpBonus: number;
  /** Cursor of waypoints passed, and the closest approach to the next pending one. */
  private wp = 0;
  private dmin = Infinity;
  evaluations = 0;

  constructor(engine: ReplayEngine, startSnap: string | null, ref: number[], job: SectionJob) {
    this.engine = engine;
    this.startSnap = startSnap;
    this.ref = ref.slice(0, job.maxTicks);
    this.maxTicks = job.maxTicks;
    this.gate = job.gate;
    this.slab = job.slab;
    this.vmax = job.vmax;
    this.minTicks = job.minTicks;
    this.D = job.D;
    this.baseSpeed = job.baseSpeed;
    this.mw = job.mw;
    this.micro = job.micro;
    this.div = job.div;
    this.bpath = job.bpath;
    this.waypoints = job.waypoints ?? [];
    this.wpRadius = job.wpRadius;
    this.wpReach = job.wpReach;
    this.wpBonus = job.wpBonus;
    this.rebuild();
  }

  private begin(): void {
    this.wp = 0;
    this.dmin = Infinity;
    if (this.startSnap) this.engine.restoreQuiet(this.startSnap);
    else this.engine.resetQuiet();
  }

  /** Credit the next waypoints within `wpRadius`, in order; track approach. */
  private advanceWaypoints(p: { x: number; y: number }): void {
    while (this.wp < this.waypoints.length) {
      const w = this.waypoints[this.wp];
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d > this.wpRadius) {
        if (d < this.dmin) this.dmin = d;
        break;
      }
      this.wp++;
      this.dmin = Infinity;
    }
  }

  /** Ticks that cannot reach the next waypoint, so the pose need not be read. */
  private wpSkip(p: { x: number; y: number }): number {
    if (this.wp >= this.waypoints.length) return Infinity;
    const w = this.waypoints[this.wp];
    const v = this.vmax > 0 ? this.vmax : 1;
    return Math.floor(Math.max(Math.hypot(p.x - w.x, p.y - w.y) - this.wpRadius, 0) / v);
  }

  /** Ticks that cannot reach the gate. */
  private gateSkip(p: { x: number; y: number }): number {
    if (!this.gate) return Infinity;
    const g = this.gate;
    const rx = p.x - g.x;
    const ry = p.y - g.y;
    const dist = Math.hypot(rx, ry);
    const v = this.vmax > 0 ? this.vmax : 1;
    if (g.disc) return Math.floor(Math.max(dist - g.r, 0) / v);
    const along = rx * g.dx + ry * g.dy;
    return Math.floor(Math.max(dist - g.r - this.slab, along < 0 ? -along : 0) / v);
  }

  /** Waypoint credit so far: a full bonus per pass, plus an approach gradient. */
  private wpCredit(): number {
    const pass = this.wp * this.wpBonus;
    if (!this.waypoints.length || this.wp >= this.waypoints.length) return pass;
    const short = Number.isFinite(this.dmin) ? this.dmin - this.wpRadius : this.wpReach;
    if (short >= this.wpReach) return pass;
    return pass + 0.5 * this.wpBonus * (1 - Math.max(short, 0) / this.wpReach);
  }

  /** Whether a pose read crosses the gate, heading forward. */
  private gateHit(p: { x: number; y: number; vx: number; vy: number }, t1: number): boolean {
    const g = this.gate;
    if (!g) return false;
    const rx = p.x - g.x;
    const ry = p.y - g.y;
    const heading = p.vx * g.dx + p.vy * g.dy;
    const speed = Math.hypot(p.vx, p.vy);
    if (g.disc) return Math.hypot(rx, ry) <= g.r && heading >= 0.5 * speed && t1 >= this.minTicks;
    const along = rx * g.dx + ry * g.dy;
    const lat = Math.abs(-rx * g.dy + ry * g.dx);
    return (
      along >= 0 &&
      along <= this.slab &&
      lat <= g.r &&
      heading >= 0.85 * speed &&
      t1 >= this.minTicks
    );
  }

  private miss(t: number): SectionEval {
    const bonus = this.wpCredit();
    if (!this.gate) return { score: MISS + 1e4 - t * 0.5 - bonus, cross: -1 };
    const p = this.engine.pose();
    const g = this.gate;
    const rx = p.x - g.x;
    const ry = p.y - g.y;
    const dist = Math.hypot(rx, ry);
    if (g.disc) return { score: MISS + Math.max(0, dist - g.r) - t * 0.01 - bonus, cross: -1 };
    const along = rx * g.dx + ry * g.dy;
    const lat = Math.abs(-rx * g.dy + ry * g.dx);
    return {
      score: MISS + Math.max(0, -along) + Math.max(0, lat - g.r) - t * 0.01 - bonus,
      cross: -1,
    };
  }

  private microReward(syms: number[], upto: number): number {
    if (!this.micro || upto < 2) return 0;
    let changes = 0;
    for (let i = 1; i < upto; i++) if (syms[i] !== syms[i - 1]) changes++;
    return this.micro * 8 * changes;
  }

  /** Play `syms` from tick `a` (engine already positioned), scoring the gate. */
  private run(syms: number[], a: number): SectionEval {
    const n = Math.min(syms.length, this.maxTicks);
    const g = this.gate;
    const div = this.div;
    const bp = this.bpath;
    let sepSum = 0;
    let sepN = 0;
    const tracking = !!(g || this.waypoints.length || div);
    let next = a;
    for (let t = a; t < n; t++) {
      const c = this.engine.stepCode(syms[t]);
      if (c === 2) return this.miss(t + 1);
      if (c === 1) {
        const bonus = this.wpCredit();
        const micro = this.microReward(syms, t + 1);
        if (!g) return { score: t + 1 - micro - bonus, cross: t + 1, finished: true };
        return { score: t + 1 - 400 - bonus - micro, cross: t + 1, finished: true };
      }
      if (tracking && t + 1 >= next) {
        const p = this.engine.pose();
        this.advanceWaypoints(p);
        if (div && bp) {
          const i = Math.min(t + 1, bp.length / 2 - 1) * 2;
          sepSum += Math.hypot(p.x - bp[i], p.y - bp[i + 1]);
          sepN++;
        }
        const divBonus = div && sepN ? div * Math.min(sepSum / sepN, 120) * 0.25 : 0;
        if (g) {
          if (this.gateHit(p, t + 1)) {
            const v = Math.max(0.05, p.vx * g.dx + p.vy * g.dy);
            const bonus = this.wpCredit();
            const micro = this.microReward(syms, t + 1);
            const score =
              t +
              1 -
              bonus -
              divBonus -
              micro +
              Math.min(this.D / v, this.D / 0.05) * this.mw +
              (1 - this.mw) * (this.D / this.baseSpeed);
            return { score, cross: t + 1, speed: v, divBonus };
          }
          next = t + 1 + Math.max(1, Math.min(64, Math.min(this.gateSkip(p), this.wpSkip(p))));
        } else {
          next = t + 1 + Math.max(1, Math.min(64, this.wpSkip(p)));
        }
      }
    }
    return this.miss(n);
  }

  private rebuild(from = 0, snap: string | null = null, wp = 0): void {
    if (from === 0) {
      this.cps = [];
      this.begin();
    } else {
      this.engine.restoreQuiet(snap!);
      this.wp = wp;
      this.dmin = Infinity;
    }
    const g = this.gate;
    const tracking = !!(g || this.waypoints.length);
    const n = this.ref.length;
    let next = from;
    for (let t = from; t < n; t++) {
      if (t > 0 && t % this.stride === 0 && this.cps[this.cps.length - 1]?.at !== t) {
        this.cps.push({ at: t, snap: this.engine.snapshot(), wp: this.wp, dmin: this.dmin });
      }
      if (this.engine.stepCode(this.ref[t]) !== 0) break;
      if (tracking && t + 1 >= next) {
        const p = this.engine.pose();
        this.advanceWaypoints(p);
        if (g) {
          if (this.gateHit(p, t + 1)) break;
          next = t + 1 + Math.max(1, Math.min(64, Math.min(this.gateSkip(p), this.wpSkip(p))));
        } else {
          next = t + 1 + Math.max(1, Math.min(64, this.wpSkip(p)));
        }
      }
    }
  }

  setRef(flat: number[]): void {
    const lim = Math.min(flat.length, this.maxTicks, this.ref.length);
    let k = 0;
    while (k < lim && this.ref[k] === flat[k]) k++;
    this.ref = flat.slice(0, this.maxTicks);
    this.cps = this.cps.filter((c) => c.at <= k);
    const last = this.cps[this.cps.length - 1];
    this.rebuild(last ? last.at : 0, last ? last.snap : null, last ? last.wp : 0);
    if (last) this.dmin = last.dmin ?? Infinity;
  }

  private deepest(flat: number[]): number {
    const n = Math.min(flat.length, this.ref.length);
    let k = 0;
    while (k < n && flat[k] === this.ref[k]) k++;
    let idx = -1;
    for (let i = 0; i < this.cps.length && this.cps[i].at <= k; i++) idx = i;
    return idx;
  }

  /** The {@link SimFn} the annealer consumes: score a candidate stream. */
  sim: SimFn = (flat) => {
    const key =
      flat.length <= this.maxTicks ? flat.join("") : flat.slice(0, this.maxTicks).join("");
    const hit = this.cache.get(key);
    if (hit !== undefined) return { ticks: null, code: 0, minDist: null, fromTick: 0, score: hit };
    this.evaluations++;
    const i = this.deepest(flat);
    let a = 0;
    if (i >= 0) {
      try {
        this.engine.restoreQuiet(this.cps[i].snap);
        a = this.cps[i].at;
        this.wp = this.cps[i].wp;
        this.dmin = this.cps[i].dmin ?? Infinity;
      } catch {
        this.begin();
        a = 0;
      }
    } else this.begin();
    const r = this.run(flat, a);
    if (this.cache.size < 120000) this.cache.set(key, r.score);
    return { ticks: null, code: 0, minDist: null, fromTick: a, score: r.score };
  };

  /** Exact evaluation from the section start, plus the snapshot at the crossing. */
  exact(flat: number[]): (SectionEval & { snap: string | null }) | null {
    this.begin();
    const r = this.run(flat, 0);
    if (r.cross < 0) return null;
    return { ...r, snap: r.finished ? null : this.engine.snapshot() };
  }
}

interface SectionJob {
  maxTicks: number;
  gate: Gate | null;
  slab: number;
  vmax: number;
  minTicks: number;
  D: number;
  baseSpeed: number;
  mw: number;
  micro: number;
  div: number;
  bpath: number[] | null;
  waypoints: Waypoint[];
  wpRadius: number;
  wpReach: number;
  wpBonus: number;
  bold: number;
}

interface SectionEval {
  score: number;
  cross: number;
  speed?: number;
  finished?: boolean;
  divBonus?: number;
}

/** One candidate line a section search produced, ranked for the orchestrator. */
interface Candidate {
  syms: number[];
  cross: number;
  score: number;
  rank: number;
  snap: string | null;
  finished: boolean;
}

/** Full trajectory of a run as a flat [x,y,vx,vy,...] list plus the finish tick. */
async function traceRun(
  engine: ReplayEngine,
  syms: number[],
): Promise<{ pts: number[]; finish: number | null }> {
  engine.resetQuiet();
  const pts: number[] = [];
  const p0 = engine.pose();
  pts.push(p0.x, p0.y, p0.vx, p0.vy);
  let finish: number | null = null;
  for (let t = 0; t < syms.length; t++) {
    const c = engine.stepCode(syms[t]);
    const p = engine.pose();
    pts.push(p.x, p.y, p.vx, p.vy);
    if (c === 1) {
      finish = t + 1;
      break;
    }
    if (c === 2) break;
  }
  return { pts, finish };
}

/** Waypoints a traced path passes in order, advancing a cursor on each pass. */
export function passedInOrder(pts: number[], waypoints: Waypoint[], radius = 40): number {
  if (!waypoints.length) return 0;
  const ticks = Math.floor(pts.length / 4) - 1;
  let cursor = 0;
  for (let t = 0; t <= ticks && cursor < waypoints.length; t++) {
    const x = pts[t * 4];
    const y = pts[t * 4 + 1];
    while (cursor < waypoints.length) {
      const w = waypoints[cursor];
      if (Math.hypot(x - w.x, y - w.y) > radius) break;
      cursor++;
    }
  }
  return cursor;
}

/**
 * Search one section: several candidate lines that cross the gate, ranked. Runs
 * on the section's own snapshot, so the caller can stitch the winners and verify
 * the stitched run once.
 */
async function searchSection(
  engine: ReplayEngine,
  sec: Section,
  seed: number[],
  job: SectionJob,
  budgetMs: number,
  rngSeed: number,
  hooks: SearchHooks,
): Promise<{ candidates: Candidate[]; evaluations: number }> {
  const sim = new SectionSim(engine, sec.startSnap, seed, job);
  const top: { flat: number[]; score: number }[] = [];
  const pushTop = (flat: number[], score: number) => {
    if (score >= MISS) return;
    const k = flat.join("");
    if (top.some((t) => t.flat.join("") === k)) return;
    top.push({ flat: flat.slice(), score });
    top.sort((a, b) => a.score - b.score);
    if (top.length > 6) top.pop();
  };
  const seedScore = scoreEval(sim.sim(seed));
  pushTop(seed, seedScore);

  const saMs = Math.max(200, Math.floor(budgetMs * 0.7));
  const sa = anneal(sim.sim, seed, rngSeed, 6, saMs, hooks, 1, job.bold);
  pushTop(sa.flat, sa.best);
  if (!hooks.shouldStop?.()) {
    const ref = refine(
      sim.sim,
      top[0]?.flat ?? sa.flat,
      Math.max(150, budgetMs - saMs),
      hooks,
      null,
      16,
    );
    pushTop(ref.flat, ref.best);
  }

  const out: Candidate[] = [];
  for (const t of top) {
    const ex = sim.exact(t.flat);
    if (!ex) continue;
    out.push({
      syms: t.flat.slice(0, ex.cross),
      cross: ex.cross,
      score: ex.score,
      rank: ex.score + (ex.divBonus ?? 0),
      snap: ex.snap,
      finished: !!ex.finished,
    });
  }
  out.sort((a, b) => a.rank - b.rank);
  return { candidates: out, evaluations: sim.evaluations };
}

/** Result of one round: the best stitched line and the section-by-section log. */
interface RoundResult {
  syms: number[];
  finish: number;
  log: string[];
  failed: boolean;
}

/**
 * Optimize a run section by section, round over round.
 *
 * Each round cuts the current baseline at rotating boundaries, searches every
 * section in turn against the gate at its end (holding each section's entry
 * state fixed), stitches the per-section winners and verifies the stitched run
 * end to end. An improving round becomes the new baseline; a round that cannot
 * reach a gate is abandoned and the next round drops hard gates for soft
 * waypoint guides. Stops when the budget runs out, the caller stops it, or a
 * bounded budget goes several rounds without a gain.
 */
export async function optimizeSectioned(
  options: SectionedOptions,
): Promise<SectionedResult | null> {
  const { seedSymbols, levelData, arrowName, budgetMs } = options;
  if (seedSymbols.length === 0) return null;
  const engine = await createReplayEngine(levelData, arrowName);
  if (!engine) return null;
  const tuning = options.tuning ?? DEFAULT_TUNING;
  const waypoints = options.waypoints ?? [];
  const wpBonus = options.wpBonus ?? 300;
  const wpRadius = 40;
  const wpReach = wpRadius * 8;
  const momentum = options.momentum ?? 0.6;

  const start = Date.now();
  const timeLeft = () => (budgetMs > 0 ? budgetMs - (Date.now() - start) : Infinity);
  const shouldStop = () => !!options.shouldStop?.();

  const log: string[] = [];
  const report = (
    round: number,
    sections: number,
    evals: number,
    best: number,
    symbols: number[],
    msg?: string,
  ) => {
    options.onProgress?.({
      bestFinishTick: best,
      bestTimeMs: best * TICK_MS,
      seedFinishTick: null,
      round,
      sections,
      evaluations: evals,
      symbols,
      log: msg,
    });
  };

  // Trace the seed to get its pose at every tick (boundaries and gates come from
  // this path), and confirm it finishes.
  const seedTrace = await traceRun(engine, seedSymbols);
  if (seedTrace.finish === null) {
    engine.free();
    return null;
  }
  let baseSyms = seedSymbols.slice(0, seedTrace.finish);
  let basePts = seedTrace.pts.slice(0, (seedTrace.finish + 1) * 4);
  let bestFinish = seedTrace.finish;
  let rounds = 0;
  let totalEvals = 0;
  let sinceGain = 0;
  let softWaypoints = false;

  report(0, 0, 0, bestFinish, baseSyms, `Seed finishes in ${bestFinish} ticks.`);

  while (!shouldStop() && timeLeft() > 1500) {
    rounds++;
    const bounds = sectionBoundaries(bestFinish, options.sections ?? "auto", (rounds - 1) % 4);
    // Gates at each boundary, plus the finish. A waypoint becomes a hard gate
    // when it is near a boundary tick; otherwise it is a soft guide.
    const gates: (Waypoint | null)[] = bounds.map((b) => {
      if (waypoints.length && !softWaypoints) {
        // Nearest waypoint to this boundary, within a sane window.
        let best: Waypoint | null = null;
        let bestD = Infinity;
        for (const w of waypoints) {
          const d = Math.hypot((basePts[b * 4] ?? 0) - w.x, (basePts[b * 4 + 1] ?? 0) - w.y);
          if (d < bestD) {
            bestD = d;
            best = w;
          }
        }
        if (best && bestD < 80) return best;
      }
      return null;
    });

    const sections: Section[] = [];
    const tickStarts = [0, ...bounds, bestFinish];
    for (let i = 0; i < tickStarts.length - 1; i++) {
      sections.push({
        startTick: tickStarts[i],
        gateTick: i < bounds.length ? bounds[i] : null,
        // Each section is entered from the *previous section's winner*, not the
        // baseline: the baseline pose at a boundary is only right if nothing
        // before it changed, and then the improvements would never chain. The
        // first section starts from the spawn (null snapshot).
        startSnap: null,
      });
    }

    // A per-section budget: the round gets 75% of what is left, split by length.
    const roundBudget = Math.min(timeLeft() * 0.75, Math.max(8000, sections.length * 2500));
    let roundFailed = false;
    const stitched: number[] = [];
    const roundLog: string[] = [];
    // The state the next section starts from: null means the spawn (first
    // section); otherwise the previous section winner's exit snapshot.
    let runningSnap: string | null = null;

    for (let si = 0; si < sections.length; si++) {
      if (shouldStop() || timeLeft() < 800) break;
      const sec = sections[si];
      sec.startSnap = runningSnap;
      const isLast = si === sections.length - 1;
      const startTick = sec.startTick;
      const gateTick = sec.gateTick ?? bestFinish;
      const nextBoundary = tickStarts[si + 2] ?? bestFinish;
      const wp = gates[si] ?? null;
      const nextWp = gates[si + 1] ?? null;
      const gate = buildGate(basePts, gateTick, nextBoundary, wp, nextWp);
      const vmax = Math.max(
        ...Array.from({ length: bestFinish + 1 }, (_, t) =>
          Math.hypot(basePts[t * 4 + 2] ?? 0, basePts[t * 4 + 3] ?? 0),
        ),
      );
      const D = distanceBetween(basePts, startTick, gateTick);
      const baseSpeed = Math.max(
        0.05,
        Math.hypot(basePts[startTick * 4 + 2] ?? 0, basePts[startTick * 4 + 3] ?? 0),
      );
      const div = tuning.divergence > 0 && si % 2 === 1 ? tuning.divergence : 0;
      const bpath = div > 0 ? basePts.slice(0, Math.min(bestFinish, gateTick + 400) * 4 + 4) : null;
      const job: SectionJob = {
        maxTicks: Math.max(600, Math.round((gateTick - startTick) * 1.6 + 400)),
        gate,
        slab: Math.max(4, vmax * 2.5),
        vmax: vmax * 1.3 + 0.1,
        minTicks: Math.round((gateTick - startTick) * 0.4),
        D,
        baseSpeed,
        mw: momentum,
        micro: tuning.micro,
        div,
        bpath,
        waypoints: waypoints.length && !softWaypoints ? [] : waypoints,
        wpRadius,
        wpReach,
        wpBonus,
        bold: tuning.bold,
      };
      const seedSlice = baseSyms.slice(startTick, isLast ? undefined : gateTick + 400);
      // Pad the section seed so a section that ran short can still finish.
      const padded = seedSlice.slice();
      while (padded.length < Math.min(job.maxTicks, gateTick - startTick + 240)) padded.push(0);

      const sectionBudget = Math.max(
        600,
        Math.round((roundBudget * (gateTick - startTick)) / Math.max(1, bestFinish)),
      );
      const hooks: SearchHooks = {
        shouldStop: () => shouldStop(),
      };
      const found = await searchSection(
        engine,
        sec,
        padded,
        job,
        sectionBudget,
        (options.rngSeed ?? 1) * 1000003 + rounds * 7919 + si * 104729,
        hooks,
      );
      const cands = found.candidates;
      totalEvals += found.evaluations;
      if (!cands.length) {
        roundFailed = true;
        roundLog.push(
          `Section ${si + 1}: no line reached the gate (ticks ${startTick}–${gateTick}) — round abandoned.`,
        );
        break;
      }
      const win = cands[0];
      stitched.push(...win.syms);
      if (win.finished) {
        roundLog.push(`Section ${si + 1}: finished at tick ${win.cross}.`);
        break;
      }
      // Chain: the next section starts where this winner's line left off, so an
      // improvement in one section carries into the ones after it. A winner with
      // no snapshot is one that ran past the section, which the gate check makes
      // impossible, so this only guards a broken invariant.
      if (!win.snap) {
        roundFailed = true;
        roundLog.push(`Section ${si + 1}: winner had no exit state — round abandoned.`);
        break;
      }
      runningSnap = win.snap;
      roundLog.push(
        `Section ${si + 1}: crossed gate at tick ${win.cross} (ticks ${startTick}–${gateTick}).`,
      );
    }

    if (roundFailed) {
      if (!softWaypoints && waypoints.length) {
        softWaypoints = true;
        roundLog.push(`Round ${rounds}: next round guides the waypoints softly instead.`);
      }
      log.push(...roundLog);
      report(rounds, sections.length, totalEvals, bestFinish, baseSyms, roundLog.join(" "));
      sinceGain++;
      if (budgetMs === 0 && sinceGain >= 6) break;
      continue;
    }

    // Verify the stitched line end to end; only an improvement becomes the baseline.
    const ver = await traceRun(engine, stitched);
    if (ver.finish !== null && ver.finish < bestFinish) {
      roundLog.push(
        `Round ${rounds}: ${bestFinish} → ${ver.finish} ticks (−${bestFinish - ver.finish}). New baseline.`,
      );
      baseSyms = stitched.slice(0, ver.finish);
      basePts = ver.pts.slice(0, (ver.finish + 1) * 4);
      bestFinish = ver.finish;
      sinceGain = 0;
      softWaypoints = false;
      report(rounds, sections.length, totalEvals, bestFinish, baseSyms, roundLog.join(" "));
    } else {
      roundLog.push(`Round ${rounds}: no gain — shifting section boundaries.`);
      sinceGain++;
      report(rounds, sections.length, totalEvals, bestFinish, baseSyms, roundLog.join(" "));
      if (budgetMs === 0 && sinceGain >= 6) {
        roundLog.push(`Six rounds without a gain — stopping.`);
        log.push(...roundLog);
        break;
      }
    }
    log.push(...roundLog);
  }

  const finished = bestFinish;
  const improved = finished < seedTrace.finish;
  engine.free();
  return {
    symbols: baseSyms,
    inputs: encodeInputSymbols(baseSyms),
    inputCount: baseSyms.length,
    timeMs: Math.round(finished * TICK_MS),
    improved,
    bestFinishTick: finished,
    bestTimeMs: finished * TICK_MS,
    seedFinishTick: seedTrace.finish,
    rounds,
    evaluations: totalEvals,
  };
}

/** Path length between two ticks of a flat [x,y,vx,vy,...] trace. */
function distanceBetween(pts: number[], from: number, to: number): number {
  let d = 0;
  for (let t = from; t < to; t++) {
    const x0 = pts[t * 4] ?? 0;
    const y0 = pts[t * 4 + 1] ?? 0;
    const x1 = pts[(t + 1) * 4] ?? 0;
    const y1 = pts[(t + 1) * 4 + 1] ?? 0;
    d += Math.hypot(x1 - x0, y1 - y0);
  }
  return d;
}

/** Re-export so a caller can seed the sectioned search from a stored run. */
export function seedSymbolsFromInputs(inputs: string, inputCount?: number): number[] {
  return decodeInputSymbols(inputs, inputCount);
}
