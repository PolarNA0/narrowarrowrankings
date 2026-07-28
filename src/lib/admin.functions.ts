import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Accounts that are automatically granted admin on first sign-in. */
const ADMIN_EMAIL_ALLOWLIST = ["sirsamyou@gmail.com", "polarusx@gmail.com"];

export const claimAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = String(context.claims.email ?? "").toLowerCase();
    if (!ADMIN_EMAIL_ALLOWLIST.includes(email)) {
      return { isAdmin: false as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: context.userId, role: "admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
    return { isAdmin: true as const };
  });
