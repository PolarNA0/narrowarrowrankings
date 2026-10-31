/**
 * Client helpers for campaigns (see `src/routes/api/campaigns*.ts`).
 *
 * A campaign is a curated set of levels run inside a fixed window, scored by
 * `src/lib/campaign.ts`. Standings are computed server-side so every visitor
 * sees the same result, and are served from a frozen snapshot once the
 * campaign closes.
 */
import type { Campaign, CampaignStanding, CampaignStatus } from "./campaign";
import type { CampaignRecord, CampaignSummary } from "./campaign.server";
import { supabase } from "@/integrations/supabase/client";

export type { CampaignRecord, CampaignSummary };
export type { Campaign, CampaignStanding, CampaignStatus };

export interface CampaignDetail {
  campaign: CampaignRecord;
  standings: CampaignStanding[];
  status: CampaignStatus;
}

/** Every campaign, newest first. */
export async function fetchCampaigns(): Promise<CampaignSummary[]> {
  const res = await fetch("/api/campaigns", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Campaigns request failed (${res.status})`);
  const data = (await res.json()) as { campaigns?: CampaignSummary[] };
  return data.campaigns ?? [];
}

/** One campaign with its standings. `summary` returns only the top rows. */
export async function fetchCampaign(
  id: string,
  options: { summary?: boolean } = {},
): Promise<CampaignDetail | null> {
  const query = options.summary ? "?summary=1" : "";
  const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}${query}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Campaign request failed (${res.status})`);
  return (await res.json()) as CampaignDetail;
}

async function adminHeaders(): Promise<HeadersInit> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** Admin: create or replace a campaign. */
export async function saveCampaignRequest(payload: unknown): Promise<{ ok: boolean; id?: string }> {
  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: await adminHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json()) as { ok?: boolean; id?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`);
  return { ok: true, id: data.id };
}

/** Admin: remove a campaign. */
export async function deleteCampaignRequest(id: string): Promise<void> {
  const res = await fetch(`/api/campaigns?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await adminHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Delete failed (${res.status})`);
  }
}

/** Admin: freeze a campaign, snapshotting its standings permanently. */
export async function freezeCampaignRequest(id: string): Promise<{ frozenAt: number }> {
  const res = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: await adminHeaders(),
    signal: AbortSignal.timeout(60000),
  });
  const data = (await res.json()) as { frozenAt?: number; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Freeze failed (${res.status})`);
  return { frozenAt: data.frozenAt ?? Date.now() };
}
