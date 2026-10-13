/**
 * Storage for community TAS submissions, keyed per level in `app_docs`.
 *
 * These are site-owned records (tool-assisted runs the real game would reject),
 * so they never touch the upstream leaderboard — a submission here is just a
 * name, a time and the input string that reproduces it.
 */
import { supabase } from "@/integrations/supabase/client";

export interface TasEntry {
  id: string;
  username: string;
  timeMs: number;
  arrowName: string;
  inputCount: number;
  inputs: string;
  createdAt: string;
}

export interface TasBoard {
  levelId: string;
  entries: TasEntry[];
}

const COLLECTION = "tas_boards";

/**
 * Local dev has no service-role key, so writes would fail RLS. Keep a
 * per-process board in memory there; production always uses Supabase.
 */
const memoryBoards = new Map<string, TasEntry[]>();
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Best (lowest) time first; ties broken by who got there first. */
export function sortTasEntries(entries: TasEntry[]): TasEntry[] {
  return [...entries].sort((a, b) => a.timeMs - b.timeMs || a.createdAt.localeCompare(b.createdAt));
}

export function isNewTasRecord(entries: TasEntry[], timeMs: number): boolean {
  const best = entries.reduce<number | null>(
    (acc, e) => (acc === null || e.timeMs < acc ? e.timeMs : acc),
    null,
  );
  return best === null || timeMs < best;
}

/**
 * A submission must be a distinct run. Copying an existing entry's exact input
 * string — most obviously the WR — would let everyone post the same run, so it
 * is rejected. Compared on the raw string to keep it exact.
 */
export function hasDuplicateInputs(entries: TasEntry[], inputs: string): boolean {
  return entries.some((e) => e.inputs === inputs);
}

/**
 * Removing a run is destructive and must not be reachable by anyone who can
 * guess an id, so the API re-checks the caller's admin role server-side rather
 * than trusting the client that hid the button.
 */
export async function verifyAdminRequest(request: Request): Promise<boolean> {
  // The dev in-memory board is process-local and there is no admin login in
  // local dev (no service role key), so removal can't be gated there.
  if (memoryStoreEnabled()) return true;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return false;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!role;
  } catch {
    return false;
  }
}

/** Remove one entry by id and return the re-sorted board. */
export async function removeTasEntry(levelId: string, id: string): Promise<TasEntry[]> {
  const entries = sortTasEntries((await readTasBoard(levelId)).filter((e) => e.id !== id));
  if (memoryStoreEnabled()) {
    memoryBoards.set(levelId, entries);
    return entries;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: levelId,
      data: { levelId, entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  return entries;
}

/** Read one level's TAS board (empty when it has never been submitted to). */
export async function readTasBoard(levelId: string): Promise<TasEntry[]> {
  if (memoryStoreEnabled()) return memoryBoards.get(levelId) ?? [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", levelId)
      .maybeSingle();
    const board = data?.data as unknown as TasBoard | undefined;
    return Array.isArray(board?.entries) ? board.entries : [];
  } catch {
    return [];
  }
}

/** Append a submission and return the re-sorted board. */
export async function addTasEntry(levelId: string, entry: TasEntry): Promise<TasEntry[]> {
  const entries = sortTasEntries([...(await readTasBoard(levelId)), entry]);
  if (memoryStoreEnabled()) {
    memoryBoards.set(levelId, entries);
    return entries;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: COLLECTION,
      doc_id: levelId,
      data: { levelId, entries } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
  return entries;
}

/** Public (RLS) read used by the API route so no service key is needed. */
export async function readTasBoardPublic(levelId: string): Promise<TasEntry[]> {
  if (memoryStoreEnabled()) return memoryBoards.get(levelId) ?? [];
  try {
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", levelId)
      .maybeSingle();
    if (error) return [];
    const board = data?.data as unknown as TasBoard | undefined;
    return Array.isArray(board?.entries) ? board.entries : [];
  } catch {
    return [];
  }
}
