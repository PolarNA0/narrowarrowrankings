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
  finishTarget,
  simulateRun,
  type RawLevelData,
  type ReplayEngine,
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
  /**
   * Edit-window width. >1 takes broad strokes (Fast mode), <1 fine ones (Slow),
   * 1 (default) in between. Also widens the final 1-tick polish in Slow mode.
   */
  scale?: number;
  /** Run the 1-tick coordinate-descent polish after annealing. Default true. */
  refine?: boolean;
}

const TICK_MS = 1000 / 240;
/**
 * Sentinels for the DNF proximity score (see {@link Score}).
 *
 * A non-finishing run does not score a flat `DNF`; it scores how close it came
 * to the finish, so the annealer has a gradient to hill-climb even when nothing
 * finishes yet. Without it every DNF scores the same, `dE` is always 0, and the
 * search degenerates into a blind random walk. This is what lets a broken seed
 * (or a level the drawn line never completes) be repaired instead of stalling.
 */
export const DNF_SCORE = 1e6;
/** Ticks the score adds per world unit of closest approach to the finish. */
export const DNF_TICKS_PER_UNIT = 1 / 3;
/** Tie-break weight on survival time, so a DNF that got further along wins. */
export const DNF_TIME_W = 0.002;
export const SYMS = [0, 1, 2, 3];

/** A scored evaluation: the terminal tick, state code, and how close it got. */
export interface EvalResult {
  /** 1-based finish tick, or null if the run did not finish. */
  ticks: number | null;
  /** Engine terminal-state code: 0 playing, 1 finish, 2 dead. */
  code: number;
  /** Closest approach to the finish, in world units, or null if not tracked. */
  minDist: number | null;
  /** Tick the evaluation resumed from (0 when replayed from the spawn). */
  fromTick: number;
  /**
   * A caller-supplied cost, when the search is not the whole-run finish-time
   * search. The sectioned search scores a candidate against a gate, which needs
   * more than the terminal tick, so its sim stashes the cost here and the search
   * reads it back through {@link SearchHooks.score} instead of `scoreEval`.
   */
  score?: number;
}

/** Cost of an evaluation; lower is better, a real finish always beats a DNF. */
export function scoreEval(res: EvalResult): number {
  if (res.score !== undefined) return res.score;
  if (res.code === 1 && res.ticks != null) return res.ticks;
  const d = res.minDist ?? 4000;
  return DNF_SCORE + d * DNF_TICKS_PER_UNIT + (res.ticks ?? 0) * DNF_TIME_W;
}

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

/** Apply one simple, local edit in place. Returns the same array. */
function simpleMutate(s: Segment[], rnd: () => number, scale = 1): Segment[] {
  const r = (n: number) => Math.floor(rnd() * n);
  // `scale` widens (>1) or narrows (<1) every edit window, so one knob covers
  // both "broad strokes" and "fine, careful" search modes.
  const sc = (n: number) => Math.max(1, Math.round(n * scale));
  const pick = (a: number[]) => a[r(a.length)];
  if (s.length < 2) {
    const m = r(3);
    if (m === 0) s[0].symbol = pick(SYMS.filter((x) => x !== s[0].symbol));
    else if (m === 1) s[0].length = Math.max(1, 1 + r(sc(48)));
    else s.push({ symbol: pick(SYMS), length: 1 + r(sc(16)) });
    return s;
  }
  const m = r(10);
  const b = 1 + r(s.length - 1);
  if (m === 0) {
    const dl = (r(2) ? 1 : -1) * (1 + r(sc(16)));
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
    s.splice(1 + r(s.length), 0, { symbol: pick(SYMS), length: 1 + r(sc(16)) });
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
    s.splice(i, 2, { symbol: pick(SYMS), length: s[i].length + s[i + 1].length });
  } else if (m === 6) {
    const i = r(s.length);
    s[i].length = Math.max(1, 1 + r(sc(48)));
  } else if (m === 7) {
    const i = r(s.length - 1);
    const move = s[i].length;
    s[i].length = 1;
    s[i + 1].length += move - 1;
  } else if (m === 8) {
    // A single tick added or removed, for the finest possible nudge.
    if (r(2)) {
      s.splice(1 + r(s.length), 0, { symbol: pick(SYMS), length: 1 });
    } else {
      const i = r(s.length);
      if (s[i].length > 1) s[i].length -= 1;
    }
  } else {
    // Widen: lengthen two adjacent opposite holds by the same amount, so the
    // arrow runs wider into the corner and can carry more speed out of it.
    const i = r(s.length - 1);
    if (s[i].symbol !== s[i + 1].symbol) {
      const d = 1 + r(sc(12));
      s[i].length += d;
      s[i + 1].length += d;
    } else {
      const j = r(s.length);
      s[j].length += 1 + r(sc(12));
    }
  }
  return s;
}

/**
 * One random edit to the segment list. Mostly simple local edits, but two
 * compound moves exist because a corner reshape ("run wider in, exit tighter")
 * is never a single local edit: the intermediate steps cross a wall and DNF, so
 * a valley of invalid runs sits between the two lines. The block reshape
 * re-rolls a whole window of holds at once, and the paired move applies two
 * simple edits together; either can land on the far side of that valley, where
 * `refine` then polishes the new corner.
 */
export function mutate(segs: Segment[], rnd: () => number, scale = 1): Segment[] {
  const r = (n: number) => Math.floor(rnd() * n);
  const pick = (a: number[]) => a[r(a.length)];
  const sc = (n: number) => Math.max(1, Math.round(n * scale));
  const s = segs.map((x) => ({ ...x }));
  const m = r(13);
  if (m === 12 && s.length > 2) {
    // Wider entry, tighter exit: at a turn boundary, lengthen the hold on one
    // side and shorten the hold on the other. The idea is to run wider into a
    // corner and release the turn sooner, trading a slower entry for a faster
    // exit (or the reverse). Applied at a random boundary, both directions.
    const i = 1 + r(s.length - 2);
    const widen = 1 + r(sc(20));
    const tighten = 1 + r(sc(16));
    if (r(2)) {
      s[i - 1].length += widen;
      s[i].length = Math.max(1, s[i].length - tighten);
    } else {
      s[i].length += widen;
      s[i - 1].length = Math.max(1, s[i - 1].length - tighten);
    }
    return normalise(s);
  }
  if (m === 10 && s.length > 1) {
    // Block reshape: replace a random window of holds with fresh ones.
    const i = r(s.length);
    const w = Math.min(s.length - i, 1 + r(sc(4)));
    const block: Segment[] = [];
    for (let k = 0; k < w; k++) block.push({ symbol: pick(SYMS), length: 1 + r(sc(24)) });
    s.splice(i, w, ...block);
    return normalise(s);
  }
  if (m === 11) {
    // Paired: two simple edits at once, to hop the invalid valley between lines.
    simpleMutate(s, rnd, scale);
    simpleMutate(s, rnd, scale);
    return normalise(s);
  }
  return normalise(simpleMutate(s, rnd, scale));
}

export interface SimFn {
  /**
   * Replay `flat` (resuming from a checkpoint when possible) and score it.
   * `maxTicks` lets the caller abandon a candidate that cannot beat the
   * incumbent before it runs to completion.
   */
  (flat: number[], maxTicks?: number): EvalResult;
}

export interface SearchHooks {
  onBest?: (flat?: number[]) => void;
  shouldStop?: () => boolean;
  /**
   * Told when the search's reference stream changes (a new accepted/improved
   * stream), so a checkpointing sim can re-anchor its checkpoints. Without this
   * the checkpoints stay valid but miss more often and lose their speed-up.
   */
  onRef?: (flat: number[]) => void;
}

/**
 * A {@link SimFn} that avoids re-stepping a shared prefix.
 *
 * Every candidate the annealer/refiner proposes is a small edit of the current
 * stream, so most candidates replay the same opening ticks as the stream they
 * came from. A full `reset()` + step throws that away. Instead this keeps
 * snapshots of a reference stream every `stride` ticks and, for a candidate,
 * finds the deepest checkpoint whose prefix is byte-identical, restores it and
 * steps only the tail. Distant checkpoints miss (the candidate edited early) —
 * then it falls back to a full replay — but near ones hit and save the prefix.
 *
 * Measured on Moon Rock Rally: ~1.6x more evaluations in an isolated eval loop
 * (the search's own overhead and re-anchoring cost a little), and ~1.2x more
 * evaluations end-to-end, with bit-identical scores (the engine snapshot
 * round-trips exactly — verified over 800 candidates with re-anchoring).
 */
export class CheckpointSim {
  private engine: ReplayEngine;
  private maxTicks: number;
  private stride: number;
  private ref: number[];
  private cps: { at: number; snap: string; minDist: number }[] = [];
  private cache = new Map<string, EvalResult>();
  /** Finish target, or null when the level has no finish wall (no signal). */
  private target: { x: number; y: number } | null;
  /**
   * Once any evaluation finishes, the DNF distance signal is pointless (a
   * finish always outscores a DNF), and sampling it means parsing the engine's
   * full state — the dominant per-eval cost. Turn it off for good at that point.
   */
  private sawFinish = false;
  evaluations = 0;

  constructor(
    engine: ReplayEngine,
    ref: number[],
    maxTicks: number,
    stride = 240,
    target: { x: number; y: number } | null = null,
  ) {
    this.engine = engine;
    this.maxTicks = maxTicks;
    this.stride = stride;
    this.target = target;
    this.ref = ref.slice(0, maxTicks);
    this.rebuild();
  }

  private rebuild(from = 0, resumeSnap: string | null = null) {
    if (from === 0) {
      this.cps = [];
      this.engine.reset();
    } else if (resumeSnap) {
      this.engine.restore(resumeSnap);
    }
    const n = this.ref.length;
    let minDist = from > 0 ? (this.cps[this.cps.length - 1]?.minDist ?? Infinity) : Infinity;
    if (from === 0 && this.target) {
      const p = this.engine.read();
      minDist = Math.hypot(p.x - this.target.x, p.y - this.target.y);
    }
    for (let i = from; i < n; i++) {
      const code = this.engine.stepCode(this.ref[i]);
      if (this.target && !this.sawFinish && i % 24 === 0) {
        const p = this.engine.read();
        const d = Math.hypot(p.x - this.target.x, p.y - this.target.y);
        if (d < minDist) minDist = d;
      }
      // Key the checkpoint by the input index it is ready to resume FROM: after
      // stepping input `i` the engine has consumed `i+1` inputs, so the next one
      // to apply is `i+1`. Storing `i` here would re-apply input `i` on resume
      // and silently double-step one tick per checkpoint — which let the search
      // "finish" runs that actually die when replayed from the spawn.
      if (i > 0 && i % this.stride === 0 && this.cps[this.cps.length - 1]?.at !== i + 1)
        this.cps.push({ at: i + 1, snap: this.engine.snapshot(), minDist });
      if (code !== 0) break;
    }
  }

  /**
   * Re-anchor the checkpoints to a new reference stream. Only the tail past the
   * divergence is rebuilt — an accepted edit near the end of the run costs a
   * few ticks, not a full replay.
   */
  setRef(flat: number[]) {
    const n = Math.min(flat.length, this.maxTicks);
    let d = 0;
    const m = Math.min(this.ref.length, n);
    while (d < m && this.ref[d] === flat[d]) d++;
    this.ref = flat.slice(0, this.maxTicks);
    this.cps = this.cps.filter((cp) => cp.at <= d);
    const last = this.cps[this.cps.length - 1];
    this.rebuild(last ? last.at : 0, last ? last.snap : null);
  }

  /**
   * Deepest checkpoint whose whole prefix matches `flat`'s, or -1. One scan to
   * the first divergence, then the deepest checkpoint at or before it — cheaper
   * than testing each checkpoint's prefix separately.
   */
  private deepest(flat: number[]): number {
    const n = Math.min(this.ref.length, this.maxTicks);
    const m = Math.min(flat.length, n);
    let d = 0;
    while (d < m && flat[d] === this.ref[d]) d++;
    let k = -1;
    for (let i = 0; i < this.cps.length; i++) {
      if (this.cps[i].at <= d) k = i;
      else break;
    }
    return k;
  }

  sim = (flat: number[], maxTicks = 0): EvalResult => {
    const n = Math.min(flat.length, this.maxTicks);
    const key =
      flat.length <= this.maxTicks ? flat.join("") : flat.slice(0, this.maxTicks).join("");
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    this.evaluations++;

    const k = this.deepest(flat);
    let start = 0;
    let minDist = Infinity;
    if (k >= 0) {
      const { at, snap, minDist: md } = this.cps[k];
      try {
        this.engine.restore(snap);
        start = at;
        minDist = md;
      } catch {
        this.engine.reset();
        start = 0;
      }
    } else {
      this.engine.reset();
      if (this.target) {
        const p = this.engine.read();
        minDist = Math.hypot(p.x - this.target.x, p.y - this.target.y);
      }
    }

    // Abandon a candidate that cannot beat the incumbent before it finishes.
    const limit = maxTicks > 0 ? Math.min(n, Math.max(start, maxTicks)) : n;
    const sample = this.target !== null && !this.sawFinish;
    let ticks: number | null = null;
    let code = 0;
    for (let i = start; i < limit; i++) {
      code = this.engine.stepCode(flat[i]);
      if (sample && i % 24 === 0) {
        const p = this.engine.read();
        const d = Math.hypot(p.x - this.target!.x, p.y - this.target!.y);
        if (d < minDist) minDist = d;
      }
      if (code === 1) {
        ticks = i + 1;
        break;
      }
      if (code === 2) break;
    }
    if (code === 1) this.sawFinish = true;
    const out: EvalResult = {
      ticks,
      code,
      minDist: minDist === Infinity ? null : minDist,
      fromTick: start,
    };
    if (this.cache.size < 120000) this.cache.set(key, out);
    return out;
  };
}

/**
 * Simulated annealing over the segment list. Returns the best stream found.
 *
 * Two cost savers that matter on long levels:
 *  * Once a finishing incumbent exists the DNF distance signal is pointless, so
 *    the sim stops sampling distance and candidates that overrun the incumbent
 *    are abandoned as soon as they pass its tick count (`maxTicks`).
 *  * Reheating restarts from the best, so a dead basin is not ground forever.
 */
export function anneal(
  sim: SimFn,
  seedFlat: number[],
  rngSeed: number,
  t0: number,
  budgetMs: number,
  hooks: SearchHooks,
  scale = 1,
  bold = 1,
  reheatFloor = 0.15,
): { flat: number[]; best: number; steps: number; reheats: number } {
  const rnd = makeRng(rngSeed);
  let cur = toSegs(seedFlat);
  const first = sim(seedFlat);
  let curScore = scoreEval(first);
  let bestFlat = seedFlat.slice();
  let best = curScore;
  let T = t0;
  let steps = 0;
  let reheats = 0;
  let sinceImprove = 0;
  const start = Date.now();
  let lastReport = 0;
  // A finishing incumbent lets us prune: stop sampling distance, and cut any
  // candidate that passes the incumbent's tick count before it can finish.
  let haveFinish = first.code === 1;
  let bestTicks = haveFinish ? (first.ticks ?? 0) : 0;
  // A budget of 0 (or less) means "no cap": run until the caller stops us.
  while (budgetMs <= 0 || Date.now() - start < budgetMs) {
    if (hooks.shouldStop?.()) break;
    steps++;
    // `bold` applies several mutations per step: one inches along the current
    // line, several can jump to a different basin, which is what a worker told
    // to "try more things" needs.
    let cand = cur;
    for (let k = 0; k < bold; k++) cand = mutate(cand, rnd, scale);
    const flat = expand(cand);
    const maxTicks = haveFinish ? bestTicks + 16 : 0;
    const res = sim(flat, maxTicks);
    const sc = scoreEval(res);
    const dE = sc - curScore;
    if (dE < 0 || rnd() < Math.exp(-dE / Math.max(0.05, T))) {
      cur = cand;
      curScore = sc;
      // Re-anchor to the stream the next candidate will edit. `setRef` rebuilds
      // only the tail past the divergence, so following `cur` (which changes on
      // every accept) keeps the checkpoints close to where candidates differ.
      hooks.onRef?.(flat);
      if (sc < best) {
        best = sc;
        bestFlat = flat;
        sinceImprove = 0;
        if (res.code === 1) {
          haveFinish = true;
          bestTicks = res.ticks ?? bestTicks;
        }
        hooks.onBest?.(bestFlat);
      } else sinceImprove++;
    } else sinceImprove++;
    T *= 0.9997;
    // Reheat when too cold, or when the best has stalled for a long stretch, so
    // a dead basin is not ground forever. Restart from the best.
    if (T < reheatFloor || sinceImprove > 6000) {
      reheats++;
      T = Math.max(2.0, t0 * 0.5);
      cur = toSegs(bestFlat);
      curScore = best;
      hooks.onRef?.(bestFlat);
      sinceImprove = 0;
    }
    const now = Date.now();
    if (now - lastReport > 400) {
      lastReport = now;
      hooks.onBest?.();
    }
  }
  return { flat: bestFlat, best, steps, reheats };
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
  radius = 24,
): { flat: number[]; best: number; passes: number } {
  let flat = seedFlat.slice();
  let best = scoreEval(sim(flat));
  const start = Date.now();
  const outOfTime = () => budgetMs > 0 && Date.now() - start > budgetMs;
  const W0 = win ? win[0] : 0;
  const W1 = win ? win[1] : flat.length;
  const inWindow = (tick: number) => tick >= W0 - radius && tick <= W1 + radius;
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
      for (let d = 1; d <= radius; d++) {
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
          const sc = scoreEval(sim(expand(s2)));
          if (sc < best) {
            best = sc;
            flat = expand(s2);
            improved = true;
            hooks.onRef?.(flat);
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
          const sc = scoreEval(sim(expand(a)));
          if (sc < best) {
            best = sc;
            flat = expand(a);
            improved = true;
            hooks.onRef?.(flat);
            hooks.onBest?.(flat);
            continue;
          }
        }
        if (segs2[i].length > 1) {
          const c2 = segs2.map((x) => ({ ...x }));
          c2[i].length -= 1;
          const sc = scoreEval(sim(expand(c2)));
          if (sc < best) {
            best = sc;
            flat = expand(c2);
            improved = true;
            hooks.onRef?.(flat);
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

  // Scores every candidate by replaying it, but skips the shared prefix: a
  // checkpoint taken near where the candidate diverges is restored instead of
  // stepping from the spawn. This is what makes the search "more powerful" —
  // same budget, ~1.2x more candidates evaluated end-to-end (see CheckpointSim).
  // The finish-wall centroid gives a DNF proximity signal, so a seed that does
  // not finish (or a level nothing completes yet) can still be hill-climbed.
  const csim = new CheckpointSim(engine, seedSymbols, maxTicks, 60, finishTarget(levelData));
  const sim: SimFn = csim.sim;
  const evaluations = () => csim.evaluations;

  const seedRes = sim(seedSymbols);
  const seedScore = scoreEval(seedRes);
  const seedFinishTick = seedRes.code === 1 ? seedRes.ticks : null;

  let bestFlat = seedSymbols.slice();
  let bestScore = seedScore;
  let bestFinishTick = seedFinishTick;
  let steps = 0;
  let lastReport = 0;

  const report = () => {
    const now = Date.now();
    if (now - lastReport < 300) return;
    lastReport = now;
    options.onProgress?.({
      bestFinishTick,
      bestTimeMs: bestFinishTick !== null ? bestFinishTick * TICK_MS : null,
      seedFinishTick,
      generations: steps,
      evaluations: evaluations(),
      symbols: bestFlat,
    });
  };

  const hooks: SearchHooks = {
    onBest: (flat) => {
      if (flat) {
        const res = sim(flat);
        const sc = scoreEval(res);
        if (sc <= bestScore) {
          bestScore = sc;
          bestFlat = flat;
          bestFinishTick = res.code === 1 ? res.ticks : null;
        }
      }
      report();
    },
    onRef: (flat) => csim.setRef(flat),
    shouldStop: options.shouldStop,
  };

  // Anneal for the bulk of the budget, then spend the rest polishing by 1 tick.
  // An uncapped budget (<= 0) means "run until stopped", so skip the bounded
  // refine pass and let the annealer run until `shouldStop` fires.
  const wantRefine = options.refine !== false && budgetMs > 0;
  const refineBudget = wantRefine ? Math.max(1500, Math.floor(budgetMs * 0.4)) : 0;
  const annealBudget =
    budgetMs <= 0 ? 0 : wantRefine ? Math.max(1000, budgetMs - refineBudget) : budgetMs;

  const annealed = anneal(
    sim,
    seedSymbols,
    options.rngSeed ?? Date.now() & 0x7fffffff,
    options.t0 ?? 6.0,
    annealBudget,
    hooks,
    options.scale ?? 1,
  );
  steps = annealed.steps;
  if (annealed.best < bestScore) {
    bestScore = annealed.best;
    bestFlat = annealed.flat;
  }

  if (wantRefine) {
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Slow mode gets a wider 1-tick polish window, matching the reference tool.
    const radius = (options.scale ?? 1) < 1 ? 24 : 16;
    const polished = refine(sim, bestFlat, refineBudget, hooks, null, radius);
    if (polished.best < bestScore) {
      bestScore = polished.best;
      bestFlat = polished.flat;
    }
  }

  // Re-derive the terminal state of the winner (it may have come from `refine`,
  // which does not report ticks) so the caller knows whether it finished.
  const finalRes = sim(bestFlat);
  bestFinishTick = finalRes.code === 1 ? finalRes.ticks : null;

  if (finalRes.code !== 1) {
    // Nothing finished; keep the seed if it at least finished, else fail.
    if (seedFinishTick === null) return null;
    bestFlat = seedSymbols.slice();
    bestFinishTick = seedFinishTick;
    bestScore = seedScore;
  }

  options.onProgress?.({
    bestFinishTick,
    bestTimeMs: bestFinishTick !== null ? bestFinishTick * TICK_MS : null,
    seedFinishTick,
    generations: steps,
    evaluations: evaluations(),
    symbols: bestFlat,
  });

  const symbols = bestFlat;
  const finished = bestFinishTick !== null;

  return {
    symbols,
    inputs: encodeInputSymbols(symbols),
    inputCount: symbols.length,
    timeMs: Math.round((finished ? bestFinishTick! : bestScore) * TICK_MS),
    improved: seedFinishTick === null || (finished && bestFinishTick! < seedFinishTick),
    bestFinishTick,
    bestTimeMs: bestFinishTick !== null ? bestFinishTick * TICK_MS : null,
    seedFinishTick,
    generations: steps,
    evaluations: evaluations(),
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
