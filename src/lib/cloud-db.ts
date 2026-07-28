/**
 * Firestore-compatible shim backed by Lovable Cloud (table: public.app_docs).
 *
 * Keeps the original Firestore call-sites (`collection`, `doc`, `getDoc`,
 * `getDocs`, `setDoc`, `deleteDoc`, `onSnapshot`, `serverTimestamp`) working
 * while the data actually lives in Postgres with realtime updates.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DocData = Record<string, any>;

export interface CollectionRef {
  type: "collection";
  collection: string;
}

export interface DocRef {
  type: "doc";
  collection: string;
  id: string;
}

export interface DocSnapshot {
  id: string;
  exists: () => boolean;
  data: () => DocData | undefined;
}

export interface QuerySnapshot {
  docs: DocSnapshot[];
  size: number;
  empty: boolean;
  forEach: (cb: (doc: DocSnapshot) => void) => void;
}

// Kept so existing `collection(db, "x")` / `doc(db, "x", id)` calls compile.
export const db = { name: "lovable-cloud" } as const;

export function collection(_db: unknown, name: string): CollectionRef {
  return { type: "collection", collection: name };
}

export function doc(_db: unknown, name: string, id: string): DocRef {
  return { type: "doc", collection: name, id };
}

export function serverTimestamp(): string {
  return new Date().toISOString();
}

function snapshotOf(id: string, data: DocData | null | undefined): DocSnapshot {
  return {
    id,
    exists: () => data != null,
    data: () => (data ?? undefined) as DocData | undefined,
  };
}

function querySnapshotOf(rows: Array<{ doc_id: string; data: unknown }>): QuerySnapshot {
  const docs = rows.map((row) => snapshotOf(row.doc_id, (row.data ?? {}) as DocData));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach: (cb) => docs.forEach(cb),
  };
}

export async function getDocs(ref: CollectionRef): Promise<QuerySnapshot> {
  const { data, error } = await supabase
    .from("app_docs")
    .select("doc_id, data")
    .eq("collection", ref.collection);
  if (error) throw new Error(error.message);
  return querySnapshotOf(data ?? []);
}

export async function getDoc(ref: DocRef): Promise<DocSnapshot> {
  const { data, error } = await supabase
    .from("app_docs")
    .select("data")
    .eq("collection", ref.collection)
    .eq("doc_id", ref.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return snapshotOf(ref.id, (data?.data ?? null) as DocData | null);
}

export async function setDoc(
  ref: DocRef,
  value: DocData,
  options?: { merge?: boolean },
): Promise<void> {
  let payload = value;
  if (options?.merge) {
    const existing = await getDoc(ref);
    payload = { ...(existing.data() ?? {}), ...value };
  }
  const { error } = await supabase
    .from("app_docs")
    .upsert(
      {
        collection: ref.collection,
        doc_id: ref.id,
        data: payload as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "collection,doc_id" },
    );
  if (error) throw new Error(error.message);
}

export async function deleteDoc(ref: DocRef): Promise<void> {
  const { error } = await supabase
    .from("app_docs")
    .delete()
    .eq("collection", ref.collection)
    .eq("doc_id", ref.id);
  if (error) throw new Error(error.message);
}

type Unsubscribe = () => void;

/** Realtime listener; mirrors the Firestore `onSnapshot` signature we used. */
export function onSnapshot(
  ref: CollectionRef,
  next: (snapshot: QuerySnapshot) => void,
  onError?: (error: Error) => void,
): Unsubscribe;
export function onSnapshot(
  ref: DocRef,
  next: (snapshot: DocSnapshot) => void,
  onError?: (error: Error) => void,
): Unsubscribe;
export function onSnapshot(
  ref: CollectionRef | DocRef,
  next: (snapshot: never) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  let cancelled = false;

  const load = async () => {
    try {
      const snapshot =
        ref.type === "collection" ? await getDocs(ref) : await getDoc(ref);
      if (!cancelled) next(snapshot as never);
    } catch (error) {
      if (!cancelled) onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  void load();

  const channel = supabase
    .channel(`app_docs:${ref.collection}:${ref.type === "doc" ? ref.id : "all"}:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "app_docs",
        filter: `collection=eq.${ref.collection}`,
      },
      () => {
        void load();
      },
    )
    .subscribe();

  return () => {
    cancelled = true;
    void supabase.removeChannel(channel);
  };
}

// Legacy diagnostics helpers kept for existing call-sites.
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Database error:", { operationType, path, message });
  throw new Error(message);
}
