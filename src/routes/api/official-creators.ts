import { createFileRoute } from "@tanstack/react-router";
import { fetchJson } from "@/lib/na-proxy";
import { LEVEL_PACKS } from "@/constants";

const TTL = 60 * 60 * 1000;

/** Creators credited on the official packs — used for the "Official Creator" badge. */
export const Route = createFileRoute("/api/official-creators")({
  server: {
    handlers: {
      GET: async () => {
        const creators = new Set<string>();
        await Promise.all(
          LEVEL_PACKS.map(async (pack) => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const data = (await fetchJson(`/packs/${pack.id}`, TTL)) as any;
              for (const name of data?.creators ?? []) {
                if (typeof name === "string" && name.trim()) creators.add(name.trim());
              }
              for (const level of data?.levels ?? []) {
                const name = level?.creator_name ?? level?.author ?? level?.username;
                if (typeof name === "string" && name.trim()) creators.add(name.trim());
              }
            } catch {
              /* a missing pack simply contributes no creators */
            }
          }),
        );
        return Response.json(
          { creators: [...creators] },
          { headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" } },
        );
      },
    },
  },
});
