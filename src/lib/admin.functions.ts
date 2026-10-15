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

/** Shared admin PIN — anyone who knows it is granted admin, no account needed. */
const ADMIN_PIN = "0404";

/**
 * PIN-only admin unlock. There is no account behind it, so the server mints (or
 * reuses) a stable anonymous admin account and grants it the admin role. The
 * client then signs in as that account to obtain a session for admin actions.
 */
export const adminPinSignIn = createServerFn({ method: "POST" })
  .inputValidator((input: { pin: string }) => ({ pin: String(input?.pin ?? "").trim() }))
  .handler(async ({ data }) => {
    if (data.pin !== ADMIN_PIN) {
      return { ok: false as const, error: "Incorrect PIN" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const email = "admin@narrowarrowrankings.local";
    const password = `pin-${ADMIN_PIN}-narrowarrow`;

    // Create the account on first use; "already registered" is fine and just
    // means a previous session minted it.
    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    let userId = created.data?.user?.id;

    if (!userId) {
      // Already exists — find it. listUsers is paginated, so walk the pages.
      for (let page = 1; !userId && page <= 20; page += 1) {
        const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (listError) throw new Error(listError.message);
        userId = list.users.find((u) => u.email?.toLowerCase() === email)?.id;
        if (list.users.length < 1000) break;
      }
    }
    if (!userId) throw new Error("Admin account unavailable");

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: "admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (roleError) throw new Error(roleError.message);

    return { ok: true as const, email, password };
  });

export const claimAdminWithPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pin: string }) => ({ pin: String(input?.pin ?? "").trim() }))
  .handler(async ({ data, context }) => {
    if (data.pin !== ADMIN_PIN) {
      return { isAdmin: false as const, error: "Incorrect PIN" };
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

