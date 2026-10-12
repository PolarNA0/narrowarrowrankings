import { createFileRoute } from "@tanstack/react-router";

const API_BASE = "https://api.narrowarrow.xyz";
const ALLOWED = /^[a-z0-9_./-]+\.(svg|png)$/i;

/**
 * Streams a cosmetic asset straight from the game API. Only image filenames are
 * allowed through so the proxy can't be pointed at arbitrary upstream paths.
 */
export const Route = createFileRoute("/api/skins/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const file = (params as { _splat?: string })._splat ?? "";
        if (!ALLOWED.test(file) || file.includes("..")) {
          return new Response("Not found", { status: 404 });
        }
        let upstream: Response;
        try {
          upstream = await fetch(`${API_BASE}/skins/${file}`, {
            signal: AbortSignal.timeout(8000),
          });
        } catch {
          return new Response("Upstream unavailable", { status: 502 });
        }
        if (!upstream.ok) return new Response("Not found", { status: upstream.status });
        return new Response(upstream.body, {
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/svg+xml",
            "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
          },
        });
      },
    },
  },
});
