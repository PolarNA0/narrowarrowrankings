import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { castVoteFn } from "@/lib/votes.functions";

export type VoteCategory = "official" | "hard" | "custom";

export const VOTE_CATEGORIES: { id: VoteCategory; label: string; blurb: string }[] = [
  { id: "official", label: "Official Levels", blurb: "Skill on the official packs" },
  { id: "hard", label: "Hard Levels", blurb: "Performance on the brutal maps" },
  { id: "custom", label: "Custom Levels", blurb: "Community-made level skill" },
];

export interface VoteTotals {
  official: number;
  hard: number;
  custom: number;
  total: number;
  voters: number;
}

interface VoteRow {
  id: string;
  user_id: string;
  target_username: string;
  category: VoteCategory;
  value: number;
}

const EMPTY: VoteTotals = { official: 0, hard: 0, custom: 0, total: 0, voters: 0 };

/**
 * Community voting: +1 / -1 per player, per category, one vote per signed-in
 * user. Totals are loaded once and updated locally as votes are cast.
 */
export function usePlayerVotes(userId?: string | null) {
  const [rows, setRows] = useState<VoteRow[]>([]);
  const [totals, setTotals] = useState<Record<string, VoteTotals>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: agg, error: aggError } = await supabase.rpc("get_vote_totals");
    if (aggError) console.error("Vote totals failed:", aggError.message);
    const map: Record<string, VoteTotals> = {};
    for (const r of (agg ?? []) as { target_username: string; category: VoteCategory; total: number; voters: number }[]) {
      const entry = (map[r.target_username.toLowerCase()] ??= { ...EMPTY });
      entry[r.category] += Number(r.total);
      entry.total += Number(r.total);
      entry.voters = Math.max(entry.voters, Number(r.voters));
    }
    setTotals(map);
    if (!userId) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from("player_votes")
      .select("id, user_id, target_username, category, value")
      .eq("user_id", userId);
    if (error) {
      console.error("Vote load failed:", error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as VoteRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myVotes = useMemo(() => {
    const map: Record<string, Partial<Record<VoteCategory, number>>> = {};
    if (!userId) return map;
    for (const row of rows) {
      if (row.user_id !== userId) continue;
      (map[row.target_username.toLowerCase()] ??= {})[row.category] = row.value;
    }
    return map;
  }, [rows, userId]);

  const vote = useCallback(
    async (username: string, category: VoteCategory, value: 1 | -1) => {
      if (!userId) throw new Error("Sign in to vote.");
      const target = username.toLowerCase();
      const existing = rows.find(
        (r) => r.user_id === userId && r.target_username === target && r.category === category,
      );

      if (existing && existing.value === value) {
        const { error } = await supabase.from("player_votes").delete().eq("id", existing.id);
        if (error) throw new Error(error.message);
        await load();
        return;
      }

      await castVoteFn({ data: { username: target, category, value } });
      await load();
    },
    [rows, userId, load],
  );


  return { totals, myVotes, loading, reload: load, vote };
}
