/**
 * Storage for endless-mode scores, keyed per seed in `app_docs`.
 *
 * A score is site-owned (a run against a generated course, not a real level),
 * so it never touches the upstream leaderboard — an entry is a name, a score
 * and the input string that reproduces the run from the seed.
 */
import { supabase } from "@/integrations/supabase/client";

export interface EndlessEntry {
  id: string;
  username: string;
  /** The course seed this run was played on. */
  seed: number;
  arrowName: string;
  /** Sections passed. */
  score: number;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface EndlessBoard {
  seed: number;
  entries: EndlessEntry[];
}

const COLLECTION = "endless_boards";

/**
 * Local dev has no service-role key, so writes would fail RLS. Keep a
 * per-process board in memory there; production always uses Supabase.
 */
const memoryBoards = new Map<string, EndlessEntry[]>();
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

/** Read one seed's endless board (empty when it has never been submitted to). */
export async function readEndlessBoard(seed: string): Promise<EndlessEntry[]> {
  if (memoryStoreEnabled()) return memoryBoards.get(seed) ?? [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", seed)
      .maybeSingle();
    const board = data?.data as unknown as EndlessBoard | undefined;
    return Array.isArray(board?.entries) ? board.entries : [];
  } catch {
    return [];
  }
}

/** Public (RLS) read used by the API route so no service key is needed. */
export async function readEndlessBoardPublic(seed: string): Promise<EndlessEntry[]> {
  if (memoryStoreEnabled()) return memoryBoards.get(seed) ?? [];
  try {
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", seed)
      .maybeSingle();
    if (error) return [];
    const board = data?.data as unknown as EndlessBoard | undefined;
    return Array.isArray(board?.entries) ? board.entries : [];
  } catch {
    return [];
  }
}

/** Append a submission and return the re-sorted board. */
export async function addEndlessEntry(seed: string, entry: EndlessEntry): Promise<EndlessEntry[]> {
  const entries = sortEndlessEntries([...(await readEndlessBoard(seed)), entry]);
  if (memoryStoreEnabled()) {
    memoryBoards.set(seed, entries);
    return entries;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: seed,
      data: { seed: Number(seed), entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  return entries;
}

/** Remove one entry by id and return the re-sorted board. */
export async function removeEndlessEntry(seed: string, id: string): Promise<EndlessEntry[]> {
  const entries = sortEndlessEntries((await readEndlessBoard(seed)).filter((e) => e.id !== id));
  if (memoryStoreEnabled()) {
    memoryBoards.set(seed, entries);
    return entries;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: seed,
      data: { seed: Number(seed), entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  return entries;
}

/**
 * An endless entry without its input string, for list views that don't need to
 * replay a run (shipping a ~KB input blob per row for a score is pure egress).
 */
export type EndlessSummary = Omit<EndlessEntry, "inputs">;

export const toEndlessSummary = ({ inputs: _inputs, ...rest }: EndlessEntry): EndlessSummary =>
  rest;
