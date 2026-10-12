/**
 * Decoder for the game's replay input stream.
 *
 * A run's `inputs` field is a base64 string where each byte packs four 2-bit
 * symbols, most-significant pair first. The game samples input at four times
 * the physics rate, so one tick is 1000/240 ≈ 4.1667ms and four ticks make one
 * 60Hz physics frame.
 *
 * Symbol alphabet (recovered by matching a live replay against the level
 * geometry — the value that dominates while steering through a map is 0, so it
 * is the "no input" state, not a steer):
 *   0 = neutral / coast (no input)
 *   1 = left steer held
 *   2 = right steer held
 *   3 = brake (both steer directions held — cancels steering and slows down)
 *
 * The left/right assignment is the one remaining unknown: a mirrored replay is
 * physically identical, so it cannot be resolved from the inputs alone. It is
 * kept in one place here so it can be flipped if ever confirmed visually.
 */

/** Column encoded per 2-bit symbol (array position === symbol value). */
export const REPLAY_SYMBOLS = [
  { key: "neutral", label: "Neutral", short: "n", steer: false },
  { key: "left", label: "Left", short: "l", steer: true },
  { key: "right", label: "Right", short: "r", steer: true },
  { key: "brake", label: "Brake", short: "b", steer: false },
] as const;

export type ReplaySymbolKey = (typeof REPLAY_SYMBOLS)[number]["key"];

/** Milliseconds represented by a single input tick (240Hz). */
export const REPLAY_TICK_MS = 1000 / 240;

export interface ReplayInput {
  /** 0-based index of this input in the run. */
  index: number;
  /** Which symbol/state this input encodes. */
  key: ReplaySymbolKey;
  /** Short symbol char, e.g. "r". */
  short: string;
  /** Timestamp in ms from the start of the run. */
  atMs: number;
  /** How long this state stays held before the next distinct input, in ms. */
  heldMs: number;
}

export interface ReplaySummary {
  inputs: ReplayInput[];
  /** Number of raw input ticks decoded. */
  tickCount: number;
  /** Total run duration covered by the inputs, in ms. */
  durationMs: number;
  /** Milliseconds spent in each state. */
  totals: Record<ReplaySymbolKey, number>;
  /** Number of distinct state changes (including the first state). */
  segmentCount: number;
}

/** Decode a base64 `inputs` string into its 2-bit symbols. */
export function decodeInputSymbols(base64: string, inputCount?: number): number[] {
  if (!base64) return [];
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return [];
  }
  const symbols: number[] = [];
  for (let i = 0; i < binary.length; i++) {
    const byte = binary.charCodeAt(i);
    symbols.push((byte >> 6) & 3, (byte >> 4) & 3, (byte >> 2) & 3, byte & 3);
  }
  return typeof inputCount === "number" && inputCount > 0 ? symbols.slice(0, inputCount) : symbols;
}

/**
 * Collapse the raw symbol stream into held-input segments, e.g. "right 72ms".
 * Ported to milliseconds using the 240Hz tick rate.
 */
export function summariseReplay(inputs: string, inputCount?: number): ReplaySummary {
  const symbols = decodeInputSymbols(inputs, inputCount);
  const empty: ReplaySummary = {
    inputs: [],
    tickCount: 0,
    durationMs: 0,
    totals: { left: 0, right: 0, neutral: 0, brake: 0 },
    segmentCount: 0,
  };
  if (symbols.length === 0) return empty;

  const segments: ReplayInput[] = [];
  const totals: Record<ReplaySymbolKey, number> = { left: 0, right: 0, neutral: 0, brake: 0 };

  let start = 0;
  let current = symbols[0];
  for (let i = 1; i <= symbols.length; i++) {
    // Flush the run [start, i) when the symbol changes (or at the end).
    if (i === symbols.length || symbols[i] !== current) {
      const meta = REPLAY_SYMBOLS[current] ?? REPLAY_SYMBOLS[0];
      const heldMs = (i - start) * REPLAY_TICK_MS;
      segments.push({
        index: segments.length,
        key: meta.key,
        short: meta.short,
        atMs: start * REPLAY_TICK_MS,
        heldMs,
      });
      totals[meta.key] += heldMs;
      if (i < symbols.length) {
        start = i;
        current = symbols[i];
      }
    }
  }

  return {
    inputs: segments,
    tickCount: symbols.length,
    durationMs: symbols.length * REPLAY_TICK_MS,
    totals,
    segmentCount: segments.length,
  };
}

/** Compact label for a held input, e.g. "r72" (right held for 72ms). */
export function formatReplayInput(input: ReplayInput): string {
  return `${input.short}${Math.round(input.heldMs)}`;
}

/** Compact label for an entire segment including its start time. */
export function formatReplayTimestamp(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

export interface ReplayCombo {
  /** Steering sequence, e.g. "L/RL" (held together) or "L→R" (tapped in order). */
  sequence: string;
  /** Number of distinct held segments the combo was folded from. */
  segments: number;
  /** How long the whole combo lasts, in ms. */
  durationMs: number;
}

/** A steering segment is a tap when it is shorter than this. */
const TAP_MS = 130;

/**
 * Fold the held-input segments into a press sequence / combo. Neutral gaps are
 * dropped (they are coasting, not a key press) and a real pause between two
 * presses is shown as a separator. Runs of alternating short taps are joined
 * with "/" because in play they are mashed together, e.g. "L/RL".
 */
export function detectCombo(summary: ReplaySummary): ReplayCombo | null {
  const presses = summary.inputs.filter((input) => input.key === "left" || input.key === "right");
  if (presses.length === 0) return null;

  let sequence = "";
  let gapBefore = 0;
  let durationMs = 0;
  for (let i = 0; i < presses.length; i++) {
    const press = presses[i];
    if (i > 0) {
      // Distance from the end of the previous press to the start of this one.
      const prevEnd = presses[i - 1].atMs + presses[i - 1].heldMs;
      gapBefore = press.atMs - prevEnd;
    }
    const ch = press.key === "left" ? "L" : "R";
    if (i === 0) sequence = ch;
    else if (gapBefore > 90) sequence += ` → ${ch}`;
    else sequence += `/${ch}`;
    durationMs = press.atMs + press.heldMs;
  }

  return {
    sequence,
    segments: presses.length,
    durationMs,
  };
}

/** True when a steering press is a quick tap rather than a sustained hold. */
export function isTap(input: ReplayInput): boolean {
  return (input.key === "left" || input.key === "right") && input.heldMs < TAP_MS;
}
