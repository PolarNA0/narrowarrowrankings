import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin-only password reset for a player account.
 *
 * Accounts are username-only, so there is no inbox to send a reset link to.
 * Rather than leave a player permanently locked out of a mistyped password,
 * recovery goes through an admin, who looks the account up by its in-game name
 * and sets a new password.
 */

async function assertAdmin(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admins only.");
}

/** Set a new password for the account linked to an in-game name. */
export const resetAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { username: string; newPassword: string }) => {
    const username = String(input?.username ?? "")
      .trim()
      .toLowerCase();
    const newPassword = String(input?.newPassword ?? "");
    if (!username) throw new Error("Enter the player's in-game name.");
    if (newPassword.length < 8) throw new Error("Passwords need at least 8 characters.");
    return { username, newPassword };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Accounts are keyed on the synthetic address, so the linked username is
    // resolved to a user id through the profile row first.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("player_profiles")
      .select("user_id")
      .eq("username", data.username)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile?.user_id) throw new Error("No account is linked to that name.");

    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.user_id, {
      password: data.newPassword,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
