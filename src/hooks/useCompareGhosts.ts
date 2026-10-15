import * as React from "react";
import { simulateRun, type RawLevelData, type SimResult } from "@/lib/replay-sim";

/**
 * A run another run can be replayed against, on the same stage. A real-game run
 * is identified by its `runId` and its inputs are fetched on demand; a TAS entry
 * already carries its inputs, so it needs no fetch.
 */
export interface CompareCandidate {
  id: string;
  username: string;
  inputs: string;
  inputCount: number;
  arrowName: string;
  timeMs: number;
  /** Set for real-game runs whose inputs are not loaded yet. */
  runId?: number;
  kind?: "tas" | "human";
}

interface RunInputs {
  inputs: string;
  inputCount: number;
  arrowName: string;
}

/** Load a real-game run's inputs so it can be simulated as a ghost. */
export async function fetchRunInputs(runId: number): Promise<RunInputs | null> {
  try {
    const res = await fetch(`/api/runs/${encodeURIComponent(String(runId))}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      inputs?: string;
      input_count?: number;
      arrow_name?: string;
    };
    if (!data?.inputs) return null;
    return {
      inputs: data.inputs,
      inputCount: data.input_count ?? 0,
      arrowName: data.arrow_name ?? "Narrow Arrow",
    };
  } catch {
    return null;
  }
}

/**
 * Re-simulate every ticked candidate against one cached geometry, so each ghost
 * costs a single simulation rather than another geometry fetch. A real-game
 * candidate's inputs are fetched once, then kept with the simulated result.
 */
export function useCompareGhosts(
  open: boolean,
  levelData: RawLevelData | null,
  candidates: CompareCandidate[],
  selectedIds: string[],
): Record<string, SimResult> {
  const [sims, setSims] = React.useState<Record<string, SimResult>>({});
  const fetched = React.useRef<Map<number, RunInputs | null>>(new Map());

  React.useEffect(() => {
    if (!open || !levelData) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, SimResult> = {};
      for (const id of selectedIds) {
        const entry = candidates.find((c) => c.id === id);
        if (!entry) continue;
        let inputs = entry.inputs;
        let inputCount = entry.inputCount;
        let arrowName = entry.arrowName;
        if (!inputs && entry.runId != null) {
          if (!fetched.current.has(entry.runId)) {
            fetched.current.set(entry.runId, await fetchRunInputs(entry.runId));
          }
          const loaded = fetched.current.get(entry.runId);
          if (!loaded) continue;
          inputs = loaded.inputs;
          inputCount = loaded.inputCount;
          arrowName = loaded.arrowName || arrowName;
        }
        if (!inputs) continue;
        try {
          next[id] = await simulateRun(inputs, inputCount, levelData, {}, arrowName);
        } catch {
          /* a ghost that won't simulate is simply left off the stage */
        }
      }
      if (!cancelled) setSims(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, levelData, selectedIds, candidates]);

  return sims;
}

/** Ghost trail label, e.g. "TAS · OpenHands · 13.825s" or "Ch4mpY · 11.829s". */
export function ghostLabel(entry: CompareCandidate): string {
  const prefix = entry.kind === "human" ? "" : "TAS · ";
  return `${prefix}${entry.username} · ${(entry.timeMs / 1000).toFixed(3)}s`;
}
