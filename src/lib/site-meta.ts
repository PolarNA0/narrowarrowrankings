/**
 * Site-wide metadata, shared by the root route's `<head>` and the sitemap so the
 * title/description can never drift between the two.
 */

export const SITE_NAME = "Narrow Arrow Rankings";

export const SITE_TITLE = "Narrow Arrow Rankings — Leaderboards & Player Ranks";

export const SITE_DESCRIPTION =
  "Live Narrow Arrow leaderboards, player profiles, rank assignments, comparisons and custom level browsing.";

/**
 * The public origin used for canonical/OG URLs. A custom domain should set
 * `VITE_SITE_URL`; otherwise the Lovable preview domain is correct.
 */
export const CANONICAL_ORIGIN = (
  import.meta.env?.VITE_SITE_URL || "https://narrowarrowrankings.lovable.app"
).replace(/\/+$/, "");

/**
 * The social preview image. It is hosted on the app's asset bucket rather than
 * `public/`, so the absolute URL is what crawlers need.
 */
export const OG_IMAGE =
  "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/lovp_5p375efgxa8haa3160xshwy116/5d4a0fea7a3fecb2a8a9a8b687394e28_1792347727171.png";
