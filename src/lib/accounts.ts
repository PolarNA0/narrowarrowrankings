/**
 * Player accounts, username-only.
 *
 * Players sign up with a username and a password — no email, no Google. Supabase
 * Auth keys accounts on an email address, so a username is mapped to a stable,
 * undeliverable one under a reserved subdomain. That keeps the whole thing inside
 * Supabase's own auth (hashing, sessions, rate limits) with no new infrastructure.
 *
 * The trade-off is deliberate: with no real inbox there is no self-service
 * password reset. A forgotten password is recovered by an admin running the
 * `resetAccountPassword` server function, which is why this module never pretends
 * to offer a reset link.
 */
import { supabase } from "@/integrations/supabase/client";
import { emailForAccountUsername } from "@/lib/account-email";

/** Login handle: no spaces, so it can never be confused with an in-game name. */
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

export const PASSWORD_MIN = 8;

export function normalizeAccountUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Why a username is unusable, or null when it is fine. */
export function accountUsernameError(raw: string): string | null {
  const username = normalizeAccountUsername(raw);
  if (!username) return "Enter a username.";
  if (username.length < 3) return "Usernames need at least 3 characters.";
  if (username.length > 32) return "Usernames can be at most 32 characters.";
  if (!USERNAME_RE.test(username)) {
    return "Usernames can use letters, numbers, dots, dashes and underscores only.";
  }
  return null;
}

export function accountPasswordError(password: string): string | null {
  if (!password) return "Enter a password.";
  if (password.length < PASSWORD_MIN) {
    return `Passwords need at least ${PASSWORD_MIN} characters.`;
  }
  return null;
}

export class AccountError extends Error {}

function fail(message: string): never {
  throw new AccountError(message);
}

/** Map Supabase's auth errors onto wording a player can act on. */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "That username is taken.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Wrong username or password.";
  }
  if (lower.includes("password")) {
    return `Passwords need at least ${PASSWORD_MIN} characters.`;
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Too many attempts — wait a minute and try again.";
  }
  if (lower.includes("email not confirmed")) {
    return "This account cannot sign in yet — the site is still waiting on an email confirmation that username accounts never receive.";
  }
  return message;
}

/**
 * Create an account, then sign in.
 *
 * The account itself is minted server-side (`registerAccount`) because the
 * project requires email confirmation and a synthetic address can never confirm.
 * The account is created already-confirmed, so the sign-in below succeeds.
 */
export async function signUpWithUsername(
  username: string,
  password: string,
): Promise<{ username: string }> {
  const nameError = accountUsernameError(username);
  if (nameError) fail(nameError);
  const passwordError = accountPasswordError(password);
  if (passwordError) fail(passwordError);

  const normalized = normalizeAccountUsername(username);
  const { registerAccount } = await import("@/lib/accounts.functions");
  try {
    await registerAccount({ data: { username: normalized, password } });
  } catch (err) {
    fail(err instanceof Error ? err.message : "Account creation failed.");
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: emailForAccountUsername(normalized),
    password,
  });
  if (error) fail(friendlyAuthError(error.message));
  return { username: normalized };
}

/** Sign in with a username and password. */
export async function signInWithUsername(username: string, password: string): Promise<void> {
  const nameError = accountUsernameError(username);
  if (nameError) fail(nameError);
  if (!password) fail("Enter your password.");

  const { error } = await supabase.auth.signInWithPassword({
    email: emailForAccountUsername(username),
    password,
  });
  if (error) fail(friendlyAuthError(error.message));
}

export async function signOutAccount(): Promise<void> {
  await supabase.auth.signOut();
}
