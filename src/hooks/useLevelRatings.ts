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
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("level_ratings").select("id, user_id, level_id, rating");
    if (error) {
      console.error("Rating load failed:", error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as unknown as RatingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summaries = useMemo(() => {
    const map: Record<string, RatingSummary> = {};
    const sums: Record<string, { total: number; count: number }> = {};
    for (const row of rows) {
      const entry = (sums[row.level_id] ??= { total: 0, count: 0 });
      entry.total += row.rating;
      entry.count += 1;
    }
    for (const [levelId, entry] of Object.entries(sums)) {
      map[levelId] = { average: entry.total / entry.count, count: entry.count };
    }
    return map;
  }, [rows]);

  const myRatings = useMemo(() => {
    const map: Record<string, number> = {};
    if (!userId) return map;
    for (const row of rows) if (row.user_id === userId) map[row.level_id] = row.rating;
    return map;
  }, [rows, userId]);

  const rate = useCallback(
    async (levelId: string, rating: number) => {
      if (!userId) throw new Error("Sign in to rate levels.");
      const saved = (await rateLevelFn({ data: { levelId, rating } })) as unknown as RatingRow;
      setRows((prev) => [...prev.filter((r) => r.id !== saved.id), saved]);
    },
    [userId],
  );

  const clearRating = useCallback(
    async (levelId: string) => {
      if (!userId) return;
      const existing = rows.find((r) => r.user_id === userId && r.level_id === levelId);
      if (!existing) return;
      const { error } = await supabase.from("level_ratings").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
      setRows((prev) => prev.filter((r) => r.id !== existing.id));
    },
    [rows, userId],
  );

  return { summaries, myRatings, loading, reload: load, rate, clearRating };
}
