import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rateLevelFn } from "@/lib/ratings.functions";

interface RatingRow {
  id: string;
  user_id: string;
  level_id: string;
  rating: number;
}

export interface RatingSummary {
  average: number;
  count: number;
}

/** Community 1-10 ratings for official levels. Writes go through a server fn. */
export function useLevelRatings(userId?: string | null) {
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [summaries, setSummaries] = useState<Record<string, RatingSummary>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: agg, error: aggError } = await supabase.rpc("get_rating_summaries");
    if (aggError) console.error("Rating summaries failed:", aggError.message);
    const map: Record<string, RatingSummary> = {};
    for (const r of (agg ?? []) as { level_id: string; average: number; count: number }[]) {
      map[r.level_id] = { average: Number(r.average), count: Number(r.count) };
    }
    setSummaries(map);
    if (!userId) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from("level_ratings")
      .select("id, user_id, level_id, rating")
      .eq("user_id", userId);
    if (error) {
      console.error("Rating load failed:", error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as RatingRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const myRatings = useMemo(() => {
    const map: Record<string, number> = {};
    if (!userId) return map;
    for (const row of rows) if (row.user_id === userId) map[row.level_id] = row.rating;
    return map;
  }, [rows, userId]);

  const rate = useCallback(
    async (levelId: string, rating: number) => {
      if (!userId) throw new Error("Sign in to rate levels.");
      await rateLevelFn({ data: { levelId, rating } });
      await load();
    },
    [userId, load],
  );

  const clearRating = useCallback(
    async (levelId: string) => {
      if (!userId) return;
      const existing = rows.find((r) => r.user_id === userId && r.level_id === levelId);
      if (!existing) return;
      const { error } = await supabase.from("level_ratings").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      await load();
    },
    [rows, userId, load],
  );

  return { summaries, myRatings, loading, reload: load, rate, clearRating };
}
