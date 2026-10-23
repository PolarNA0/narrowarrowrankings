/**
 * Web Worker wrapper around the brute-force optimizer.
 *
 * The search pins a CPU core for the whole budget, so it runs off the main
 * thread: the UI keeps painting, and every new best is posted back as it is
 * found so a Stop press keeps whatever the search had reached. Messages in:
 * `{ type: "start", options }` and `{ type: "stop" }`. Messages out:
 * `{ type: "progress", progress }`, `{ type: "done", result }`,
 * `{ type: "error", message }`.
 */
import {
  optimizeRunLite,
  type BruteOptions,
  type BruteProgress,
  type BruteResultLite,
} from "./tas-brute";
import { optimizeSectioned, type SectionedOptions, type SectionedProgress } from "./tas-sectioned";

let stopped = false;

/** Sectioned search: a per-worker slice of the tuning knobs and a waypoint set. */
type SectionedStartOptions = Omit<SectionedOptions, "onProgress" | "shouldStop">;

interface StartMessage {
  type: "start";
  options: Omit<BruteOptions, "onProgress" | "shouldStop">;
}

interface SectionedMessage {
  type: "start-sectioned";
  options: SectionedStartOptions;
}

type InMessage = StartMessage | SectionedMessage | { type: "stop" };

const toProgress = (p: SectionedProgress): BruteProgress => ({
  bestFinishTick: p.bestFinishTick,
  bestTimeMs: p.bestTimeMs,
  seedFinishTick: p.seedFinishTick,
  generations: p.round,
  evaluations: p.evaluations,
  symbols: p.symbols,
});

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (!msg || msg.type === "stop") {
    stopped = true;
    return;
  }

  stopped = false;
  try {
    if (msg.type === "start-sectioned") {
      const r = await optimizeSectioned({
        ...msg.options,
        onProgress: (p: SectionedProgress) =>
          self.postMessage({ type: "progress", progress: toProgress(p), log: p.log }),
        shouldStop: () => stopped,
      });
      // Present the sectioned result in the same shape as the whole-run search,
      // so the panel that shows it needs no special case. `rounds` stands in for
      // `generations` (both are "search iterations completed").
      const lite: BruteResultLite | null = r
        ? {
            symbols: r.symbols,
            inputs: r.inputs,
            inputCount: r.inputCount,
            timeMs: r.timeMs,
            improved: r.improved,
            bestFinishTick: r.bestFinishTick,
            bestTimeMs: r.bestTimeMs,
            seedFinishTick: r.seedFinishTick,
            generations: r.rounds,
            evaluations: r.evaluations,
          }
        : null;
      self.postMessage({ type: "done", result: lite });
      return;
    }
    if (msg.type !== "start") return;
    const result: BruteResultLite | null = await optimizeRunLite({
      ...msg.options,
      onProgress: (progress: BruteProgress) => self.postMessage({ type: "progress", progress }),
      shouldStop: () => stopped,
    });
    self.postMessage({ type: "done", result });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
