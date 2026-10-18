/**
 * Local draft persistence for the TAS editor.
 *
 * The editor keeps a run only in component state, so a reload, a tab close or
 * an accidental navigation threw away a run someone may have spent an hour on.
 * A draft is mirrored into `localStorage` (debounced by the caller) and offered
 * back on the next visit, so work survives a refresh without a server round
 * trip. Nothing here touches the TAS board — a draft is private until it is
 * submitted.
 */

const DRAFT_KEY = "na-tas-draft";
const NAME_KEY = "na-tas-name";

/** The in-progress run, as stored between visits. */
export interface TasDraft {
  levelId: string;
  arrowName: string;
  /** The run's symbols; empty when only a level was opened. */
  symbols: number[];
  /** The upstream run the draft was seeded from, when it was. */
  runId: string;
  /** When the draft was last written, so the banner can say how old it is. */
  savedAt: number;
}

/** `localStorage` can throw (private mode, disabled storage); never let it break the editor. */
function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the saved draft, or null when there is none. A draft with no inputs is
 * still meaningful (someone opened a level and is about to build), so an empty
 * `symbols` array is kept rather than treated as absent.
 */
export function readTasDraft(): TasDraft | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TasDraft>;
    if (!parsed || typeof parsed.levelId !== "string") return null;
    const symbols = Array.isArray(parsed.symbols)
      ? parsed.symbols.filter((s): s is number => Number.isInteger(s) && s >= 0 && s <= 3)
      : [];
    return {
      levelId: parsed.levelId,
      arrowName: typeof parsed.arrowName === "string" ? parsed.arrowName : "",
      symbols,
      runId: typeof parsed.runId === "string" ? parsed.runId : "",
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function writeTasDraft(draft: TasDraft): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* a full or unavailable store must not interrupt editing */
  }
}

export function clearTasDraft(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The name a submitter used last time. The submit dialog asked for it on every
 * submission; most people post under one name, so it is remembered and
 * prefilled (still editable).
 */
export function readSubmitterName(): string {
  const store = safeStorage();
  if (!store) return "";
  try {
    return store.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeSubmitterName(name: string): void {
  const store = safeStorage();
  if (!store) return;
  try {
    if (name) store.setItem(NAME_KEY, name);
    else store.removeItem(NAME_KEY);
  } catch {
    /* ignore */
  }
}

/** "just now" / "4 minutes ago" / "3 days ago", for the restore banner. */
export function describeAge(savedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
