import { createFileRoute } from "@tanstack/react-router";
import {
  readSheetsConfigPublic,
  runSheetsExport,
  saveSheetsConfig,
} from "@/lib/sheets-export.server";
import { verifyAdminRequest } from "@/lib/tas-board.server";

/**
 * Google Sheets export of the TAS boards vs the human world records.
 *
 * `GET` (no auth) runs a due export — this is the cron target, and it also
 * returns the current (secret-free) config so the admin panel can render it.
 * `POST` (admin) saves the sheet id / tab / service-account key.
 */
export const Route = createFileRoute("/api/public/sheets-export")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const force = new URL(request.url).searchParams.get("force") === "1";
        const [config, result] = await Promise.all([
          readSheetsConfigPublic(),
          runSheetsExport({ force }),
        ]);
        return Response.json({ config, result });
      },

      POST: async ({ request }) => {
        if (!(await verifyAdminRequest(request))) {
          return Response.json({ error: "Only admins can configure the export." }, { status: 403 });
        }
        const body = (await request.json().catch(() => ({}))) as {
          sheetId?: unknown;
          tab?: unknown;
          serviceAccountJson?: unknown;
          enabled?: unknown;
          intervalMinutes?: unknown;
        };
        const sheetId = String(body.sheetId ?? "").trim();
        // Accept a full Sheets URL and pull the id out of it.
        const idMatch = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        const id = idMatch ? idMatch[1] : sheetId;
        const tab = String(body.tab ?? "TAS vs WR").trim() || "TAS vs WR";
        const serviceAccountJson = String(body.serviceAccountJson ?? "").trim();

        if (id && !/^[a-zA-Z0-9-_]{20,}$/.test(id)) {
          return Response.json(
            { error: "That does not look like a sheet id or URL." },
            { status: 400 },
          );
        }
        if (serviceAccountJson) {
          try {
            const parsed = JSON.parse(serviceAccountJson) as {
              client_email?: string;
              private_key?: string;
            };
            if (!parsed.client_email || !parsed.private_key) throw new Error("missing fields");
          } catch {
            return Response.json(
              {
                error:
                  "The service-account key must be the full JSON with client_email and private_key.",
              },
              { status: 400 },
            );
          }
        }

        // A blank key leaves the stored one untouched (the panel never echoes it).
        const existing = await readSheetsConfigPublic();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let key = serviceAccountJson;
        if (!key) {
          const { data } = await supabaseAdmin
            .from("app_docs")
            .select("data")
            .eq("collection", "configs")
            .eq("doc_id", "sheetsExport")
            .maybeSingle();
          key = String(
            (data?.data as { serviceAccountJson?: string } | null)?.serviceAccountJson ?? "",
          );
        }

        try {
          await saveSheetsConfig({
            sheetId: id,
            tab,
            serviceAccountJson: key,
            enabled: body.enabled !== false,
            intervalMinutes: Math.max(5, Number(body.intervalMinutes) || 30),
          });
        } catch {
          return Response.json(
            { error: "Could not save the config (is Supabase connected?)." },
            { status: 500 },
          );
        }

        return Response.json({ ok: true, config: { ...existing, sheetId: id, tab } });
      },
    },
  },
});
