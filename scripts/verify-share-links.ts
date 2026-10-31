/**
 * Site levels must be shareable by link: the copied URL carries `site`/`arrow`
 * so opening it lands on the level in Play, and the params round-trip through
 * read/write unchanged. `url-state` reads `window`, so a minimal stub stands in
 * for it here — the parsing itself is what is under test.
 */
import { readUrlState, writeUrlState, shareUrl, siteLevelShareUrl } from "@/lib/url-state";

let failures = 0;
const check = (label: string, ok: boolean, extra?: string) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${extra ? `  ${extra}` : ""}`);
  if (!ok) failures++;
};

// A tiny window stub: one URL, mutated by replaceState as the real one is.
let href = "https://narrowarrow.example/?v=play&site=abc123&arrow=Speedy+Arrow";
const win = {
  location: {
    get search() {
      return new URL(href).search;
    },
    get pathname() {
      return new URL(href).pathname;
    },
    get hash() {
      return new URL(href).hash;
    },
    get origin() {
      return new URL(href).origin;
    },
    get hostname() {
      return new URL(href).hostname;
    },
  },
  history: {
    // `writeUrlState` pushes by default and replaces for non-navigations; both
    // mutate the same href here, since the parsing is what is under test.
    pushState(_s: unknown, _t: unknown, url: string) {
      href = url.startsWith("http") ? url : new URL(url, href).toString();
    },
    replaceState(_s: unknown, _t: unknown, url: string) {
      href = url.startsWith("http") ? url : new URL(url, href).toString();
    },
  },
};
(globalThis as { window?: unknown }).window = win;

// --- Reading a site level link -----------------------------------------------
const read = readUrlState();
check("read: view is play", read.view === "play", read.view);
check("read: site id is carried", read.site === "abc123", read.site);
check("read: arrow is carried", read.arrow === "Speedy Arrow", read.arrow);

// --- A link that names only the site still opens Play -------------------------
href = "https://narrowarrow.example/?site=xyz";
const siteOnly = readUrlState();
check("read: site with no view still yields the site", siteOnly.site === "xyz" && !siteOnly.view);

// --- Writing keeps the site params -------------------------------------------
href = "https://narrowarrow.example/";
writeUrlState({ view: "play", site: "abc123", arrow: "Energy Arrow" });
const written = readUrlState();
check(
  "write: site and arrow survive a round-trip",
  written.view === "play" && written.site === "abc123" && written.arrow === "Energy Arrow",
  href,
);

// --- Writing clears the params when absent ------------------------------------
writeUrlState({ view: "leaderboard", level: "1777118905185" });
check(
  "write: a plain view drops the site params",
  !href.includes("site=") && !href.includes("arrow="),
  href,
);
check("write: the plain view is still recorded", readUrlState().view === "leaderboard");

// --- shareUrl builds an absolute, encodable link ------------------------------
href = "https://narrowarrow.example/";
const url = siteLevelShareUrl("id with spaces", "Narrow Arrow");
check("share: absolute url", url.startsWith("https://narrowarrow.example/"), url);
check("share: view=play", url.includes("v=play"), url);
check("share: site is url-encoded", url.includes("site=id+with+spaces"), url);
check("share: arrow is url-encoded", url.includes("arrow=Narrow+Arrow"), url);
check("share: no stray level param", !url.includes("level="), url);

// --- The shared origin is never a sign-in-gated preview host -------------------
// The published site is public; a Lovable preview surface answers everyone else
// with a 401. A link copied from the editor must point at the published site.
const PUBLISHED = "https://narrowarrowrankings.lovable.app";
const originFor = (h: string) => {
  href = `https://${h}/?v=play&site=abc`;
  return siteLevelShareUrl("abc");
};
const GATED = [
  "id-preview--712a12a2-f4ed-4349-9678-37a309567c4c.lovable.app",
  "project--712a12a2-f4ed-4349-9678-37a309567c4c.lovable.app",
  "712a12a2-f4ed-4349-9678-37a309567c4c.lovableproject.com",
  "712a12a2-f4ed-4349-9678-37a309567c4c.lovableproject-dev.com",
  "preview.gpt-eng.com",
  "abc.gptengineer.run",
  "lovable.app",
  "localhost",
  "127.0.0.1",
];
for (const host of GATED) {
  const out = originFor(host);
  check(`share: gated host ${host} → published`, out.startsWith(`${PUBLISHED}/`), out);
}
// A real deployment keeps its own origin (a custom domain, say).
check(
  "share: a real host keeps its own origin",
  originFor("ranks.example.com").startsWith("https://ranks.example.com/"),
  originFor("ranks.example.com"),
);
check(
  "share: the published site keeps its own origin",
  originFor("narrowarrowrankings.lovable.app").startsWith(`${PUBLISHED}/`),
  originFor("narrowarrowrankings.lovable.app"),
);

// --- A link with no arrow omits the param -------------------------------------
const noArrow = siteLevelShareUrl("abc123");
check("share: no arrow means no arrow param", !noArrow.includes("arrow="), noArrow);

// --- Round-trip: the shared link reads back to the same site ------------------
href = url;
const back = readUrlState();
check(
  "round-trip: the shared link reads back",
  back.site === "id with spaces" && back.arrow === "Narrow Arrow",
);

console.log(`\n${failures === 0 ? "all" : `${failures} failing`} share-link checks`);
process.exit(failures === 0 ? 0 : 1);
