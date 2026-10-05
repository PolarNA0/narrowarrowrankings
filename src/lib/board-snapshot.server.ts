import type { BoardEntry } from "./leaderboard-source";

export interface BoardSnapshot {
  boards: Record<string, BoardEntry[]>;
  loaded: number;
  total: number;
  at: number;
}

const KEY = { collection: "cache", doc_id: "allLeaderboards" };

/** Persisted copy of every deep board so cold servers never hit the rate-limited API. */
export async function readSnapshot(): Promise<BoardSnapshot | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", KEY.collection)
      .eq("doc_id", KEY.doc_id)
      .maybeSingle();
    const snap = data?.data as unknown as BoardSnapshot | undefined;
    return snap?.boards ? snap : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(snap: BoardSnapshot) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("app_docs")
      .upsert({ ...KEY, data: snap as never }, { onConflict: "collection,doc_id" });
  } catch {
    /* best effort */
  }
}
