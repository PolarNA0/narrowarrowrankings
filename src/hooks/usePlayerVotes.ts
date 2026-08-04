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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("player_votes")
      .select("id, user_id, target_username, category, value");
    if (error) {
      console.error("Vote load failed:", error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as VoteRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const map: Record<string, VoteTotals> = {};
    const voterSets: Record<string, Set<string>> = {};
    for (const row of rows) {
      const key = row.target_username.toLowerCase();
      const entry = (map[key] ??= { ...EMPTY });
      entry[row.category] += row.value;
      entry.total += row.value;
      (voterSets[key] ??= new Set()).add(row.user_id);
    }
    for (const [key, set] of Object.entries(voterSets)) map[key].voters = set.size;
    return map;
  }, [rows]);

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
        setRows((prev) => prev.filter((r) => r.id !== existing.id));
        return;
      }

      const { data, error } = await supabase
        .from("player_votes")
        .upsert(
          { user_id: userId, target_username: target, category, value } as never,
          { onConflict: "user_id,target_username,category" },
        )
        .select("id, user_id, target_username, category, value")
        .single();
      if (error) throw new Error(error.message);
      const saved = data as unknown as VoteRow;
      setRows((prev) => [...prev.filter((r) => r.id !== saved.id && r !== existing), saved]);
    },
    [rows, userId],
  );

  return { totals, myVotes, loading, reload: load, vote };
}
