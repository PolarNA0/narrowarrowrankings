import { createFileRoute } from "@tanstack/react-router";
import {
  deleteCampaign,
  listCampaigns,
  parseCampaign,
  readCampaign,
  saveCampaign,
  clearStandingsMemo,
} from "@/lib/campaign.server";
import { verifyAdminRequest } from "@/lib/tas-board.server";

export const Route = createFileRoute("/api/campaigns")({
  server: {
    handlers: {
      /** Public: the campaign list (summaries only). */
      GET: async () => {
        const campaigns = await listCampaigns();
        return Response.json({ campaigns }, { headers: { "cache-control": "no-store" } });
      },

      /** Admin: create or replace a campaign. */
      POST: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Not authorized." }, { status: 403 });
        }
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON." }, { status: 400 });
        }
        const parsed = parseCampaign(body);
        if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

        // A frozen campaign is a historical record; refuse to overwrite its
        // snapshot so a stray save cannot rewrite a finished result.
        const existing = await readCampaign(parsed.id);
        if (existing?.frozenAt && !parsed.frozenAt) {
          return Response.json(
            { error: "This campaign is closed and its result is final." },
            { status: 409 },
          );
        }

        await saveCampaign(parsed);
        clearStandingsMemo(parsed.id);
        return Response.json({ ok: true, id: parsed.id });
      },

      /** Admin: remove a campaign. */
      DELETE: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Not authorized." }, { status: 403 });
        }
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
        await deleteCampaign(id);
        clearStandingsMemo(id);
        return Response.json({ ok: true });
      },
    },
  },
});
