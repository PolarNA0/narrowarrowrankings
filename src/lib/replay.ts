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
 * is the "no input" state, not a steer; the steer symbols are then assigned by
 * simulating each run and checking which way the arrow actually turns):
 *   0 = neutral / coast (no input)
 *   1 = right steer held
 *   2 = left steer held
 *   3 = brake (both steer directions held — cancels steering and slows down)
 *
 * A mirrored replay is physically identical, so the hand cannot be proven from
 * the inputs alone; it is pinned here (and in `replay-sim.ts`) so the two stay
 * in agreement.
 */

/** Column encoded per 2-bit symbol (array position === symbol value). */
export const REPLAY_SYMBOLS = [
  { key: "neutral", label: "Neutral", short: "n", steer: false },
  { key: "right", label: "Right", short: "r", steer: true },
  { key: "left", label: "Left", short: "l", steer: true },
  { key: "brake", label: "Brake", short: "b", steer: false },
] as const;

export type ReplaySymbolKey = (typeof REPLAY_SYMBOLS)[number]["key"];

/** The "no input" symbol value. */
export const NEUTRAL_SYMBOL = 0;

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
  const decoded =
    typeof inputCount === "number" && inputCount > 0 ? symbols.slice(0, inputCount) : symbols;
  return decoded;
}

/**
 * Inverse of {@link decodeInputSymbols}: pack 2-bit symbols back into the
 * base64 the game stores in a run's `inputs` field, most-significant pair
 * first and the final byte zero-padded. Lets the TAS editor export its edits.
 */
export function encodeInputSymbols(symbols: number[]): string {
  if (symbols.length === 0) return "";
  const bytes: number[] = [];
  for (let i = 0; i < symbols.length; i += 4) {
    const a = symbols[i] & 3;
    const b = (symbols[i + 1] ?? 0) & 3;
    const c = (symbols[i + 2] ?? 0) & 3;
    const d = (symbols[i + 3] ?? 0) & 3;
    bytes.push((a << 6) | (b << 4) | (c << 2) | d);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * A TAS file in the wild comes in a few shapes: the editor's own export
 * (`{inputs, input_count}`), the offline optimiser's output (`{syms, arrow}`),
 * or a run-length list (`{segments:[{key,length}]}`). This normalises all of
 * them to the raw symbol stream so any of them can be imported.
 */
export interface ParsedTasFile {
  symbols: number[];
  arrowName?: string;
  levelId?: string;
  mapName?: string;
  finishTick?: number;
}

const SYMBOL_BY_NAME: Record<string, number> = {
  n: 0,
  neutral: 0,
  coast: 0,
  none: 0,
  r: 1,
  right: 1,
  l: 2,
  left: 2,
  b: 3,
  brake: 3,
  both: 3,
};

/**
 * Map a loose arrow label to a canonical name. External files spell it
 * differently — "speedy", "Energy Arrow", the game's "speedy arrow" — so match
 * on the substring the engine keys off rather than an exact string.
 */
function normaliseArrowName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const n = value.toLowerCase();
  if (n.includes("speedy")) return "Speedy Arrow";
  if (n.includes("energy")) return "Energy Arrow";
  if (n.includes("narrow")) return "Narrow Arrow";
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Decode a symbol list: plain 0-3 values, names ("right"), or run-length rows. */
function symbolsFromList(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: number[] = [];
  for (const item of value) {
    if (typeof item === "number") {
      if (item < 0 || item > 3 || !Number.isInteger(item)) return null;
      out.push(item);
      continue;
    }
    if (typeof item === "string") {
      const sym = SYMBOL_BY_NAME[item.trim().toLowerCase()];
      if (sym === undefined) return null;
      out.push(sym);
      continue;
    }
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const name = asString(row.key) ?? asString(row.short) ?? asString(row.input);
      const sym =
        typeof row.symbol === "number"
          ? row.symbol & 3
          : name
            ? SYMBOL_BY_NAME[name.toLowerCase()]
            : undefined;
      if (sym === undefined) return null;
      const length = Number(row.length ?? row.count ?? row.ticks ?? row.hold ?? 1);
      const n = Number.isFinite(length) && length > 0 ? Math.floor(length) : 1;
      for (let i = 0; i < n; i++) out.push(sym);
      continue;
    }
    return null;
  }
  return out.length ? out : null;
}

/** Parse a TAS file (JSON, whatever shape) into the raw symbol stream. */
export function parseTasFile(text: string): ParsedTasFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Some exporters nest the level under a `level` object; flatten it so the
  // same lookup works whether the fields are top-level or nested.
  const levelObj = (
    obj.level && typeof obj.level === "object" ? obj.level : {}
  ) as Record<string, unknown>;
  const meta = {
    arrowName: normaliseArrowName(
      asString(obj.arrow_name) ??
        asString(obj.arrowName) ??
        asString(obj.arrow) ??
        asString(levelObj.arrow),
    ),
    levelId:
      asString(obj.level_id) ??
      asString(obj.levelId) ??
      asString(levelObj.levelId) ??
      asString(levelObj.level_id) ??
      asString(levelObj.id),
    mapName:
      asString(obj.map_name) ??
      asString(obj.mapName) ??
      asString(levelObj.name) ??
      asString(levelObj.map_name) ??
      asString(levelObj.mapName),
    finishTick: asNumber(obj.f) ?? asNumber(obj.finish_tick) ?? asNumber(obj.finishTick),
  };

  const inputs = asString(obj.inputs);
  if (inputs) {
    const count = asNumber(obj.input_count) ?? asNumber(obj.inputCount);
    const symbols = decodeInputSymbols(inputs, count);
    if (!symbols.length) throw new Error("The file's `inputs` field decoded to nothing.");
    return { symbols, ...meta };
  }

  const symbols =
    symbolsFromList(
      obj.syms ??
        obj.symbols ??
        obj.segments ??
        obj.input_list ??
        obj.inputs_list ??
        obj.sequence ??
        (Array.isArray(obj.inputs) ? obj.inputs : undefined),
    ) ?? symbolsFromList(raw);
  if (symbols) return { symbols, ...meta };

  throw new Error("Unrecognised TAS file — expected `inputs` (base64) or a symbol list.");
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
