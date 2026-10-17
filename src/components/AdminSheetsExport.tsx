import * as React from "react";
import { ClipboardCopy, FileSpreadsheet, Loader2, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

interface ConfigResponse {
  config: {
    sheetId: string;
    tab: string;
    enabled: boolean;
    intervalMinutes: number;
    hasServiceAccount: boolean;
  };
  result?: {
    ok: boolean;
    skipped?: boolean;
    reason?: string;
    rows?: number;
    updatedAt?: string;
    error?: string;
  };
}

/**
 * Admin panel for the Google Sheets export: mirrors each level's TAS board
 * against the human world record and writes the table to a Google Sheet on a
 * timer. The service-account key is sent once and stored server-side; it is
 * never echoed back to the browser.
 */
export function AdminSheetsExport() {
  const [sheetId, setSheetId] = React.useState("");
  const [tab, setTab] = React.useState("TAS vs WR");
  const [serviceAccountJson, setServiceAccountJson] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [intervalMinutes, setIntervalMinutes] = React.useState(30);
  const [hasKey, setHasKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [copying, setCopying] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/public/sheets-export");
      const data = (await res.json()) as ConfigResponse;
      setSheetId(data.config.sheetId);
      setTab(data.config.tab);
      setEnabled(data.config.enabled);
      setIntervalMinutes(data.config.intervalMinutes);
      setHasKey(data.config.hasServiceAccount);
      const r = data.result;
      if (r?.ok && r.updatedAt) {
        setStatus(`Last export: ${new Date(r.updatedAt).toLocaleString()} · ${r.rows ?? 0} rows`);
      } else if (r?.error) {
        setStatus(`Last export failed: ${r.error}`);
      } else if (r?.skipped) {
        setStatus(`Last export skipped (${r.reason}).`);
      }
    } catch {
      /* first-time setup */
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // While this panel is open, re-poke the export every couple of minutes (up to
  // a bounded number of times). The endpoint only actually writes when the
  // interval is due, so this makes the sheet update on its own without a
  // dedicated cron — and without hammering Google.
  React.useEffect(() => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      void load();
      if (ticks >= 10) clearInterval(timer);
    }, 120_000);
    return () => clearInterval(timer);
  }, [load]);

  // Pull the service-account email out of the pasted JSON so the admin knows
  // exactly which address to share the sheet with.
  const serviceEmail = React.useMemo(() => {
    try {
      const parsed = JSON.parse(serviceAccountJson) as { client_email?: string };
      return parsed.client_email ?? null;
    } catch {
      return null;
    }
  }, [serviceAccountJson]);

  const authHeader = async (): Promise<Record<string, string>> => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/public/sheets-export", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ sheetId, tab, serviceAccountJson, enabled, intervalMinutes }),
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) throw new Error(payload.error || `Save failed (${res.status})`);
      if (serviceAccountJson) {
        setHasKey(true);
        setServiceAccountJson("");
      }
      toast.success("Sheets export saved");
      setStatus("Saved. Press “Export now” to test it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const exportNow = async () => {
    setExporting(true);
    setStatus("Exporting…");
    try {
      const res = await fetch("/api/public/sheets-export?force=1");
      const data = (await res.json()) as ConfigResponse;
      const r = data.result;
      if (r?.ok) {
        setStatus(
          `Exported ${r.rows ?? 0} rows at ${new Date(r.updatedAt ?? Date.now()).toLocaleString()}.`,
        );
        toast.success("Sheet updated");
      } else {
        setStatus(`Export failed: ${r?.error ?? "unknown error"}`);
        toast.error(r?.error || "Export failed");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const copyTable = async () => {
    setCopying(true);
    setStatus("Building table…");
    try {
      const res = await fetch("/api/public/sheets-export?data=1");
      const data = (await res.json()) as { rows: string[][]; header: string[]; updatedAt: string };
      const tsv = [
        `Last updated: ${new Date(data.updatedAt).toLocaleString()}`,
        data.header.join("\t"),
        ...data.rows.map((r) => r.join("\t")),
      ].join("\n");
      await navigator.clipboard.writeText(tsv);
      setStatus(`Copied ${data.rows.length} rows — paste into a spreadsheet cell.`);
      toast.success("Table copied to clipboard");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Copy failed");
      toast.error("Could not copy the table");
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-[var(--app-accent)]" /> Google Sheets export
        </h2>
        <p className="text-slate-500 text-sm mt-1">
          Mirrors every level's TAS board against the human world record — with the delta — into a
          Google Sheet, refreshed on a timer. Rows appear for levels that already have a TAS run.
        </p>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/30 p-4 space-y-3">
        <p className="text-xs text-slate-300">
          <span className="font-bold text-white">No Google account needed:</span> copy the whole
          table to your clipboard and paste it into any spreadsheet.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-9 text-xs"
            onClick={() => void copyTable()}
            disabled={copying}
          >
            {copying ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <ClipboardCopy className="w-3.5 h-3.5 mr-1" />
            )}
            Copy table
          </Button>
          {status && <span className="text-[11px] text-slate-400">{status}</span>}
        </div>
      </div>

      <details className="rounded-lg border border-white/10 bg-black/20">
        <summary className="cursor-pointer select-none px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-400">
          Automatic updates (optional, needs a Google service account)
        </summary>
        <div className="space-y-4 border-t border-white/10 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Spreadsheet id or URL
              </span>
              <Input
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="bg-white/5 border-white/10 text-xs"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                Tab name
              </span>
              <Input
                value={tab}
                onChange={(e) => setTab(e.target.value)}
                placeholder="TAS vs WR"
                className="bg-white/5 border-white/10 text-xs"
              />
            </label>
          </div>

          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
              Service-account key (JSON)
            </span>
            <Textarea
              value={serviceAccountJson}
              onChange={(e) => setServiceAccountJson(e.target.value)}
              placeholder={
                hasKey
                  ? "A key is already saved. Paste a new one to replace it."
                  : '{ "type": "service_account", "client_email": "…", "private_key": "-----BEGIN PRIVATE KEY-----…" }'
              }
              rows={5}
              className="bg-white/5 border-white/10 text-xs font-mono"
            />
            <span className="text-[11px] text-slate-500">
              {serviceEmail ? (
                <>
                  Share the sheet with{" "}
                  <span className="font-mono text-[var(--app-accent)]">{serviceEmail}</span> as an
                  Editor.
                </>
              ) : hasKey ? (
                "A key is saved server-side (never sent to the browser)."
              ) : (
                "Create a Google Cloud service account, enable the Sheets API, and paste its JSON key."
              )}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-[var(--app-accent)]"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              Every
              <Input
                type="number"
                min={5}
                step={5}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.max(5, Number(e.target.value) || 30))}
                className="h-8 w-20 bg-white/5 border-white/10 text-xs font-mono"
              />
              minutes
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-9 text-xs" onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5 mr-1" />
              )}
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              onClick={() => void exportNow()}
              disabled={exporting || !sheetId}
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1" />
              )}
              Export now
            </Button>
            {status && <span className="text-[11px] text-slate-400">{status}</span>}
          </div>
        </div>
      </details>
    </div>
  );
}
