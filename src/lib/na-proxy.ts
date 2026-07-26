const API_BASE = "https://api.narrowarrow.xyz";

const cacheStore: Record<string, { data: unknown; expiresAt: number }> = {};

export async function proxyJson(path: string, ttlMs: number): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const now = Date.now();
  const cached = cacheStore[url];
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.data);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return Response.json(
        { error: `Upstream request failed with status ${response.status}` },
        { status: 502 },
      );
    }
    const data = await response.json();
    cacheStore[url] = { data, expiresAt: now + ttlMs };
    return Response.json(data);
  } catch (error) {
    console.error("Narrow Arrow proxy error:", path, error);
    return Response.json({ error: "Upstream request failed" }, { status: 502 });
  }
}

export function queryString(request: Request): string {
  const qs = new URL(request.url).searchParams.toString();
  return qs ? `&${qs}` : "";
}

export function rawQueryString(request: Request): string {
  return new URL(request.url).searchParams.toString();
}
