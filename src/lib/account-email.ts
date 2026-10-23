/**
 * The synthetic address behind a username account.
 *
 * Accounts are keyed on an email address, but players sign up with a username,
 * so the username is mapped to a fixed address under this domain. Nothing is ever
 * delivered to it. Supabase rejects reserved and placeholder domains (`.local`,
 * `example.com`), so it has to look real.
 *
 * Both the client and the account-creation server function import this, because
 * if the two disagreed, sign-in would look up an address that sign-up never
 * created and every new account would be unusable. Treat the value as fixed:
 * changing it orphans every existing account.
 */
export const USERNAME_EMAIL_DOMAIN = "players.narrowarrowrankings.com";

export function emailForAccountUsername(raw: string): string {
  return `${raw.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}
