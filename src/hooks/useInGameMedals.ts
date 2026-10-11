import { useEffect, useState } from "react";
import type { InGameMedals } from "@/types";

const STORAGE_KEY = "naInGameMedals";
// Medal cutoffs are retuned by the game from time to time, so the client copy
// is refreshed well within the server's own freshness window.
const CLIENT_TTL = 30 * 60 * 1000;

interface CachedMedals {
  timestamp: number;
  medals: Record<string, InGameMedals>;
}

function readCache(): Record<string, InGameMedals> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CachedMedals;
    if (!parsed?.medals) return {};
    return parsed.medals;
  } catch {
    return {};
  }
}

function cacheAge(): number {
  if (typeof window === "undefined") return Infinity;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return Infinity;
    return Date.now() - (JSON.parse(raw) as CachedMedals).timestamp;
  } catch {
    return Infinity;
  }
}

function writeCache(medals: Record<string, InGameMedals>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ timestamp: Date.now(), medals } satisfies CachedMedals),
    );
  } catch {
    /* best effort */
  }
}

/**
 * In-game medal thresholds for every official level, keyed by uppercased level
 * id. Cached locally and revalidated so the popups track the game's updates.
 */
export function useInGameMedals() {
  const [medals, setMedals] = useState<Record<string, InGameMedals>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const cached = readCache();
    if (Object.keys(cached).length > 0) setMedals(cached);
    const fresh = Object.keys(cached).length > 0 && cacheAge() < CLIENT_TTL;
    if (fresh) setLoading(false);

    fetch("/api/in-game-medals")
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: { medals?: Record<string, InGameMedals> } | null) => {
        if (!alive) return;
        const next = payload?.medals ?? {};
        if (Object.keys(next).length > 0) {
          setMedals(next);
          writeCache(next);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return { medals, loading };
}
