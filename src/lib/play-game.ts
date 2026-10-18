/**
 * The Play tab's game loop: a fixed-rate stepper over the real engine, plus the
 * run bookkeeping (timer, checkpoints, splits, recording, finish detection).
 *
 * The engine is advanced in fixed 1/240s ticks at wall-clock pace. `advance`
 * is called once per animation frame and consumes the elapsed time, so a slow
 * frame runs several ticks and the simulation never drifts with the frame rate.
 * A spiral-of-death guard caps how many ticks one frame may run, so a long
 * stall (tab backgrounded, GC pause) doesn't replay seconds of stale input.
 *
 * The input for each tick is supplied by `sampleInput`, which the view wires to
 * the keyboard/touch/gamepad state. Recording the symbols lets a finished run
 * be exported in the same base64 format the TAS editor and the upstream API
 * use, so a play-mode run can be replayed, compared and submitted.
 */

import {
  createReplayEngine,
  levelGeometry,
  SIM_TICK_MS,
  type RawLevelData,
  type ReplayEngine,
  type SimGeometry,
  type SimPoint,
} from "./replay-sim";

export type PlayPhase = "idle" | "running" | "paused" | "finished" | "dead";

export interface Split {
  /** Checkpoint index within the run (0-based, in the order they were set). */
  index: number;
  /** Engine tick at which the checkpoint was passed. */
  tick: number;
  /** Split time in seconds (tick * 1/240). */
  timeSec: number;
}

export interface PlayResult {
  finished: boolean;
  /** Finish tick, or the death tick when `finished` is false. */
  tick: number;
  /** Wall-clock run time in seconds. */
  timeSec: number;
  /** Input symbols, one per engine tick, ready to encode. */
  symbols: number[];
  splits: Split[];
}

export interface PlayGameOptions {
  data: RawLevelData;
  arrowName: string;
  /** Supplies the held input for the next tick. */
  sampleInput: () => number;
  /** Called on every tick with the fresh sample and total tick count. */
  onTick?: (point: SimPoint, tick: number) => void;
  /** Called once when the run ends (finish or death). */
  onEnd?: (result: PlayResult) => void;
}

/** One tick of progress: how many ticks to run and the leftover accumulator. */
export function stepTicks(
  elapsedMs: number,
  accumulatorMs: number,
): { ticks: number; remainder: number } {
  const total = accumulatorMs + elapsedMs;
  const ticks = Math.floor(total / SIM_TICK_MS);
  // Keep the sub-tick remainder; cap the burst so a stall can't fast-forward.
  return { ticks: Math.min(ticks, 40), remainder: total - ticks * SIM_TICK_MS };
}

export class PlayGame {
  geometry: SimGeometry;
  phase: PlayPhase = "idle";
  tick = 0;
  splits: Split[] = [];
  /** The live path, `path[0]` being the spawn pose and `path[i]` after i ticks. */
  path: SimPoint[] = [];
  /** Tick -> checkpoint index, so a checkpoint is recorded the first time through. */
  private checkpointTicks = new Map<number, number>();
  private checkpoints = new Set<number>();

  private engine: ReplayEngine | null = null;
  private readonly data: RawLevelData;
  private readonly arrowName: string;
  private readonly sampleInput: () => number;
  private readonly onTick?: (point: SimPoint, tick: number) => void;
  private readonly onEnd?: (result: PlayResult) => void;

  private symbols: number[] = [];
  private snapshots = new Map<number, string>();
  private spawnPoint: SimPoint | null = null;
  private latest: SimPoint | null = null;
  private accumulator = 0;

  constructor(options: PlayGameOptions) {
    this.data = options.data;
    this.arrowName = options.arrowName;
    this.sampleInput = options.sampleInput;
    this.onTick = options.onTick;
    this.onEnd = options.onEnd;
    this.geometry = levelGeometry(options.data);
  }

  get ready(): boolean {
    return this.engine !== null;
  }

  async load() {
    this.engine?.free();
    this.engine = await createReplayEngine(this.data, this.arrowName);
    if (this.engine) this.spawnPoint = this.engine.reset();
    this.resetRun();
    return this.engine !== null;
  }

  /** True while the player is actively advancing the sim. */
  get playing(): boolean {
    return this.phase === "running";
  }

  /** Rewind to the last checkpoint (or the spawn) and resume. */
  restartFromCheckpoint() {
    if (!this.engine) return;
    // Use the dropped-checkpoint set, not the split map: a checkpoint that has
    // not been crossed yet (just set, or seeded by `playFrom`) is still valid.
    const tick = [...this.checkpoints].sort((a, b) => b - a)[0] ?? 0;
    this.rewindTo(tick);
    this.phase = "running";
  }

  /** Rewind to the spawn and resume a fresh run. */
  restart() {
    if (!this.engine) return;
    this.rewindTo(0);
    this.phase = "running";
  }

  pause() {
    if (this.phase === "running") this.phase = "paused";
  }

  resume() {
    if (this.phase === "paused") {
      this.phase = "running";
      this.accumulator = 0;
    }
  }

  /** Drop a checkpoint at the current tick; the arrow can be rewound to it. */
  setCheckpoint() {
    if (!this.engine || this.tick === 0) return;
    this.checkpoints.add(this.tick);
    if (!this.snapshots.has(this.tick)) this.snapshots.set(this.tick, this.engine.snapshot());
  }

  /**
   * Start a run from a stored prefix: replay `symbols` to recreate the exact
   * pose and register the end of the prefix as a checkpoint, so the player can
   * retry that section ("From checkpoint") without redoing the run. Used by the
   * Play tab to resume from a checkpoint saved off a watched TAS run.
   */
  playFrom(symbols: number[]): boolean {
    if (!this.engine) return false;
    this.resetRun();
    const spawn = this.engine.reset();
    if (spawn) this.spawnPoint = spawn;
    this.path = spawn ? [spawn] : [];
    this.symbols = [];
    this.latest = spawn;
    this.tick = 0;

    for (const symbol of symbols) {
      const code = this.engine.stepCode(symbol);
      this.tick++;
      this.symbols.push(symbol);
      if (code !== 0) {
        // The prefix itself crashes or finishes: keep what ran and stop here.
        this.latest = this.engine.read();
        this.path.push(this.latest);
        this.phase = code === 1 ? "finished" : "dead";
        return true;
      }
    }
    this.latest = this.engine.read();
    if (this.latest) this.path.push(this.latest);
    if (this.tick > 0) {
      this.checkpoints.add(this.tick);
      this.snapshots.set(this.tick, this.engine.snapshot());
    }
    this.phase = "running";
    this.accumulator = 0;
    return true;
  }

  /** Clear every checkpoint (e.g. when the level or arrow changes). */
  clearCheckpoints() {
    this.checkpoints.clear();
    this.checkpointTicks.clear();
    this.splits = [];
  }

  /** The ticks a checkpoint was dropped at, ascending. */
  get checkpointList(): number[] {
    return [...this.checkpoints].sort((a, b) => a - b);
  }

  /**
   * Advance the simulation by the wall-clock time since the last frame. Returns
   * the number of ticks run, so the caller can skip a repaint on a no-op frame.
   *
   * Each tick is stepped with the engine's cheap terminal-state code; the full
   * pose (the expensive state parse) is read once per call, at the render rate,
   * rather than 240 times a second. That keeps the per-tick cost near the raw
   * physics step (~0.003ms) instead of ~0.2ms, which is what let the sim fall
   * behind real time on slower devices.
   */
  advance(elapsedMs: number): number {
    if (!this.engine || this.phase !== "running") return 0;
    const { ticks, remainder } = stepTicks(elapsedMs, this.accumulator);
    this.accumulator = remainder;
    let ran = 0;
    for (let i = 0; i < ticks; i++) {
      const symbol = this.sampleInput();
      const code = this.engine.stepCode(symbol);
      this.tick++;
      ran++;
      this.symbols.push(symbol);
      this.recordSplits();
      if (code !== 0) {
        this.latest = this.engine.read();
        this.path.push(this.latest);
        this.finish(code === 1);
        break;
      }
    }
    if (ran > 0 && this.phase === "running") {
      this.latest = this.engine.read();
      this.path.push(this.latest);
      this.onTick?.(this.latest, this.tick);
    }
    return ran;
  }

  /** The latest sampled pose, or null before the first advance. */
  get current(): SimPoint | null {
    return this.latest;
  }

  /** The input symbols recorded so far, one per tick since the spawn. */
  get recordedSymbols(): number[] {
    return this.symbols.slice();
  }

  private recordSplits() {
    // Checkpoints are keyed by tick, so a rewind re-crosses them: only the
    // first crossing of each is a split, and a rewind past one removes it.
    for (const cp of this.checkpoints) {
      if (this.tick >= cp && !this.checkpointTicks.has(cp)) {
        this.checkpointTicks.set(cp, this.splits.length);
        this.splits.push({
          index: this.splits.length,
          tick: this.tick,
          timeSec: (this.tick * SIM_TICK_MS) / 1000,
        });
      }
    }
    // Rewinding below a checkpoint un-records it so the next pass re-splits.
    for (const [cp, idx] of this.checkpointTicks) {
      if (this.tick < cp) {
        this.checkpointTicks.delete(cp);
        this.splits = this.splits.filter((s) => s.index !== idx);
        this.splits.forEach((s, i) => (s.index = i));
      }
    }
  }

  private rewindTo(tick: number) {
    if (!this.engine) return;
    if (tick === 0) {
      const spawn = this.engine.reset();
      if (spawn) this.spawnPoint = spawn;
      this.symbols = [];
      this.path = this.spawnPoint ? [this.spawnPoint] : [];
      this.latest = this.spawnPoint;
    } else {
      const snap = this.snapshots.get(tick);
      if (!snap) return;
      this.latest = this.engine.restore(snap);
      this.symbols = this.symbols.slice(0, tick);
      this.path = this.path.slice(0, tick + 1);
    }
    this.tick = tick;
    this.accumulator = 0;
    this.splits = [];
    this.checkpointTicks.clear();
  }

  private finish(finished: boolean) {
    this.phase = finished ? "finished" : "dead";
    const result: PlayResult = {
      finished,
      tick: this.tick,
      timeSec: (this.tick * SIM_TICK_MS) / 1000,
      symbols: this.symbols.slice(),
      splits: this.splits.map((s) => ({ ...s })),
    };
    this.onEnd?.(result);
  }

  private resetRun() {
    this.tick = 0;
    this.symbols = [];
    this.path = this.spawnPoint ? [this.spawnPoint] : [];
    this.latest = this.spawnPoint;
    this.splits = [];
    this.accumulator = 0;
    this.checkpointTicks.clear();
    this.checkpoints.clear();
    this.snapshots.clear();
    this.phase = "idle";
  }

  free() {
    this.engine?.free();
    this.engine = null;
  }
}
