import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PlayerProfileRow {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  accent_color: string | null;
  bio: string | null;
  country: string | null;
  socials: Record<string, string>;
  verified: boolean;
}

export interface LinkRequestRow {
  id: string;
  user_id: string;
  requested_username: string;
  proof_url: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

const EMPTY: Record<string, PlayerProfileRow> = {};

/** Public profile directory keyed by lowercase linked leaderboard name. */
export function usePlayerProfiles(userId?: string | null) {
  const [byUsername, setByUsername] = useState<Record<string, PlayerProfileRow>>(EMPTY);
  const [myProfile, setMyProfile] = useState<PlayerProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("player_profiles").select("*");
    if (error) {
      console.error("Profile load failed:", error.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as unknown as PlayerProfileRow[];
    const map: Record<string, PlayerProfileRow> = {};
    for (const row of rows) {
      if (row.username) map[row.username.toLowerCase()] = row;
    }
    setByUsername(map);
    setMyProfile(userId ? rows.find((r) => r.user_id === userId) ?? null : null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMyProfile = useCallback(
    async (patch: Partial<PlayerProfileRow>) => {
      if (!userId) throw new Error("Sign in first.");
      const payload = { user_id: userId, ...patch } as never;
      const { error } = await supabase
        .from("player_profiles")
        .upsert(payload, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      await load();
    },
    [userId, load],
  );

  return { byUsername, myProfile, loading, reload: load, saveMyProfile };
}

/** Link requests: own requests for players, all pending ones for admins. */
export function useLinkRequests(userId?: string | null, isAdmin?: boolean) {
  const [requests, setRequests] = useState<LinkRequestRow[]>([]);

  const load = useCallback(async () => {
    if (!userId) {
      setRequests([]);
      return;
    }
    const { data, error } = await supabase
      .from("profile_link_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Link requests load failed:", error.message);
      return;
    }
    setRequests((data ?? []) as unknown as LinkRequestRow[]);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, isAdmin]);

  const submit = useCallback(
    async (requestedUsername: string, proofUrl: string, note: string) => {
      if (!userId) throw new Error("Sign in first.");
      const { error } = await supabase.from("profile_link_requests").insert({
        user_id: userId,
        requested_username: requestedUsername,
        proof_url: proofUrl || null,
        note: note || null,
      } as never);
      if (error) throw new Error(error.message);
      await load();
    },
    [userId, load],
  );

  const review = useCallback(
    async (request: LinkRequestRow, approve: boolean) => {
      const { error } = await supabase
        .from("profile_link_requests")
        .update({ status: approve ? "approved" : "rejected", reviewed_by: userId } as never)
        .eq("id", request.id);
      if (error) throw new Error(error.message);

      if (approve) {
        const { error: profileError } = await supabase.from("player_profiles").upsert(
          {
            user_id: request.user_id,
            username: request.requested_username,
            verified: true,
          } as never,
          { onConflict: "user_id" },
        );
        if (profileError) throw new Error(profileError.message);
      }
      await load();
    },
    [userId, load],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("profile_link_requests").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await load();
    },
    [load],
  );

  return { requests, reload: load, submit, review, remove };
}
