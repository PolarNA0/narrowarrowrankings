import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import {
  CANONICAL_ORIGIN,
  OG_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
} from "@/lib/site-meta";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { name: "robots", content: "index, follow" },
      { name: "theme-color", content: "#0b0f19" },

      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:url", content: CANONICAL_ORIGIN + "/" },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:alt", content: SITE_TITLE },

      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "canonical", href: CANONICAL_ORIGIN + "/" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // The default theme is dark; tag the shell so the semantic tokens resolve to
    // the dark palette before the client settings effect runs (otherwise the
    // server HTML paints light and flashes on every load).
    <html lang="en" className="dark" data-tone="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {/*
          The app is client-only, so without this the served HTML contains no
          heading and no description — a crawler (or anyone with JS off) saw the
          bare word "Loading…". This block gives the page a real h1 and an
          accessible summary.

          It is removed once React has mounted: the app header already renders
          an <h1>, and leaving both in place made the hydrated page ship two of
          them. Server HTML keeps the crawler-facing copy; the live page keeps
          the real header.
        */}
        <ServerOnlyIntro />
        <noscript>
          <div
            style={{
              maxWidth: "40rem",
              margin: "4rem auto",
              padding: "0 1.5rem",
              fontFamily: "system-ui, sans-serif",
              lineHeight: 1.6,
            }}
          >
            <p style={{ fontSize: "1.5rem", fontWeight: 700 }}>{SITE_TITLE}</p>
            <p>{SITE_DESCRIPTION}</p>
            <p>
              This site needs JavaScript for its interactive leaderboards and replay viewer. Please
              enable it to continue.
            </p>
          </div>
        </noscript>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function ServerOnlyIntro() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (mounted) return null;
  return (
    <div className="sr-only">
      <h1>{SITE_TITLE}</h1>
      <p>{SITE_DESCRIPTION}</p>
      <p>
        Browse every Narrow Arrow pack and community level, watch replays of the fastest runs,
        follow player rankings, and inspect tool-assisted runs on the community TAS board.
      </p>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster position="top-right" richColors theme="dark" />
    </QueryClientProvider>
  );
}
