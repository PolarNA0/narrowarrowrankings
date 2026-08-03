import { useCallback, useEffect, useRef, useState } from "react";

export interface ProfileSummary {
  username: string;
  found: boolean;
  customCompleted: number;
  customMedals: { first?: number; second?: number; third?: number; top10?: number };
  officialMedals: { first?: number; second?: number; third?: number; top10?: number };
  packMedals: { first?: number; second?: number; third?: number; top10?: number };
  mapsCompleted: number;
  totalRuns: number;
  league: string | null;
  trophies: number;
  levelsPublished: number;
  totalLikes: number;
  totalPlays: number;
  joined: string | null;
  bio: string | null;
  dailyBestFinish: number | null;
}

const CHUNK = 40;
const PARALLEL = 6;
const STORAGE_KEY = "naProfileSummaries";
const STORAGE_TTL = 60 * 60 * 1000;

function readCache(): Record<string, ProfileSummary> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { timestamp: number; profiles: Record<string, ProfileSummary> };
    if (!parsed?.profiles || Date.now() - parsed.timestamp > STORAGE_TTL) return {};
    return parsed.profiles;
  } catch {
    return {};
  }
}

function writeCache(profiles: Record<string, ProfileSummary>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: Date.now(), profiles }));
  } catch {
    /* best effort */
  }
}

/**
 * Loads game profile summaries for a roster of usernames, streaming results in
 * as they arrive and caching them locally for an hour.
 */
export function useProfileSummaries(usernames: string[], enabled: boolean) {
  const [profiles, setProfiles] = useState<Record<string, ProfileSummary>>({});
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const runId = useRef(0);

  const run = useCallback(
    async (names: string[], force: boolean) => {
      const id = ++runId.current;
      const cached = force ? {} : readCache();
      const store: Record<string, ProfileSummary> = { ...cached };
      const pending = names.filter((n) => !store[n.toLowerCase()]);

      setProfiles({ ...store });
      setTotal(names.length);
      setLoaded(names.length - pending.length);
      if (pending.length === 0) {
        setRunning(false);
        return;
      }
      setRunning(true);

      const chunks: string[][] = [];
      for (let i = 0; i < pending.length; i += CHUNK) chunks.push(pending.slice(i, i + CHUNK));

      let cursor = 0;
      const worker = async () => {
        while (cursor < chunks.length) {
          if (id !== runId.current) return;
          const chunk = chunks[cursor++];
          try {
            const res = await fetch(`/api/profiles?users=${chunk.map(encodeURIComponent).join(",")}`);
            if (res.ok) {
              const payload = (await res.json()) as { profiles: ProfileSummary[] };
              for (const profile of payload.profiles ?? []) {
                store[profile.username.toLowerCase()] = profile;
              }
            }
          } catch (error) {
            console.error("profile chunk failed", error);
          }
          if (id !== runId.current) return;
          setProfiles({ ...store });
          setLoaded(names.filter((n) => store[n.toLowerCase()]).length);
        }
      };

      await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, worker));
      if (id !== runId.current) return;
      writeCache(store);
      setRunning(false);
    },
    [],
  );

  const key = usernames.join("|");
  useEffect(() => {
    if (!enabled || usernames.length === 0) return;
    void run(usernames, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, run]);

  const refresh = useCallback(() => run(usernames, true), [run, usernames]);

  return { profiles, loaded, total, running, refresh };
}

/** Single profile summary (used for badges). */
export function useProfileSummary(username?: string | null) {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  useEffect(() => {
    if (!username) return;
    let alive = true;
    fetch(`/api/profiles?users=${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (alive && payload?.profiles?.[0]) setProfile(payload.profiles[0] as ProfileSummary);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [username]);
  return profile;
}

/** Creators credited on the official packs. */
export function useOfficialCreators() {
  const [creators, setCreators] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    fetch("/api/official-creators")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (alive && payload?.creators) {
          setCreators(new Set((payload.creators as string[]).map((c) => c.toLowerCase())));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return creators;
}
