/**
 * Storage for site levels — community levels authored with the Level editor
 * that may use the site-only wind/suction mechanics, keyed in `app_docs`.
 *
 * A site level is a `.nalvl` payload (name, game mode, obstacles) plus a small
 * manifest entry so the browser can list every level without reading each doc.
 * Unlike upstream community levels these are hosted here, so the site owns the
 * leaderboard for them.
 */

export interface SiteLevelObstacle {
  points: Array<{ x: number; y: number }>;
  obstacle_type?: string;
  wall_type?: string;
  wall_thickness?: number;
  zone_type?: string;
  zone_direction?: number;
  portal_id?: string;
  side?: string;
  rotation_pivot?: { x: number; y: number } | null;
  rotation_speed?: number | null;
  speed?: number;
  /** Site-only force field (wind/suction). */
  field_type?: string;
  field_direction?: number;
  field_strength?: number;
  /** Site-only moving block (offset reached at motion_period / 2 ticks, then back). */
  motion_dx?: number;
  motion_dy?: number;
  motion_period?: number;
  /** Site-only accelerator wire: crossing it arms a push until accelerator_speed. */
  accelerator_speed?: number;
  accelerator_accel?: number;
  /** Site-only switch/door pair: both carry the same `switch_group`. */
  switch_group?: string;
  switch_action?: string;
  door_start_open?: boolean;
  /** Site-only one-way gate: the outward normal of the blocked face. */
  gate_normal?: { x: number; y: number } | null;
  /** Site-only blinking (timed) block. */
  blink_period?: number;
  blink_duty?: number;
  blink_phase?: number;
  /** Site-only breakable wall. */
  breakable?: boolean;
}

export interface SiteLevelData {
  map_name: string;
  game_mode: string;
  format_version?: number;
  required_format_version?: number;
  obstacles: SiteLevelObstacle[];
}

/** A published site level, as stored in its own `app_docs` doc. */
export interface SiteLevelRecord {
  id: string;
  name: string;
  author: string;
  /** Default arrow the level is designed for (free text, e.g. "Narrow Arrow"). */
  arrowName: string;
  createdAt: string;
  updatedAt: string;
  data: SiteLevelData;
}

/** The compact listing row kept in the manifest. */
export interface SiteLevelSummary {
  id: string;
  name: string;
  author: string;
  arrowName: string;
  createdAt: string;
  obstacleCount: number;
  /** True when the level uses the site-only wind/suction fields. */
  hasCustomMechanics: boolean;
  /** How many times a run has been submitted to its leaderboard. */
  completions: number;
  /** Fastest submitted time in ms, or null when nobody has finished it. */
  bestTimeMs: number | null;
}

export interface SiteLevelManifest {
  levels: SiteLevelSummary[];
}

const LEVEL_COLLECTION = "site_levels";
const MANIFEST_DOC = "index";

/**
 * Local dev has no service-role key, so writes would fail RLS. Keep the whole
 * store in process memory there; production always uses Supabase.
 */
const memoryLevels = new Map<string, SiteLevelRecord>();
let memoryManifest: SiteLevelSummary[] = [];
function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function readManifest(): Promise<SiteLevelSummary[]> {
  if (memoryStoreEnabled()) return memoryManifest;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", LEVEL_COLLECTION)
      .eq("doc_id", MANIFEST_DOC)
      .maybeSingle();
    const manifest = data?.data as unknown as SiteLevelManifest | undefined;
    return Array.isArray(manifest?.levels) ? manifest.levels : [];
  } catch {
    return [];
  }
}

async function writeManifest(levels: SiteLevelSummary[]): Promise<void> {
  if (memoryStoreEnabled()) {
    memoryManifest = levels;
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: LEVEL_COLLECTION,
      doc_id: MANIFEST_DOC,
      data: { levels } as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);
}

/** Every published level, newest first. Public (RLS) read so no key is needed. */
export async function listSiteLevels(): Promise<SiteLevelSummary[]> {
  const levels = await readManifest();
  return [...levels].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readSiteLevel(id: string): Promise<SiteLevelRecord | null> {
  if (memoryStoreEnabled()) return memoryLevels.get(id) ?? null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", LEVEL_COLLECTION)
      .eq("doc_id", id)
      .maybeSingle();
    const record = data?.data as unknown as SiteLevelRecord | undefined;
    return record?.data ? record : null;
  } catch {
    return null;
  }
}

/** Public (RLS) read used by the API route so no service key is needed. */
export async function readSiteLevelPublic(id: string): Promise<SiteLevelRecord | null> {
  if (memoryStoreEnabled()) return memoryLevels.get(id) ?? null;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", LEVEL_COLLECTION)
      .eq("doc_id", id)
      .maybeSingle();
    if (error) return null;
    const record = data?.data as unknown as SiteLevelRecord | undefined;
    return record?.data ? record : null;
  } catch {
    return null;
  }
}

/** Persist a new level and add it to the manifest. */
export async function addSiteLevel(record: SiteLevelRecord): Promise<SiteLevelSummary[]> {
  if (memoryStoreEnabled()) {
    memoryLevels.set(record.id, record);
    const summary = summarize(record, 0, null);
    memoryManifest = [...(await readManifest()).filter((l) => l.id !== record.id), summary];
    return memoryManifest;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("app_docs").upsert(
    {
      collection: LEVEL_COLLECTION,
      doc_id: record.id,
      data: record as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "collection,doc_id" },
  );
  if (error) throw new Error(error.message);

  const existing = await readManifest();
  const prev = existing.find((l) => l.id === record.id);
  const summary = summarize(record, prev?.completions ?? 0, prev?.bestTimeMs ?? null);
  const next = [...existing.filter((l) => l.id !== record.id), summary];
  await writeManifest(next);
  return next;
}

/** Remove a level and its manifest entry. */
export async function removeSiteLevel(id: string): Promise<SiteLevelSummary[]> {
  const next = (await readManifest()).filter((l) => l.id !== id);
  if (memoryStoreEnabled()) {
    memoryLevels.delete(id);
    memoryManifest = next;
    return next;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("app_docs").delete().eq("collection", LEVEL_COLLECTION).eq("doc_id", id);
  await writeManifest(next);
  return next;
}

/** Keep a summary's derived stats in sync when a score is submitted. */
export async function updateSiteLevelStats(
  id: string,
  completions: number,
  bestTimeMs: number | null,
): Promise<void> {
  const existing = await readManifest();
  const idx = existing.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const next = [...existing];
  next[idx] = { ...next[idx], completions, bestTimeMs };
  await writeManifest(next);
}

function summarize(
  record: SiteLevelRecord,
  completions: number,
  bestTimeMs: number | null,
): SiteLevelSummary {
  const obstacles = record.data.obstacles ?? [];
  return {
    id: record.id,
    name: record.name,
    author: record.author,
    arrowName: record.arrowName,
    createdAt: record.createdAt,
    obstacleCount: obstacles.length,
    hasCustomMechanics: obstacles.some(
      (o) =>
        o.field_type === "wind" ||
        o.field_type === "suction" ||
        (Number.isFinite(Number(o.accelerator_speed)) && Number(o.accelerator_speed) > 0) ||
        typeof o.switch_group === "string" ||
        o.gate_normal != null ||
        (Number.isFinite(Number(o.blink_period)) && Number(o.blink_period) > 0) ||
        o.breakable === true,
    ),
    completions,
    bestTimeMs,
  };
}

/** Re-check the caller's admin role server-side (hiding a button is not a gate). */
export async function verifyAdminRequest(request: Request): Promise<boolean> {
  if (memoryStoreEnabled()) return true;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return false;
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user.id)
      .eq("role", "admin")
      .maybeSingle();
    return !!role;
  } catch {
    return false;
  }
}
