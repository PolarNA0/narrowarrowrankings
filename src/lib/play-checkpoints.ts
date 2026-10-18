/**
 * Player-made practice checkpoints, bridged from a watched TAS run into the
 * Play tab.
 *
 * The Play tab already keeps live checkpoints, but they only exist inside one
 * session: rewinding needs the engine snapshot and the path taken to reach it.
 * A checkpoint saved here stores the whole prefix — the input symbols up to the
 * chosen tick — so Play can rebuild the exact pose with the real engine and
 * drop the player straight into that part of the run.
 *
 * Stored in `localStorage` (site-owned, like the Play PBs) so it works without
 * a backend and survives a reload.
 */

import { decodeInputSymbols, encodeInputSymbols } from "@/lib/replay";

export interface PlayCheckpoint {
  id: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  /** Tick the checkpoint sits at; 0 is the spawn. */
  tick: number;
  /** Tick the source run finished at, so the label can show the target. */
  sourceFinishTick: number | null;
  /** The run's full input stream, kept so the level can be re-derived/edited. */
  inputs: string;
  inputCount: number;
  /** Input symbols up to `tick`; restored as the run's prefix. */
  prefixSymbols: number[];
  label: string;
  createdAt: number;
}

export interface NewPlayCheckpoint {
  levelId: string;
  levelName: string;
  arrowName: string;
  tick: number;
  sourceFinishTick: number | null;
  inputs: string;
  inputCount: number;
  label: string;
}

const STORAGE_KEY = "naPlayCheckpoints:v1";

function read(): PlayCheckpoint[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as PlayCheckpoint[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: PlayCheckpoint[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked — the checkpoint just isn't kept */
  }
}

/** Every saved checkpoint, newest first. */
export function listPlayCheckpoints(): PlayCheckpoint[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

/** The checkpoints for one level+arrow, newest first. */
export function playCheckpointsFor(levelId: string, arrowName: string): PlayCheckpoint[] {
  return listPlayCheckpoints().filter((c) => c.levelId === levelId && c.arrowName === arrowName);
}

export function savePlayCheckpoint(entry: NewPlayCheckpoint): PlayCheckpoint {
  const all = decodeInputSymbols(entry.inputs, entry.inputCount);
  const prefixSymbols = all.slice(0, Math.max(0, Math.min(entry.tick, all.length)));
  const record: PlayCheckpoint = {
    ...entry,
    id: `${entry.levelId}:${entry.arrowName}:${entry.tick}:${Date.now()}`,
    prefixSymbols,
    createdAt: Date.now(),
  };
  // Replacing the same tick on the same level+arrow keeps the list tidy.
  const kept = read().filter(
    (c) =>
      !(c.levelId === entry.levelId && c.arrowName === entry.arrowName && c.tick === entry.tick),
  );
  write([record, ...kept]);
  return record;
}

export function deletePlayCheckpoint(id: string) {
  write(read().filter((c) => c.id !== id));
}

/** The checkpoint's prefix re-encoded as an input string Play can replay. */
export function checkpointInputs(cp: PlayCheckpoint): { inputs: string; inputCount: number } {
  return { inputs: encodeInputSymbols(cp.prefixSymbols), inputCount: cp.prefixSymbols.length };
}
