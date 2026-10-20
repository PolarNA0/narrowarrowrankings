/**
 * Storage for endless-mode scores in `app_docs`.
 *
 * There is one global board: the score is sections survived, which is a measure
 * of the player, not of any particular course. The seed a run was played on is
 * kept on the entry for reference (and to reproduce it) but does not split the
 * board.
 *
 * A score is site-owned (a run against a generated course, not a real level),
 * so it never touches the upstream leaderboard.
 */
import { supabase } from "@/integrations/supabase/client";

export interface EndlessEntry {
  id: string;
  username: string;
  /** The course seed this run was played on (informational). */
  seed: number;
  arrowName: string;
  /** Sections passed. */
  score: number;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface EndlessBoard {
  entries: EndlessEntry[];
}

const COLLECTION = "endless_boards";
/** The single global board's doc id. */
const DOC_ID = "global";

/**
 * Local dev has no service-role key, so writes would fail RLS. Keep a
 * per-process board in memory there; production always uses Supabase.
 */
let memoryBoard: EndlessEntry[] = [];
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Highest score first; ties broken by who got there first. */
export function sortEndlessEntries(entries: EndlessEntry[]): EndlessEntry[] {
  return [...entries].sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
}

export function isNewEndlessRecord(entries: EndlessEntry[], score: number): boolean {
  const best = entries.reduce<number | null>(
    (acc, e) => (acc === null || e.score > acc ? e.score : acc),
    null,
  );
  return best === null || score > best;
}

/**
 * A submission must be a distinct run: copying an existing entry's exact input
 * string would let everyone post the same line, so it is rejected.
 */
export function hasDuplicateInputs(entries: EndlessEntry[], inputs: string): boolean {
  return entries.some((e) => e.inputs === inputs);
}

async function write(entries: EndlessEntry[]): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: DOC_ID,
      data: { entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
}

/** Read the global board (empty when it has never been submitted to). */
export async function readEndlessBoard(): Promise<EndlessEntry[]> {
  if (memoryStoreEnabled()) return memoryBoard;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", DOC_ID)
      .maybeSingle();
    const board = data?.data as unknown as EndlessBoard | undefined;
    return Array.isArray(board?.entries) ? board.entries : [];
  } catch {
    return [];
  }
}

/** Public (RLS) read used by the API route so no service key is needed. */
export async function readEndlessBoardPublic(): Promise<EndlessEntry[]> {
  if (memoryStoreEnabled()) return memoryBoard;
  try {
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", DOC_ID)
      .maybeSingle();
    if (error) return [];
    const board = data?.data as unknown as EndlessBoard | undefined;
    return Array.isArray(board?.entries) ? board.entries : [];
  } catch {
    return [];
  }
}

/** Append a submission and return the re-sorted board. */
export async function addEndlessEntry(entry: EndlessEntry): Promise<EndlessEntry[]> {
  const entries = sortEndlessEntries([...(await readEndlessBoard()), entry]);
  if (memoryStoreEnabled()) {
    memoryBoard = entries;
    return entries;
  }
  await write(entries);
  return entries;
}

/** Remove one entry by id and return the re-sorted board. */
export async function removeEndlessEntry(id: string): Promise<EndlessEntry[]> {
  const entries = sortEndlessEntries((await readEndlessBoard()).filter((e) => e.id !== id));
  if (memoryStoreEnabled()) {
    memoryBoard = entries;
    return entries;
  }
  await write(entries);
  return entries;
}

/**
 * An endless entry without its input string, for list views that don't need to
 * replay a run (shipping a ~KB input blob per row for a score is pure egress).
 */
export type EndlessSummary = Omit<EndlessEntry, "inputs">;

export const toEndlessSummary = ({ inputs: _inputs, ...rest }: EndlessEntry): EndlessSummary => rest;
