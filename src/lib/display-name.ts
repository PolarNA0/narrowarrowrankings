import type { PlayerProfileRow } from "@/hooks/usePlayerProfiles";

/** Lookup table of public profiles, keyed by lowercase in-game name. */
export type ProfileDirectory = Record<string, PlayerProfileRow>;

/**
 * The name to show for a leaderboard name.
 *
 * A linked player may set a display name, which is what rankings show; the
 * in-game name is what the board actually stores, so it stays the identity used
 * for lookups and is still shown on the player's profile (as `@name`). With no
 * profile or no display name set, the in-game name is the display name.
 */
export function displayNameFor(profiles: ProfileDirectory | undefined, username: string): string {
  if (!profiles || !username) return username;
  return profiles[username.toLowerCase()]?.display_name?.trim() || username;
}

/**
 * Whether a search term matches a player, by in-game name or display name.
 *
 * Search has to cover both: the boards are keyed by in-game name, but once a
 * player renames themselves on rankings, searching for the name they can see
 * must find them.
 */
export function matchesPlayerSearch(
  profiles: ProfileDirectory | undefined,
  username: string,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    username.toLowerCase().includes(q) ||
    displayNameFor(profiles, username).toLowerCase().includes(q)
  );
}

/** The avatar for a leaderboard name, if the linked player has one. */
export function avatarFor(
  profiles: ProfileDirectory | undefined,
  username: string,
): string | undefined {
  return profiles?.[username.toLowerCase()]?.avatar_url ?? undefined;
}
