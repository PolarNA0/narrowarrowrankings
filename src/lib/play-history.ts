/**
 * Local run history for the Play tab, plus the player name used for uploads.
 *
 * Play already keeps one personal best per level+arrow, but a finished run
 * otherwise vanished the moment the run was restarted — so a good run that was
 * not submitted in time was simply lost. This keeps a bounded log of finished
 * runs (with their inputs, so a run can be raced back as the ghost) and the
 * outcome of any automatic upload, so a failed upload can be retried later
 * instead of replayed.
 *
 * Stored in `localStorage` (site-owned, like the Play PBs) so it works without a
 * backend.
 */

export interface PlayUploadOutcome {
  kind: "site" | "tas";
  status: "pending" | "ok" | "duplicate" | "error";
  rank?: number;
  isRecord?: boolean;
  message?: string;
}

export interface PlayHistoryEntry {
  id: string;
  levelId: string;
  levelName: string;
  arrowName: string;
  /** Finish tick, or the crash tick when `finished` is false. */
  tick: number;
  timeMs: number;
  speed: number;
  finished: boolean;
  /** True only when the run was at 1× throughout (a verified speedrun). */
  realTime: boolean;
  inputs: string;
  inputCount: number;
  /** True when this run was (or became) the local personal best. */
  isPb: boolean;
  createdAt: number;
  /** The automatic upload's result, once it has been attempted. */
  upload?: PlayUploadOutcome;
}

export type NewPlayHistoryEntry = Omit<PlayHistoryEntry, "id" | "createdAt" | "isPb"> & {
  isPb?: boolean;
};

const HISTORY_KEY = "naPlayHistory:v1";
const NAME_KEY = "naPlayName";
const AUTO_UPLOAD_KEY = "naPlayAutoUpload";

/** Keep the log short: each entry carries its full input stream. */
const HISTORY_LIMIT = 50;

function read(): PlayHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as PlayHistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: PlayHistoryEntry[]) {
  // Input streams make entries large, so a full log can outgrow the storage
  // quota. Shed the oldest entries until it fits rather than losing the log.
  let kept = list.slice(0, HISTORY_LIMIT);
  while (kept.length > 0) {
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(kept));
      return;
    } catch {
      kept = kept.slice(0, Math.floor(kept.length / 2));
    }
  }
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* storage blocked — nothing more to do */
  }
}

/** Every recorded run, newest first. */
export function listPlayHistory(): PlayHistoryEntry[] {
  return read().sort((a, b) => b.createdAt - a.createdAt);
}

/** The recorded runs for one level+arrow, newest first. */
export function playHistoryFor(levelId: string, arrowName: string): PlayHistoryEntry[] {
  return listPlayHistory().filter((e) => e.levelId === levelId && e.arrowName === arrowName);
}

/** Prepend a finished run to the log and return the stored entry. */
export function addPlayHistory(entry: NewPlayHistoryEntry): PlayHistoryEntry {
  const record: PlayHistoryEntry = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    isPb: entry.isPb ?? false,
    createdAt: Date.now(),
  };
  write([record, ...read()]);
  return record;
}

/** Attach an upload outcome to an already-recorded run. */
export function setPlayHistoryUpload(id: string, upload: PlayUploadOutcome) {
  write(read().map((e) => (e.id === id ? { ...e, upload } : e)));
}

/** Drop every recorded run. */
export function clearPlayHistory() {
  write([]);
}

/** The name this browser last uploaded under, or "" if never set. */
export function loadPlayerName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePlayerName(name: string) {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage blocked — the name just isn't remembered */
  }
}

/** Whether finished runs upload themselves. On by default. */
export function loadAutoUpload(): boolean {
  try {
    return window.localStorage.getItem(AUTO_UPLOAD_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAutoUpload(on: boolean) {
  try {
    window.localStorage.setItem(AUTO_UPLOAD_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked — the choice just isn't remembered */
  }
}
