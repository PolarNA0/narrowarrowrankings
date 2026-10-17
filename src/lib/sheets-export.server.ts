/**
 * Periodically mirrors every level's TAS board against the real human world
 * record into a Google Sheet, so the gap between tool-assisted and human play is
 * visible in one place and updates on its own.
 *
 * A Google Sheet can be written from a server with a *service account*: the
 * sheet is shared with the service account's email (Editor), and we mint a
 * short-lived OAuth token from its private key — no user login, no OAuth consent
 * screen. The config (sheet id + the service-account JSON) lives in `app_docs`,
 * is set from the admin panel, and never reaches the browser.
 */
import { createSign } from "node:crypto";
import { LEVELS } from "@/constants";
import { fetchLevelBoard } from "@/lib/leaderboard-source";
import { readTasBoard } from "@/lib/tas-board.server";

const ARROWS = ["Narrow Arrow", "Speedy Arrow", "Energy Arrow"] as const;

export interface SheetsConfig {
  /** The spreadsheet id from its URL: /spreadsheets/d/<id>/edit. */
  sheetId: string;
  /** The tab to write; created if missing. */
  tab: string;
  /** The service-account JSON key, pasted as text. */
  serviceAccountJson: string;
  enabled: boolean;
  intervalMinutes: number;
}

export interface SheetsExportRow {
  level: string;
  pack: string;
  arrow: string;
  tasSec: number;
  tasPlayer: string;
  wrSec: number | null;
  wrPlayer: string;
  wrArrow: string;
  deltaSec: number | null;
}

export interface SheetsExportResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  rows?: number;
  updatedAt?: string;
  error?: string;
}

const CONFIG_DOC = "sheetsExport";
const STATE_DOC = "sheetsExportState";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const json = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof json.client_email !== "string" || typeof json.private_key !== "string") return null;
    if (!json.private_key.includes("PRIVATE KEY")) return null;
    return { client_email: json.client_email, private_key: json.private_key };
  } catch {
    return null;
  }
}

/** Mint a Google OAuth access token from the service account's private key. */
async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SHEETS_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = base64url(signer.sign(sa.private_key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !payload.access_token) {
    throw new Error(payload.error_description || `Google auth failed (${res.status})`);
  }
  return payload.access_token;
}

async function loadConfig(): Promise<SheetsConfig | null> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", "configs")
      .eq("doc_id", CONFIG_DOC)
      .maybeSingle();
    if (!data?.data) return null;
    const cfg = data.data as Partial<SheetsConfig>;
    if (!cfg.sheetId || !cfg.serviceAccountJson) return null;
    return {
      sheetId: String(cfg.sheetId),
      tab: String(cfg.tab || "TAS vs WR"),
      serviceAccountJson: String(cfg.serviceAccountJson),
      enabled: cfg.enabled !== false,
      intervalMinutes: Math.max(5, Number(cfg.intervalMinutes) || 30),
    };
  } catch {
    // Local dev has no service-role key (and thus no admin client); the export
    // simply reports itself unconfigured rather than crashing the endpoint.
    return null;
  }
}

export async function saveSheetsConfig(config: SheetsConfig): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("app_docs")
    .upsert(
      { collection: "configs", doc_id: CONFIG_DOC, data: config as never },
      { onConflict: "collection,doc_id" },
    );
}

export async function readSheetsConfigPublic(): Promise<
  Omit<SheetsConfig, "serviceAccountJson"> & { hasServiceAccount: boolean }
> {
  const cfg = await loadConfig();
  return {
    sheetId: cfg?.sheetId ?? "",
    tab: cfg?.tab ?? "TAS vs WR",
    enabled: cfg?.enabled ?? false,
    intervalMinutes: cfg?.intervalMinutes ?? 30,
    hasServiceAccount: !!cfg?.serviceAccountJson,
  };
}

/**
 * Build the sheet rows: one per level+arrow that has a TAS run, next to that
 * level's real human world record. Only levels that already have a TAS board
 * are looked up upstream, so a mostly-empty board costs almost no requests.
 */
export async function buildExportRows(): Promise<SheetsExportRow[]> {
  const rows: SheetsExportRow[] = [];
  const queue = [...LEVELS];

  const worker = async () => {
    for (;;) {
      const level = queue.shift();
      if (!level) return;

      const tasEntries = await readTasBoard(level.id);
      if (!tasEntries.length) return;

      let wrSec: number | null = null;
      let wrPlayer = "";
      let wrArrow = "";
      try {
        const board = await fetchLevelBoard(level.id);
        for (const run of board) {
          if (wrSec === null || run.completion_time < wrSec) {
            wrSec = run.completion_time;
            wrPlayer = run.username;
            wrArrow = run.arrow_name ?? "";
          }
        }
      } catch {
        /* leave the WR blank if upstream is unavailable */
      }

      for (const arrow of ARROWS) {
        const runs = tasEntries.filter((e) => e.arrowName === arrow);
        if (!runs.length) continue;
        const best = runs.reduce((a, b) => (a.timeMs <= b.timeMs ? a : b));
        const tasSec = best.timeMs / 1000;
        rows.push({
          level: level.name,
          pack: level.packId,
          arrow,
          tasSec,
          tasPlayer: best.username,
          wrSec,
          wrPlayer,
          wrArrow,
          deltaSec: wrSec === null ? null : tasSec - wrSec,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: 6 }, worker));
  return rows.sort(
    (a, b) =>
      a.level.localeCompare(b.level) || a.arrow.localeCompare(b.arrow) || a.tasSec - b.tasSec,
  );
}

/** Ensure the target tab exists, adding it if the spreadsheet lacks it. */
async function ensureTab(sheetId: string, tab: string, token: string): Promise<void> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) {
    const body = (await metaRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Could not open the spreadsheet (${metaRes.status})`);
  }
  const meta = (await metaRes.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
  const exists = (meta.sheets ?? []).some((s) => s.properties?.title === tab);
  if (exists) return;

  const addRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
    },
  );
  if (!addRes.ok) {
    const body = (await addRes.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Could not create the "${tab}" tab (${addRes.status})`);
  }
}

/** Overwrite the tab with the current table, clearing any stale rows first. */
async function writeRows(
  sheetId: string,
  tab: string,
  token: string,
  rows: SheetsExportRow[],
  updatedAt: string,
): Promise<void> {
  const range = `'${tab}'`;
  // Clear first: an export with fewer rows than the last must not leave stale
  // rows behind.
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:clear`,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );

  const header = [
    "Level",
    "Pack",
    "Arrow",
    "TAS (s)",
    "TAS player",
    "Human WR (s)",
    "WR player",
    "WR arrow",
    "Delta TAS-WR (s)",
    "TAS ahead?",
  ];
  const values: (string | number)[][] = [
    [`Last updated: ${updatedAt}`, "", "", "", "", "", "", "", "", ""],
    header,
    ...rows.map((r) => [
      r.level,
      r.pack,
      r.arrow,
      r.tasSec.toFixed(3),
      r.tasPlayer,
      r.wrSec === null ? "—" : r.wrSec.toFixed(3),
      r.wrPlayer || "—",
      r.wrArrow || "—",
      r.deltaSec === null ? "—" : r.deltaSec.toFixed(3),
      r.deltaSec === null ? "—" : r.deltaSec < 0 ? "yes" : "no",
    ]),
  ];

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
    `${range}!A1`,
  )}?valueInputOption=RAW`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Could not write to the sheet (${res.status})`);
  }
}

/**
 * Run one export. Gated by `intervalMinutes` unless `force`; the cron endpoint
 * polls often and only the due run does the work.
 */
export async function runSheetsExport(opts: { force?: boolean } = {}): Promise<SheetsExportResult> {
  const cfg = await loadConfig();
  if (!cfg) return { ok: false, error: "No Google Sheets export is configured." };
  if (!cfg.enabled) return { ok: false, skipped: true, reason: "disabled" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: stateRow } = await supabaseAdmin
    .from("app_docs")
    .select("data")
    .eq("collection", "configs")
    .eq("doc_id", STATE_DOC)
    .maybeSingle();
  const lastRunAt = (stateRow?.data as { __lastRunAt?: string } | null)?.__lastRunAt
    ? Date.parse(String((stateRow?.data as { __lastRunAt?: string }).__lastRunAt))
    : 0;
  const intervalMs = cfg.intervalMinutes * 60_000;
  if (!opts.force && lastRunAt && Date.now() - lastRunAt < intervalMs - 30_000) {
    return {
      ok: true,
      skipped: true,
      reason: "interval",
      updatedAt: new Date(lastRunAt).toISOString(),
    };
  }

  const sa = parseServiceAccount(cfg.serviceAccountJson);
  if (!sa) return { ok: false, error: "The service-account key is not valid JSON." };

  try {
    const token = await getAccessToken(sa);
    await ensureTab(cfg.sheetId, cfg.tab, token);
    const rows = await buildExportRows();
    const updatedAt = new Date().toISOString();
    await writeRows(cfg.sheetId, cfg.tab, token, rows, updatedAt);
    await supabaseAdmin.from("app_docs").upsert(
      {
        collection: "configs",
        doc_id: STATE_DOC,
        data: { __lastRunAt: updatedAt, rows: rows.length } as never,
      },
      { onConflict: "collection,doc_id" },
    );
    return { ok: true, rows: rows.length, updatedAt };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
