import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CustomBadge {
  id: string;
  label: string;
  detail?: string;
  tone: string;
}

/** Palette admins can pick from when granting a badge. */
export const BADGE_TONES: { id: string; name: string; className: string }[] = [
  { id: "amber", name: "Gold", className: "text-amber-300 border-amber-400/30 bg-amber-400/10" },
  { id: "sky", name: "Sky", className: "text-sky-300 border-sky-400/30 bg-sky-400/10" },
  { id: "emerald", name: "Emerald", className: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10" },
  { id: "fuchsia", name: "Fuchsia", className: "text-fuchsia-300 border-fuchsia-400/30 bg-fuchsia-400/10" },
  { id: "rose", name: "Rose", className: "text-rose-300 border-rose-400/30 bg-rose-400/10" },
  { id: "cyan", name: "Cyan", className: "text-cyan-300 border-cyan-400/30 bg-cyan-400/10" },
  { id: "violet", name: "Violet", className: "text-violet-300 border-violet-400/30 bg-violet-400/10" },
  { id: "lime", name: "Lime", className: "text-lime-300 border-lime-400/30 bg-lime-400/10" },
  { id: "slate", name: "Steel", className: "text-slate-300 border-white/20 bg-white/5" },
];

export function badgeToneClass(tone: string) {
  return (BADGE_TONES.find((t) => t.id === tone) ?? BADGE_TONES[0]).className;
}

/** Ready-made badges admins can grant with one click. */
export const BADGE_PRESETS: CustomBadge[] = [
  { id: "og", label: "OG", detail: "Playing since the early days", tone: "amber" },
  { id: "veteran", label: "Veteran", detail: "Long-standing member of the community", tone: "slate" },
  { id: "moderator", label: "Moderator", detail: "Helps keep the community in order", tone: "sky" },
  { id: "admin", label: "Admin", detail: "Site administrator", tone: "rose" },
  { id: "tournament-winner", label: "Tournament Winner", detail: "Won an official tournament", tone: "amber" },
  { id: "content-creator", label: "Content Creator", detail: "Makes Narrow Arrow videos", tone: "fuchsia" },
  { id: "bug-hunter", label: "Bug Hunter", detail: "Reported a serious bug", tone: "lime" },
  { id: "supporter", label: "Supporter", detail: "Supports the project", tone: "violet" },
  { id: "rising-star", label: "Rising Star", detail: "Improving fast", tone: "cyan" },
  { id: "consistent", label: "Consistent", detail: "Reliable across every pack", tone: "emerald" },
  { id: "grinder", label: "Grinder", detail: "Absurd number of attempts", tone: "slate" },
  { id: "strat-master", label: "Strat Master", detail: "Invented a route everyone uses", tone: "violet" },
];

const COLLECTION = "playerBadges";

/**
 * Admin-granted badges, keyed by lowercase leaderboard name.
 * Stored in the shared app_docs table (public read, admin write).
 */
export function useCustomBadges() {
  const [badges, setBadges] = useState<Record<string, CustomBadge[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("app_docs")
      .select("doc_id, data")
      .eq("collection", COLLECTION);
    if (error) {
      console.error("Badge load failed:", error.message);
      setLoading(false);
      return;
    }
    const map: Record<string, CustomBadge[]> = {};
    for (const row of data ?? []) {
      const list = (row.data as { badges?: CustomBadge[] } | null)?.badges;
      if (Array.isArray(list) && list.length > 0) map[row.doc_id.toLowerCase()] = list;
    }
    setBadges(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setPlayerBadges = useCallback(
    async (username: string, list: CustomBadge[]) => {
      const key = username.toLowerCase();
      const { error } = await supabase.from("app_docs").upsert(
        {
          collection: COLLECTION,
          doc_id: key,
          data: { badges: list } as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "collection,doc_id" },
      );
      if (error) throw new Error(error.message);
      setBadges((prev) => ({ ...prev, [key]: list }));
    },
    [],
  );

  const grant = useCallback(
    async (username: string, badge: CustomBadge) => {
      const key = username.toLowerCase();
      const existing = badges[key] ?? [];
      if (existing.some((b) => b.id === badge.id)) return;
      await setPlayerBadges(username, [...existing, badge]);
    },
    [badges, setPlayerBadges],
  );

  const revoke = useCallback(
    async (username: string, badgeId: string) => {
      const key = username.toLowerCase();
      const existing = badges[key] ?? [];
      await setPlayerBadges(username, existing.filter((b) => b.id !== badgeId));
    },
    [badges, setPlayerBadges],
  );

  return { badges, loading, reload: load, grant, revoke, setPlayerBadges };
}
