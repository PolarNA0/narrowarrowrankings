const API_BASE = "https://api.narrowarrow.xyz";

const cacheStore: Record<string, { data: unknown; expiresAt: number }> = {};
const inflight: Record<string, Promise<unknown>> = {};

// The upstream API rate-limits aggressively (429) when many leaderboards are
// requested at once, so all upstream calls go through a small concurrency
// queue with exponential backoff retries.
// Upstream allows 120 requests per 60s window; stay just under it.
const MAX_CONCURRENT = 6;
const MIN_GAP_MS = 520;

let active = 0;
let nextSlot = 0;
let pausedUntil = 0;
const queue: Array<() => void> = [];

/** Called on 429 so every queued request waits for the window to reset. */
function pauseAll(ms: number) {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

function schedule<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      active++;
      const slot = Math.max(Date.now(), nextSlot, pausedUntil);
      nextSlot = slot + MIN_GAP_MS;
      const wait = slot - Date.now();
      if (wait > 0) await sleep(wait);
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
  const MAX_ATTEMPTS = 4;
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      // Hung upstream sockets used to stall whole bulk loads for 90s+.
      response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      lastStatus = 504;
      await sleep(300 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    const reset = Number(response.headers.get("ratelimit-reset") ?? response.headers.get("retry-after"));
    if (response.status === 429 && Number.isFinite(reset) && reset > 0) {
      pauseAll(reset * 1000);
      if (reset > 20) break; // don't hold requests for a whole window; serve stale instead
      await sleep(reset * 1000);
    } else {
      await sleep(300 * 2 ** attempt + Math.random() * 200);
    }
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
