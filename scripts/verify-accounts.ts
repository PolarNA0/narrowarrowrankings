/**
 * Checks for the username-account rules.
 *
 * The rules are pure so they can be checked without a Supabase project: the
 * normalisation, the validation, and the mapping from a username to the
 * synthetic address Supabase actually keys on. That mapping is the load-bearing
 * part — if it changes, every existing account is orphaned — so it is asserted
 * literally rather than derived.
 *
 * Run: npx tsx scripts/verify-accounts.ts
 */
import {
  accountPasswordError,
  accountUsernameError,
  normalizeAccountUsername,
  PASSWORD_MIN,
} from "../src/lib/accounts";
import { emailForAccountUsername, USERNAME_EMAIL_DOMAIN } from "../src/lib/account-email";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`OK   ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// ---- normalisation ---------------------------------------------------------
eq("username is lowercased", normalizeAccountUsername("PolarNA0"), "polarna0");
eq("surrounding space is trimmed", normalizeAccountUsername("  polar  "), "polar");
eq("inner case is preserved as lower", normalizeAccountUsername("AbC"), "abc");

// ---- username rules --------------------------------------------------------
eq("a plain username is accepted", accountUsernameError("polarna0"), null);
eq("dots, dashes and underscores are allowed", accountUsernameError("a.b-c_d"), null);
eq("three characters is the minimum", accountUsernameError("abc"), null);
eq("two characters is rejected", accountUsernameError("ab") !== null, true);
eq("an empty username is rejected", accountUsernameError("   ") !== null, true);
eq("spaces are rejected", accountUsernameError("polar na") !== null, true);
eq("symbols are rejected", accountUsernameError("polar!") !== null, true);
eq("an email-shaped name is rejected", accountUsernameError("a@b.com") !== null, true);
eq("33 characters is rejected", accountUsernameError("a".repeat(33)) !== null, true);
eq("32 characters is accepted", accountUsernameError("a".repeat(32)), null);

// ---- password rules --------------------------------------------------------
eq("password minimum is 8", PASSWORD_MIN, 8);
eq("a short password is rejected", accountPasswordError("short") !== null, true);
eq("an empty password is rejected", accountPasswordError("") !== null, true);
eq("an 8-character password is accepted", accountPasswordError("12345678"), null);
eq("a long password is accepted", accountPasswordError("correct horse battery"), null);

// ---- the address Supabase keys on ------------------------------------------
eq(
  "a username maps to a stable synthetic address",
  emailForAccountUsername("PolarNA0"),
  `polarna0@${USERNAME_EMAIL_DOMAIN}`,
);
eq(
  "the synthetic domain is the one existing accounts were created under",
  USERNAME_EMAIL_DOMAIN,
  "players.narrowarrowrankings.com",
);
eq(
  "the address is normalised like the username",
  emailForAccountUsername("  PoLar  "),
  "polar@players.narrowarrowrankings.com",
);
check(
  "the synthetic domain is not a reserved TLD",
  !emailForAccountUsername("polar").endsWith(".local"),
  "a .local domain is rejected by Supabase signup",
);
eq(
  "two spellings of one username collapse to one address",
  emailForAccountUsername("Polar") === emailForAccountUsername("polar"),
  true,
);

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed > 0) process.exit(1);
