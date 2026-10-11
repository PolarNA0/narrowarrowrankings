import { createFileRoute } from "@tanstack/react-router";
import { fetchJson } from "@/lib/na-proxy";
import type { InGameMedals } from "@/types";

// The game retunes medal cutoffs periodically, so this endpoint keeps a short
// memory and refreshes in the background rather than serving a stale copy for
// long. A full sweep is one upstream request per pack (~9 total).
const FRESH_MS = 10 * 60 * 1000;

export interface InGameMedalsPayload {
  medals: Record<string, InGameMedals>;
  at: number;
}

type PackSummary = { slug?: string };

function readMedals(payload: unknown): Record<string, InGameMedals> {
  const levels = (payload as { levels?: unknown[] } | null)?.levels;
  if (!Array.isArray(levels)) return {};
  const out: Record<string, InGameMedals> = {};
  for (const raw of levels) {
    const level = raw as {
      level_id?: string;
      id?: number;
      medals?: Partial<InGameMedals> | null;
    };
    const id = level.level_id ?? (level.id !== undefined ? String(level.id) : undefined);
    const m = level.medals;
    if (!id || !m || typeof m.topTime !== "number") continue;
    out[id.toUpperCase()] = {
      bronzeTime: Number(m.bronzeTime) || 0,
      silverTime: Number(m.silverTime) || 0,
      goldTime: Number(m.goldTime) || 0,
      topTime: Number(m.topTime) || 0,
      official: Boolean(m.official),
      finisherCount: Number(m.finisherCount) || 0,
    };
  }
  return out;
}

let memo: InGameMedalsPayload | null = null;
let refreshing: Promise<void> | null = null;

async function refreshMedals(): Promise<void> {
  const packs = await fetchJson("/packs", FRESH_MS).catch(() => [] as PackSummary[]);
  const slugs = (Array.isArray(packs) ? packs : [])
    .map((p) => p.slug)
    .filter((slug): slug is string => Boolean(slug));

  const medals: Record<string, InGameMedals> = { ...(memo?.medals ?? {}) };
  await Promise.all(
    slugs.map(async (slug) => {
      try {
        Object.assign(medals, readMedals(await fetchJson(`/packs/${slug}`, FRESH_MS)));
      } catch {
        /* keep whatever we already had for this pack */
      }
    }),
  );

  memo = { medals, at: Date.now() };
}

export const Route = createFileRoute("/api/in-game-medals")({
  server: {
    handlers: {
      GET: async () => {
        const stale = !memo || Date.now() - memo.at > FRESH_MS;
        if (stale && !refreshing) {
          refreshing = refreshMedals().finally(() => {
            refreshing = null;
          });
        }
        // First ever call has nothing cached, so wait for the sweep; later calls
        // return the cached copy immediately while the refresh runs behind them.
        if (stale) await Promise.race([refreshing, new Promise((r) => setTimeout(r, 20000))]);

        const payload = memo ?? { medals: {}, at: 0 };
        return Response.json(payload, {
          headers:
            Object.keys(payload.medals).length > 0
              ? { "cache-control": "public, max-age=300, stale-while-revalidate=1800" }
              : { "cache-control": "no-store" },
        });
      },
    },
  },
});
