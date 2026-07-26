import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const App = lazy(() => import("@/App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Narrow Arrow Rankings — Leaderboards & Player Ranks" },
      {
        name: "description",
        content:
          "Live Narrow Arrow leaderboards, player profiles, rank assignments, comparisons and custom level browsing.",
      },
      { property: "og:title", content: "Narrow Arrow Rankings — Leaderboards & Player Ranks" },
      {
        property: "og:description",
        content:
          "Live Narrow Arrow leaderboards, player profiles, rank assignments, comparisons and custom level browsing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      Loading rankings…
    </div>
  );
}

function Index() {
  return (
    <ClientOnly fallback={<Loading />}>
      <Suspense fallback={<Loading />}>
        <App />
      </Suspense>
    </ClientOnly>
  );
}
