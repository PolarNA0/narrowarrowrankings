import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

/**
 * The canonical public origin, used when a request arrives without proxy
 * headers (local dev, direct hits). Override with `SITE_URL` on the host.
 */
const FALLBACK_ORIGIN = "https://narrowarrowrankings.lovable.app";

/**
 * Resolve the origin a crawler actually reached us on. Behind a proxy the
 * request URL is the internal one (`http://localhost:3000`), so the forwarded
 * headers win — otherwise every `<loc>` points at localhost and the sitemap
 * is rejected as invalid.
 */
function resolveOrigin(request: Request): string {
  const env = typeof process !== "undefined" ? process.env?.SITE_URL : undefined;
  if (env) return env.replace(/\/+$/, "");

  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  if (!host) return FALLBACK_ORIGIN;
  return `${proto}://${host}`;
}

interface SitemapEntry {
  path: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = resolveOrigin(request);
        const entries: SitemapEntry[] = [{ path: "/", changefreq: "daily", priority: "1.0" }];

        const urls = entries.map((e) =>
          [
            `  <url>`,
            `    <loc>${origin}${e.path}</loc>`,
            e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
