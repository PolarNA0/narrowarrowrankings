/**
 * Storage for campaigns, keyed in `app_docs` (collection `campaigns`).
 *
 * A campaign is a curated set of levels run inside a fixed window, scored by
 * `src/lib/campaign.ts`. The level list is **frozen** once the campaign starts:
 * editing it later would rescale every player's total, so a change is a new
 * campaign rather than an edit. `frozenAt` marks the moment standings were
 * snapshotted, after which the stored result is authoritative and no longer
 * re-derived from the live boards (which keep moving as runs are uploaded).
 *
 * Writes need the service role. Local dev has no `SUPABASE_SERVICE_ROLE_KEY`,
 * so the store falls back to per-process memory there and production always
 * uses Supabase — the same shape as the TAS/site-level stores.
 */

import {
  campaignPaletteColor,
  normalizeCampaignColor,
  type Campaign,
  type CampaignStanding,
} from "./campaign";

/**
 * A short-lived per-process memo of computed standings. The home page and the
 * campaign view both ask for the same campaign within seconds of each other,
 * and each computation reads the level boards — so without this the home page
 * would re-read every board on every visit. Keyed by campaign id, cleared
 * whenever the campaign is written.
 */
const MEMO_TTL_MS = 30_000;
const standingsMemo = new Map<string, { at: number; standings: CampaignStanding[] }>();

export function readStandingsMemo(id: string): CampaignStanding[] | null {
  const hit = standingsMemo.get(id);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.standings;
  return null;
}

export function writeStandingsMemo(id: string, standings: CampaignStanding[]): void {
  standingsMemo.set(id, { at: Date.now(), standings });
}

export function clearStandingsMemo(id: string): void {
  standingsMemo.delete(id);
}

export function __resetStandingsMemo(): void {
  standingsMemo.clear();
}

/** The list of campaigns, newest first, kept in one doc. */
const INDEX_DOC = "index";
const COLLECTION = "campaigns";

/** A campaign row for the index, so the list never reads every full doc. */
export interface CampaignSummary {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  levelCount: number;
  /** True once the standings were snapshotted at close. */
  frozen: boolean;
}

/** A stored campaign: the definition plus an optional frozen result. */
export interface CampaignRecord extends Campaign {
  createdAt: string;
  updatedAt: string;
  /** Epoch ms the standings were frozen at, or null while still live. */
  frozenAt: number | null;
  /** The snapshot taken at close. Authoritative once present. */
  standings?: CampaignStanding[];
}

const memoryCampaigns = new Map<string, CampaignRecord>();
let memoryIndex: CampaignSummary[] = [];

function memoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Test hook so the verify script can drive the real store. */
export function __resetCampaignMemory() {
  memoryCampaigns.clear();
  memoryIndex = [];
}

function summarise(record: CampaignRecord): CampaignSummary {
  return {
    id: record.id,
    name: record.name,
    startsAt: record.startsAt,
    endsAt: record.endsAt,
    levelCount: record.levels.length,
    frozen: record.frozenAt !== null,
  };
}

/**
 * The campaign index. The list route is public, so this reads through the
 * anonymous client first — the index holds nothing but campaign metadata, and
 * going through the service role would make the public list fail whenever the
 * key is absent or rotated. The admin client is kept as a fallback so an
 * RLS-restricted deployment still lists.
 */
async function readIndex(): Promise<CampaignSummary[]> {
  if (memoryStoreEnabled()) return memoryIndex;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", INDEX_DOC)
      .maybeSingle();
    if (!error) {
      const list = (data?.data as unknown as { campaigns?: CampaignSummary[] } | undefined)
        ?.campaigns;
      return Array.isArray(list) ? list : [];
    }
  } catch {
    /* fall through to the admin client */
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", INDEX_DOC)
      .maybeSingle();
    const list = (data?.data as unknown as { campaigns?: CampaignSummary[] } | undefined)
      ?.campaigns;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeIndex(summaries: CampaignSummary[]): Promise<void> {
  if (memoryStoreEnabled()) {
    memoryIndex = summaries;
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("app_docs")
    .upsert(
      { collection: COLLECTION, doc_id: INDEX_DOC, data: { campaigns: summaries } as never },
      { onConflict: "collection,doc_id" },
    );
}

/** Every campaign, newest first. */
export async function listCampaigns(): Promise<CampaignSummary[]> {
  const list = await readIndex();
  return [...list].sort((a, b) => b.startsAt - a.startsAt);
}

export async function readCampaign(id: string): Promise<CampaignRecord | null> {
  if (memoryStoreEnabled()) return memoryCampaigns.get(id) ?? null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", id)
      .maybeSingle();
    const record = data?.data as unknown as CampaignRecord | undefined;
    return record?.id ? record : null;
  } catch {
    return null;
  }
}

/** Public (RLS) read used by the API route so no service key is needed. */
export async function readCampaignPublic(id: string): Promise<CampaignRecord | null> {
  if (memoryStoreEnabled()) return memoryCampaigns.get(id) ?? null;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data, error } = await supabase
      .from("app_docs")
      .select("data")
      .eq("collection", COLLECTION)
      .eq("doc_id", id)
      .maybeSingle();
    if (error) return null;
    const record = data?.data as unknown as CampaignRecord | undefined;
    return record?.id ? record : null;
  } catch {
    return null;
  }
}

/**
 * Creates or replaces a campaign. The frozen snapshot is carried over from any
 * existing doc, so a later metadata edit cannot silently discard the result of
 * a finished campaign.
 */
export async function saveCampaign(record: CampaignRecord): Promise<void> {
  const now = new Date().toISOString();
  const existing = await readCampaign(record.id);
  const next: CampaignRecord = {
    ...record,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    frozenAt: record.frozenAt ?? existing?.frozenAt ?? null,
    standings: record.standings ?? existing?.standings,
  };

  if (memoryStoreEnabled()) {
    memoryCampaigns.set(next.id, next);
    const index = await readIndex();
    const without = index.filter((c) => c.id !== next.id);
    await writeIndex([...without, summarise(next)]);
    return;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("app_docs")
    .upsert(
      { collection: COLLECTION, doc_id: next.id, data: next as never },
      { onConflict: "collection,doc_id" },
    );
  const index = await readIndex();
  const without = index.filter((c) => c.id !== next.id);
  await writeIndex([...without, summarise(next)]);
}

export async function deleteCampaign(id: string): Promise<void> {
  if (memoryStoreEnabled()) {
    memoryCampaigns.delete(id);
    await writeIndex((await readIndex()).filter((c) => c.id !== id));
    return;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("app_docs").delete().eq("collection", COLLECTION).eq("doc_id", id);
  await writeIndex((await readIndex()).filter((c) => c.id !== id));
}

/**
 * The stored record with its level list brought up to the current shape.
 *
 * `parseCampaign` is a validator for *incoming* payloads, so the read paths used
 * to skip it — which meant a campaign saved before per-level colours reached the
 * client (and the standings) still naming a `classId` and carrying no `color`,
 * and its per-level rows rendered with an empty colour. Normalising on read is
 * what lets an existing campaign keep its look without a migration. Only the
 * levels are taken from the parse: the stored timestamps and frozen snapshot
 * must survive verbatim, which is also why this is not just `parseCampaign`.
 */
export function normalizeStoredCampaign(record: CampaignRecord): CampaignRecord {
  const parsed = parseCampaign(record);
  if ("error" in parsed) return record;
  // `classes` is a retired field; drop it rather than pass the legacy grouping
  // through to a client that no longer knows what to do with it.
  const { classes: _legacyClasses, ...rest } = record as CampaignRecord & { classes?: unknown };
  return { ...rest, levels: parsed.levels };
}

/**
 * Validate and normalise an incoming campaign payload. Exported so the verify
 * script can exercise the rules directly rather than through HTTP.
 *
 * Each level carries its own colour; the list must be non-empty, ids unique,
 * and the dates finite and ordered.
 */
export function parseCampaign(raw: unknown): CampaignRecord | { error: string } {
  const d = raw as (Partial<CampaignRecord> & { classes?: unknown }) | null;
  if (!d || typeof d !== "object") return { error: "Missing campaign data." };

  const id = String(d.id ?? "").trim();
  if (!/^[a-z0-9-]{3,40}$/i.test(id))
    return { error: "Campaign id must be 3-40 letters or digits." };

  const name = String(d.name ?? "").trim();
  if (name.length < 1 || name.length > 60) return { error: "Name must be 1-60 characters." };

  const startsAt = Number(d.startsAt);
  const endsAt = Number(d.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt))
    return { error: "Dates must be set." };
  if (endsAt <= startsAt) return { error: "The end must come after the start." };

  /**
   * Campaigns used to group levels into named, coloured "classes". A payload
   * saved back then still names a class per level, so fold each level's class
   * colour into the level itself — that is exactly what the class was for, and
   * it keeps an existing campaign looking the same instead of greying out.
   */
  const legacyColors = new Map<string, string>();
  if (Array.isArray(d.classes)) {
    for (const k of d.classes as Array<{ id?: unknown; color?: unknown }>) {
      const key = String(k?.id ?? "").trim();
      if (key) legacyColors.set(key, normalizeCampaignColor(k?.color));
    }
  }

  const levels = Array.isArray(d.levels) ? d.levels : [];
  if (levels.length === 0) return { error: "Add at least one level." };
  const levelIds = new Set<string>();
  const cleanLevels = levels.map((l, index) => {
    const levelId = String(l?.id ?? "").trim();
    levelIds.add(levelId);
    const legacyClassId = String((l as { classId?: unknown })?.classId ?? "").trim();
    const hasOwnColor = String((l as { color?: unknown })?.color ?? "").trim().length > 0;
    const color = hasOwnColor
      ? normalizeCampaignColor((l as { color?: unknown }).color)
      : (legacyColors.get(legacyClassId) ?? campaignPaletteColor(index));
    return {
      id: levelId,
      name: String(l?.name ?? levelId).trim() || levelId,
      color,
    };
  });
  if (cleanLevels.some((l) => !l.id)) return { error: "Every level needs an id." };
  if (levelIds.size !== cleanLevels.length) return { error: "A level cannot appear twice." };

  const now = new Date().toISOString();
  return {
    id,
    name,
    startsAt,
    endsAt,
    levels: cleanLevels,
    createdAt: now,
    updatedAt: now,
    frozenAt: d.frozenAt ?? null,
    standings: d.standings,
  };
}
