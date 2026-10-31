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
  type SiteTimeline,
  type EnginePlayerState,
} from "./replay-sim";

export type PlayPhase = "idle" | "countdown" | "running" | "paused" | "finished" | "dead";

/** How long the whole pre-run countdown lasts, in wall-clock milliseconds. */
export const COUNTDOWN_MS = 1000;

/** The digits the countdown shows, highest first (3, 2, 1). */
export const COUNTDOWN_STEPS = 3;

/** The playback rates offered for manual testing, slowest first. */
export const PLAY_SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10] as const;
export const MIN_PLAY_SPEED = 0.1;
export const MAX_PLAY_SPEED = 10;

/**
 * The countdown digit to show for `remainingMs` (3, 2, 1), or 0 once the run
 * has started. The digits share the countdown evenly, so the whole 3-2-1 lasts
 * `COUNTDOWN_MS` however many steps there are. Split out so the display rule is
 * testable without a running game.
 */
export function countdownDigit(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / (COUNTDOWN_MS / COUNTDOWN_STEPS)));
}

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
  /** The playback rate the run was recorded at (1 = real time). */
  speed: number;
  /** True only if the run was at 1× throughout, so it is board-eligible. */
  realTime: boolean;
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

/**
 * One tick of progress: how many ticks to run and the leftover accumulator.
 *
 * `speed` scales the elapsed wall-clock time into simulation time, so 0.5 runs
 * half as many ticks and 2 runs twice as many; the remainder is kept against the
 * *scaled* total so a fractional rate does not drift. The burst cap is left in
 * wall-clock terms (a stall may not fast-forward), which is why it is scaled too.
 */
export function stepTicks(
  elapsedMs: number,
  accumulatorMs: number,
  speed = 1,
): { ticks: number; remainder: number } {
  const total = accumulatorMs + elapsedMs * speed;
  const ticks = Math.floor(total / SIM_TICK_MS);
  const cap = Math.max(1, Math.round(40 * speed));
  return { ticks: Math.min(ticks, cap), remainder: total - ticks * SIM_TICK_MS };
}

export class PlayGame {
  geometry: SimGeometry;
  phase: PlayPhase = "idle";
  tick = 0;
  /**
   * The current playback rate (1 = real time). A rate other than 1 is a manual
   * testing aid: the run it produces is not a valid speedrun, so the view refuses
   * to post it to a board unless it is back at 1×.
   */
  speed = 1;
  /**
   * True once the current run has run at a rate other than 1×, at any point.
   * Latched rather than derived from `speed`, so slowing down to land a tricky
   * input and switching back to 1× before finishing cannot launder the run.
   */
  private nonRealTime = false;
  /** Wall-clock milliseconds left in the pre-run countdown (0 once started). */
  countdownMs = 0;
  splits: Split[] = [];
  /** The live path, `path[0]` being the spawn pose and `path[i]` after i ticks. */
  path: SimPoint[] = [];
  /**
   * The tick each `path` point was sampled at. `path` gains one point per
   * *rendered frame* (several physics ticks may elapse per frame), so
   * `path.length - 1` is not the current tick; renderers that need the true
   * tick (spinner angle, moving blocks) read {@link currentTick} or pair a
   * point with its stamp here.
   */
  pathTicks: number[] = [];
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
    this.beginCountdown();
  }

  /** Rewind to the spawn and resume a fresh run. */
  restart() {
    if (!this.engine) return;
    this.rewindTo(0);
    this.beginCountdown();
  }

  pause() {
    if (this.phase === "running" || this.phase === "countdown") this.phase = "paused";
  }

  resume() {
    if (this.phase !== "paused") return;
    // A pause during the countdown resumes the countdown, not the run.
    this.phase = this.countdownMs > 0 ? "countdown" : "running";
    this.accumulator = 0;
  }

  /** Set the playback rate; the view gates board submissions on it being 1. */
  setSpeed(speed: number) {
    this.speed = Math.min(MAX_PLAY_SPEED, Math.max(MIN_PLAY_SPEED, speed));
  }

  /** Arm the 3-2-1 countdown; the clock starts when it drains. */
  beginCountdown() {
    this.accumulator = 0;
    this.countdownMs = COUNTDOWN_MS;
    this.phase = "countdown";
  }

  /** Skip the countdown and start running immediately. */
  private startRunning() {
    this.countdownMs = 0;
    this.phase = "running";
    this.accumulator = 0;
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
    this.pathTicks = spawn ? [0] : [];
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
        this.pathTicks.push(this.tick);
        this.phase = code === 1 ? "finished" : "dead";
        return true;
      }
    }
    this.latest = this.engine.read();
    if (this.latest) {
      this.path.push(this.latest);
      this.pathTicks.push(this.tick);
    }
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
    if (!this.engine) return 0;
    // The countdown runs on wall-clock time and ignores the playback speed: it
    // is a "get ready" beat, not part of the run.
    if (this.phase === "countdown") {
      this.countdownMs -= elapsedMs;
      if (this.countdownMs > 0) return 0;
      this.startRunning();
      return 0;
    }
    if (this.phase !== "running") return 0;
    const { ticks, remainder } = stepTicks(elapsedMs, this.accumulator, this.speed);
    this.accumulator = remainder;
    if (ticks > 0 && this.speed !== 1) this.nonRealTime = true;
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
        this.pathTicks.push(this.tick);
        this.finish(code === 1);
        break;
      }
    }
    if (ran > 0 && this.phase === "running") {
      this.latest = this.engine.read();
      this.path.push(this.latest);
      this.pathTicks.push(this.tick);
      this.onTick?.(this.latest, this.tick);
    }
    return ran;
  }

  /** The latest sampled pose, or null before the first advance. */
  get current(): SimPoint | null {
    return this.latest;
  }

  /**
   * The engine's full live state — pose, the obstacle list with rotations
   * applied, and this tick's effects — for a renderer that draws the map the
   * physics actually used (the WebGL game renderer). This parses the whole
   * state string, so read it once per *rendered frame*, never per tick; that is
   * why the plain 2D canvas (which only needs the pose) does not call it.
   */
  liveState(): EnginePlayerState | null {
    return this.engine?.readFull() ?? null;
  }

  /** The physics tick the latest sampled pose is at (0 at spawn). */
  get currentTick(): number {
    return this.tick;
  }

  /** The countdown digit to display (3, 2, 1), or 0 when not counting down. */
  get countdown(): number {
    return this.phase === "countdown" || (this.phase === "paused" && this.countdownMs > 0)
      ? countdownDigit(this.countdownMs)
      : 0;
  }

  /** Whether the run was recorded at real time (a 1× rate throughout). */
  get isRealTime(): boolean {
    return this.speed === 1 && !this.nonRealTime;
  }

  /**
   * The site-only run timeline (switch fires, broken walls) so far. The play
   * canvas reads it to draw a door's open state or a broken wall live, exactly as
   * the replay viewer does.
   */
  get timeline(): SiteTimeline {
    return this.engine?.timeline() ?? { switchFires: [], brokenAt: [] };
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
      this.pathTicks = this.spawnPoint ? [0] : [];
      this.latest = this.spawnPoint;
      // A full rewind discards every recorded input, so this is a fresh run.
      this.resetRealTimeLatch();
    } else {
      const snap = this.snapshots.get(tick);
      if (!snap) return;
      this.latest = this.engine.restore(snap);
      this.symbols = this.symbols.slice(0, tick);
      // Keep every frame sample at or before the rewind tick; slicing by index
      // would keep samples from ticks past the target (path is frame-sampled).
      let keep = this.pathTicks.findIndex((t) => t > tick);
      if (keep < 0) keep = this.path.length;
      this.path = this.path.slice(0, keep);
      this.pathTicks = this.pathTicks.slice(0, keep);
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
      speed: this.speed,
      realTime: this.isRealTime,
    };
    this.onEnd?.(result);
  }

  /** Reset the "was this run at real time?" latch for a fresh run. */
  private resetRealTimeLatch() {
    this.nonRealTime = false;
  }

  private resetRun() {
    this.tick = 0;
    this.symbols = [];
    this.path = this.spawnPoint ? [this.spawnPoint] : [];
    this.pathTicks = this.spawnPoint ? [0] : [];
    this.latest = this.spawnPoint;
    this.splits = [];
    this.accumulator = 0;
    this.countdownMs = 0;
    this.resetRealTimeLatch();
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
