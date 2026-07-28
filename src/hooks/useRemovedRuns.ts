import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, db } from "../lib/cloud-db";
import { removedRunDocId, removedRunKey, type RemovedRun } from "../lib/removedRuns";

export function useRemovedRuns() {
  const [removedRuns, setRemovedRuns] = useState<RemovedRun[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "removedRuns"),
      (snapshot) => {
        const rows: RemovedRun[] = [];
        snapshot.forEach((d) => rows.push({ id: d.id, ...(d.data() as Omit<RemovedRun, "id">) }));
        setRemovedRuns(rows);
      },
      (err) => console.error("Error loading removed runs:", err),
    );
    return unsub;
  }, []);

  const removedKeys = useMemo(
    () => new Set(removedRuns.map((r) => removedRunKey(r.levelId, r.username, r.completionTime))),
    [removedRuns],
  );

  return { removedRuns, removedKeys };
}

export async function removeRun(params: {
  levelId: string;
  username: string;
  completionTime: number;
  reason?: string;
  removedBy?: string | null;
}) {
  const id = removedRunDocId(params.levelId, params.username, params.completionTime);
  await setDoc(doc(db, "removedRuns", id), {
    levelId: params.levelId,
    username: params.username,
    completionTime: params.completionTime,
    reason: params.reason || "",
    removedBy: params.removedBy || "",
    removedAt: serverTimestamp(),
  });
}

export async function restoreRun(id: string) {
  await deleteDoc(doc(db, "removedRuns", id));
}
