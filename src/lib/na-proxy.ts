const API_BASE = "https://api.narrowarrow.xyz";

const cacheStore: Record<string, { data: unknown; expiresAt: number }> = {};
const inflight: Record<string, Promise<unknown>> = {};

// The upstream API rate-limits aggressively (429) when many leaderboards are
// requested at once, so all upstream calls go through a small concurrency
// queue with exponential backoff retries.
const MAX_CONCURRENT = 20;
const MIN_GAP_MS = 20;

let active = 0;
let lastStart = 0;
const queue: Array<() => void> = [];

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      active++;
      const wait = Math.max(0, lastStart + MIN_GAP_MS - Date.now());
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        active--;
        const next = queue.shift();
        if (next) next();
      }
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string): Promise<unknown> {
  const MAX_ATTEMPTS = 7;
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 400 * 2 ** attempt + Math.random() * 250;
    await sleep(Math.min(delay, 6000));
  }
  throw Object.assign(new Error(`Upstream request failed with status ${lastStatus}`), {
    status: lastStatus,
  });
}

/** Cached, queued upstream GET that returns parsed JSON (server-side use). */
export async function fetchJson(path: string, ttlMs: number): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const cached = cacheStore[url];
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const request =
    inflight[url] ??
    (inflight[url] = schedule(() => fetchWithRetry(url)).finally(() => {
      delete inflight[url];
    }));
  try {
    const data = await request;
    cacheStore[url] = { data, expiresAt: Date.now() + ttlMs };
    return data;
  } catch (error) {
    if (cached) return cached.data;
    throw error;
  }
}

export async function proxyJson(path: string, ttlMs: number): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const now = Date.now();
  const cached = cacheStore[url];
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.data);
  }

  try {
    const request =
      inflight[url] ??
      (inflight[url] = schedule(() => fetchWithRetry(url)).finally(() => {
        delete inflight[url];
      }));
    const data = await request;
    cacheStore[url] = { data, expiresAt: Date.now() + ttlMs };
    return Response.json(data);
  } catch (error) {
    // Serve stale data rather than failing the UI when upstream is throttling.
    if (cached) return Response.json(cached.data);
    console.error("Narrow Arrow proxy error:", path, error);
    const status = (error as { status?: number }).status;
    return Response.json(
      { error: `Upstream request failed${status ? ` with status ${status}` : ""}` },
      { status: 502 },
    );
  }
}

export function queryString(request: Request): string {
  const qs = new URL(request.url).searchParams.toString();
  return qs ? `&${qs}` : "";
}

export function rawQueryString(request: Request): string {
  return new URL(request.url).searchParams.toString();
}
