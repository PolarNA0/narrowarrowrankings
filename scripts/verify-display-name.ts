/**
 * Verify the display-name rules over the real helper used by every ranking
 * view: a linked player's display name replaces their in-game name, the
 * in-game name is the fallback, and lookups stay case-insensitive.
 */
import {
  displayNameFor,
  avatarFor,
  matchesPlayerSearch,
  type ProfileDirectory,
} from "@/lib/display-name";
import type { PlayerProfileRow } from "@/hooks/usePlayerProfiles";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ok  ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function profile(partial: Partial<PlayerProfileRow>): PlayerProfileRow {
  return {
    id: "id",
    user_id: "user",
    username: "polar",
    display_name: null,
    avatar_url: null,
    banner_url: null,
    accent_color: null,
    bio: null,
    country: null,
    socials: null,
    verified: false,
    created_at: null,
    updated_at: null,
    ...partial,
  } as PlayerProfileRow;
}

const profiles: ProfileDirectory = {
  polar: profile({ username: "polar", display_name: "PolarNova", avatar_url: "https://x/a.jpg" }),
  rival: profile({ username: "rival", display_name: "   " }),
  ghost: profile({ username: "ghost", display_name: "Ghosty" }),
};

console.log("display name resolution");
check("display name replaces the in-game name", displayNameFor(profiles, "polar") === "PolarNova");
check("lookup is case-insensitive", displayNameFor(profiles, "POLAR") === "PolarNova");
check(
  "a whitespace-only display name falls back to the in-game name",
  displayNameFor(profiles, "rival") === "rival",
);
check(
  "an unlinked player keeps their in-game name",
  displayNameFor(profiles, "nobody") === "nobody",
);
check("no directory at all is safe", displayNameFor(undefined, "polar") === "polar");
check("an empty name is safe", displayNameFor(profiles, "") === "");

console.log("\navatar resolution");
check("avatar is found case-insensitively", avatarFor(profiles, "POLAR") === "https://x/a.jpg");
check("an unlinked player has no avatar", avatarFor(profiles, "nobody") === undefined);
check("no directory at all is safe", avatarFor(undefined, "polar") === undefined);

console.log("\nsearch matching");
check("an empty query matches everyone", matchesPlayerSearch(profiles, "polar", ""));
check("a whitespace query matches everyone", matchesPlayerSearch(profiles, "polar", "   "));
check("the in-game name still matches", matchesPlayerSearch(profiles, "polar", "pol"));
check("the display name matches", matchesPlayerSearch(profiles, "polar", "nova"));
check("matching is case-insensitive", matchesPlayerSearch(profiles, "polar", "NOVA"));
check("a non-match is rejected", !matchesPlayerSearch(profiles, "polar", "zzz"));
check("an unlinked player matches by in-game name", matchesPlayerSearch(profiles, "nobody", "nob"));
check(
  "an unlinked player is not matched by another's display name",
  !matchesPlayerSearch(profiles, "nobody", "nova"),
);

console.log(`\n${passed} checks passed, ${failed} failed`);
if (failed > 0) process.exit(1);
