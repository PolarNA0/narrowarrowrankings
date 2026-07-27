export interface RemovedRun {
  id: string;
  levelId: string;
  username: string;
  completionTime: number;
  reason?: string;
  removedAt?: string;
  removedBy?: string;
}

/** Stable key for a run that survives run_id churn from the upstream API. */
export function removedRunKey(levelId: string, username: string, completionTime: number) {
  return `${levelId}::${username.toLowerCase()}::${Number(completionTime).toFixed(3)}`;
}

/** Firestore-safe document id derived from the run key. */
export function removedRunDocId(levelId: string, username: string, completionTime: number) {
  return removedRunKey(levelId, username, completionTime)
    .replace(/[/\\.#$[\]]/g, "_")
    .slice(0, 480);
}
