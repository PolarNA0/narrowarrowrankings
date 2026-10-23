import { createServerFn } from "@tanstack/react-start";

/**
 * Account creation for username-only players.
 *
 * `supabase.auth.signUp` is not usable here: the project requires email
 * confirmation, and the address behind a username is synthetic, so the
 * confirmation link could never be delivered and the account would be stuck
 * unconfirmed. Minting the account through the service role with
 * `email_confirm: true` produces a normal, immediately usable account without
 * changing the project's auth settings.
 *
 * The account is keyed on `<username>@<synthetic domain>`, so a second request
 * for the same username fails on uniqueness — that is the "username is taken"
 * check, and it cannot be raced past because the database enforces it.
 */

import { emailForAccountUsername } from "@/lib/account-email";

export const registerAccount = createServerFn({ method: "POST" })
  .inputValidator((input: { username: string; password: string }) => {
    const username = String(input?.username ?? "")
      .trim()
      .toLowerCase();
    const password = String(input?.password ?? "");
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new Error("That username is not valid.");
    if (password.length < 8) throw new Error("Passwords need at least 8 characters.");
    return { username, password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = emailForAccountUsername(data.username);

    const { error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
    });

    if (error) {
      // The unique constraint on the address is the authoritative "taken" check.
      const message = error.message.toLowerCase();
      if (
        message.includes("already") ||
        message.includes("exists") ||
        message.includes("duplicate")
      ) {
        throw new Error("That username is taken.");
      }
      throw new Error(error.message);
    }
    return { ok: true as const, username: data.username };
  });
