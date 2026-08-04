import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEVELS } from "@/constants";

const VALID_LEVEL_IDS = new Set(LEVELS.map((l) => l.id));

interface RatingInput {
  levelId: string;
  rating: number;
}

/** Server-validated 1-10 rating for an official level, owned by the token user. */
export const rateLevelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: RatingInput) => {
    const levelId = String(input?.levelId ?? "");
    const rating = Math.round(Number(input?.rating));
    if (!VALID_LEVEL_IDS.has(levelId)) throw new Error("Unknown level.");
    if (!Number.isFinite(rating) || rating < 1 || rating > 10) throw new Error("Rating must be 1-10.");
    return { levelId, rating };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("level_ratings")
      .upsert(
        {
          user_id: context.userId,
          level_id: data.levelId,
          rating: data.rating,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,level_id" },
      )
      .select("id, user_id, level_id, rating")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
