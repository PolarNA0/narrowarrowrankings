/**
 * Undo/redo history for the TAS editor's input list.
 *
 * Every edit (grow/shrink a hold, insert, delete, set a tick, paste, import)
 * used to be final — the only recovery was to reload the run and start over.
 * This keeps a bounded stack of past and future snapshots of the symbol array.
 *
 * Snapshots are the whole array rather than diffs: a run is a few thousand
 * small integers, the stack is capped, and a whole-array snapshot cannot
 * desync the way an inverse-operation log can.
 */
import * as React from "react";

/** How many edits can be stepped back. Generous, but bounded so a long session cannot grow forever. */
const HISTORY_LIMIT = 100;

export interface TasHistory {
  /** Push the state *before* an edit. Call with the pre-edit symbols. */
  record: (before: number[]) => void;
  /** Step back one edit; hand in the current symbols so they can be redone. */
  undo: (current: number[]) => number[] | null;
  /** Step forward again; hand in the current symbols so they can be undone. */
  redo: (current: number[]) => number[] | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Drop all history, e.g. when a different run is loaded. */
  reset: () => void;
  /** How many edits can be undone, for the UI. */
  depth: number;
}

export function useTasHistory(): TasHistory {
  // Counts are mirrored into state so the flags recompute without reading a ref
  // during render; the arrays themselves stay in refs (mutating them must not
  // re-render mid-edit).
  const past = React.useRef<number[][]>([]);
  const future = React.useRef<number[][]>([]);
  const [counts, setCounts] = React.useState({ past: 0, future: 0 });

  const sync = React.useCallback(() => {
    setCounts({ past: past.current.length, future: future.current.length });
  }, []);

  const record = React.useCallback(
    (before: number[]) => {
      past.current.push(before.slice());
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
      // A fresh edit invalidates any redo branch, as in every editor.
      future.current = [];
      sync();
    },
    [sync],
  );

  const undo = React.useCallback(
    (current: number[]): number[] | null => {
      const prev = past.current.pop();
      if (!prev) return null;
      future.current.push(current.slice());
      sync();
      return prev;
    },
    [sync],
  );

  const redo = React.useCallback(
    (current: number[]): number[] | null => {
      const next = future.current.pop();
      if (!next) return null;
      past.current.push(current.slice());
      sync();
      return next;
    },
    [sync],
  );

  const reset = React.useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  // A stable object: the editor passes these handlers into memoised rows, so a
  // fresh identity each render would defeat the memoisation.
  return React.useMemo(
    () => ({
      record,
      undo,
      redo,
      canUndo: counts.past > 0,
      canRedo: counts.future > 0,
      reset,
      depth: counts.past,
    }),
    [record, undo, redo, reset, counts],
  );
}
