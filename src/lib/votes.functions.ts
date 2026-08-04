import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CATEGORIES = ["official", "hard", "custom"] as const;
type Category = (typeof CATEGORIES)[number];

interface VoteInput {
  username: string;
  category: string;
  value: number;
}

/**
 * Server-validated vote. The target player must actually exist upstream, the
 * category must be known, the value must be +1/-1, and the owner is always
 * taken from the verified bearer token — never from the request body.
 */
export const castVoteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: VoteInput) => {
    const username = String(input?.username ?? "").trim();
    const category = String(input?.category ?? "");
    const value = Number(input?.value);
    if (!/^[A-Za-z0-9_\-. ]{1,32}$/.test(username)) throw new Error("Invalid player name.");
    if (!CATEGORIES.includes(category as Category)) throw new Error("Invalid category.");
    if (value !== 1 && value !== -1) throw new Error("Invalid vote value.");
    return { username, category: category as Category, value: value as 1 | -1 };
  })
  .handler(async ({ data, context }) => {
    const { fetchJson } = await import("@/lib/na-proxy");
    let canonical: string;
    try {
      const upstream = (await fetchJson(
        `/user/${encodeURIComponent(data.username)}`,
        5 * 60 * 1000,
      )) as { user?: { username?: string } };
      canonical = String(upstream?.user?.username ?? "").trim();
    } catch {
      throw new Error("That player could not be verified.");
    }
    if (!canonical) throw new Error("That player does not exist.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("player_votes")
      .upsert(
        {
          user_id: context.userId,
          target_username: canonical.toLowerCase(),
          category: data.category,
          value: data.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,target_username,category" },
      )
      .select("id, user_id, target_username, category, value")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
