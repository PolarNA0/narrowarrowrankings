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

let stopped = false;

interface StartMessage {
  type: "start";
  options: Omit<BruteOptions, "onProgress" | "shouldStop">;
}

type InMessage = StartMessage | { type: "stop" };

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (!msg || msg.type === "stop") {
    stopped = true;
    return;
  }
  if (msg.type !== "start") return;

  stopped = false;
  try {
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
