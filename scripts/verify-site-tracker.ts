/**
 * The site level record tracker's decision and rendering rules.
 *
 * Site levels have one board each, so the tracker keeps one baseline per level
 * (`configs/siteRecordState`) and announces a faster run. The announce rule
 * mirrors the TAS tracker: only the very first observation of a level (while the
 * tracker is cold) is silent; a faster run — including the first run on a level
 * that had no board at the last check — is announced.
 */
import {
  DEFAULT_SITE_POSITION_TEMPLATE,
  DEFAULT_SITE_WR_TEMPLATE,
  buildSitePositionMessage,
  decideSiteRecord,
  renderSiteMessage,
  resolveSiteTemplate,
  tidySiteTags,
  type SitePrior,
  type SiteMessageValues,
} from "@/lib/site-tracker.server";

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail === undefined ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

const prior = (timeMs: number, username = "Ash"): SitePrior => ({ username, timeMs });

/** Every value a template can reference, so a render never has an undefined tag. */
const values = (over: Partial<SiteMessageValues> = {}): SiteMessageValues => ({
  emoji: "🏹",
  siteBadge: "",
  champion: "",
  player: "Ash",
  level: "Canyon Run",
  time: "9.000s",
  clock: "0:09.000",
  arrow: "Narrow Arrow",
  author: "Polar",
  custom: "",
  position: "1",
  wrDiff: "",
  siteTag: "",
  diff: "—",
  previous: "—",
  recordHolder: "—",
  ...over,
});

// --- Decision: cold tracker, no prior ----------------------------------------
// A bulk poll that seeds a cold tracker stays silent, so switching the feed on
// does not dump every pre-existing level's record into Discord at once.
const cold = decideSiteRecord(undefined, 10_000, { isFirstRun: true });
check("cold bulk poll: new but silent (seeds the baseline)", cold.isNew && !cold.announce);
check("cold bulk poll: no diff", cold.diffSec === null);

// REGRESSION: a live submission must never be swallowed as a baseline.
// The first record on a freshly published level is a real record — the player
// just set the level's best and there is no backlog to protect against.
const coldSubmit = decideSiteRecord(undefined, 10_000, { isFirstRun: true, fromSubmit: true });
check("cold live submit: announced (not swallowed)", coldSubmit.isNew && coldSubmit.announce);

// --- Decision: warm tracker, a level seen for the first time -----------------
// The level had no board last check, so its first run *is* a new record.
const fresh = decideSiteRecord(undefined, 10_000, { isFirstRun: false });
check("warm, first run on a level: announced", fresh.isNew && fresh.announce);
check("warm, first run on a level: no diff", fresh.diffSec === null);

// --- Decision: a faster run is a record --------------------------------------
const faster = decideSiteRecord(prior(12_000), 9_000, { isFirstRun: false });
check("faster run: new and announced", faster.isNew && faster.announce);
check("faster run: gain is positive seconds", faster.diffSec === 3, faster.diffSec);

// --- Decision: a slower/equal run is not -------------------------------------
const slower = decideSiteRecord(prior(9_000), 12_000, { isFirstRun: false });
check("slower run: not new, not announced", !slower.isNew && !slower.announce);
const equal = decideSiteRecord(prior(9_000), 9_000, { isFirstRun: false });
check("equal run: not new, not announced", !equal.isNew && !equal.announce);

// --- Decision: announceAll re-announces even a cold baseline -----------------
const forced = decideSiteRecord(undefined, 10_000, { isFirstRun: true, announceAll: true });
check("announceAll: cold baseline is announced", forced.announce);

// --- Rendering: the default WR template --------------------------------------
const rendered = renderSiteMessage(
  DEFAULT_SITE_WR_TEMPLATE,
  values({ siteTag: "WR -3.000", wrDiff: "WR -3.000", diff: "-3.000" }),
);
check(
  "default WR template renders player/level/time/tag",
  rendered.includes("**Ash**") &&
    rendered.includes("**Canyon Run**") &&
    rendered.includes("**9.000s**") &&
    rendered.includes("[WR -3.000]"),
  rendered,
);

// --- Rendering: a first record drops the empty bracket -----------------------
// No previous record means no gain, so `[WR -]` must not survive.
const firstRender = renderSiteMessage(DEFAULT_SITE_WR_TEMPLATE, values());
check(
  "first record: no empty bracket",
  !firstRender.includes("[]") && !firstRender.includes("[WR"),
  firstRender,
);

// --- Rendering: the default position template --------------------------------
const posRender = renderSiteMessage(
  DEFAULT_SITE_POSITION_TEMPLATE,
  values({ position: "3", wrDiff: "WR +1.204", diff: "+1.204" }),
);
check(
  "default position template renders place and gap",
  posRender.includes("**Ash**") &&
    posRender.includes("**3**") &&
    posRender.includes("**Canyon Run**") &&
    posRender.includes("[WR +1.204]"),
  posRender,
);

// --- Rendering: a position message never carries the champion mark -----------
// The guarantee lives in the builder, which hardcodes an empty `{champion}` and
// does not even accept a `siteChampion`, so a configured trophy cannot leak in.
const championPos = buildSitePositionMessage(
  { name: "L", author: "P", arrowName: "Narrow Arrow", hasCustomMechanics: false },
  { username: "Ash", timeMs: 9_000, arrowName: "Narrow Arrow", position: 2 },
  { username: "Kai", timeMs: 8_000 },
  { sitePositionTemplate: "{champion}{player}", siteBadge: "" },
);
check("position builder: ignores any champion mark", championPos === "Ash", championPos);

// --- tidySiteTags heals a legacy doubled sign --------------------------------
check(
  "tidy collapses a doubled sign",
  tidySiteTags("[WR --3.000]") === "[WR -3.000]",
  tidySiteTags("[WR --3.000]"),
);
check(
  "tidy drops a value-less bracket",
  tidySiteTags("Ash won [WR —] today") === "Ash won today",
  tidySiteTags("Ash won [WR —] today"),
);

// --- Rendering: a saved legacy template with `-{diff}` still reads cleanly ----
// `{diff}` is signed, so a literal `-` in front of a negative gain must not
// double up, and a literal `+` in front of a positive one must not either.
check(
  "legacy `-[{diff}]` template does not double the sign",
  renderSiteMessage("[WR -{diff}]", values({ diff: "-3.000" })) === "[WR -3.000]",
  renderSiteMessage("[WR -{diff}]", values({ diff: "-3.000" })),
);
check(
  "legacy `+[{diff}]` template does not double the sign",
  renderSiteMessage("[WR +{diff}]", values({ diff: "+1.204" })) === "[WR +1.204]",
  renderSiteMessage("[WR +{diff}]", values({ diff: "+1.204" })),
);
check(
  "legacy `+[{diff}]` template keeps a genuine negative sign",
  renderSiteMessage("[WR +{diff}]", values({ diff: "-3.000" })) === "[WR -3.000]",
  renderSiteMessage("[WR +{diff}]", values({ diff: "-3.000" })),
);

// --- Rendering: `{tags}` mirrors `{siteTag}` ---------------------------------
check(
  "{tags} equals the site tag",
  renderSiteMessage("[{tags}]", values({ siteTag: "WR -1.000" })) === "[WR -1.000]",
  renderSiteMessage("[{tags}]", values({ siteTag: "WR -1.000" })),
);

// --- resolveSiteTemplate: a legacy saved config adopts the new wording -------
// The old default was stored verbatim; it must not pin the old wording forever.
check(
  "a config holding the legacy default adopts the new WR template",
  resolveSiteTemplate(
    "{emoji}{siteBadge} **{player}** set a new site record on **{level}** with **{time}** [{siteTag}]",
    "wr",
  ) === DEFAULT_SITE_WR_TEMPLATE,
);
check(
  "an empty config uses the default",
  resolveSiteTemplate(undefined, "position") === DEFAULT_SITE_POSITION_TEMPLATE,
);
check(
  "a hand-written template is kept",
  resolveSiteTemplate("{player} did a thing", "wr") === "{player} did a thing",
);

// --- End to end: runSiteCheck against the in-memory stores -------------------
// Exercises the real path: read the config/state docs, list the level, read its
// board, decide, render and persist. No webhook is configured, so delivery is a
// no-op but the record accounting is the real thing.
const { addSiteLevel } = await import("@/lib/site-levels.server");
const { addSiteScore } = await import("@/lib/site-scores.server");
const { runSiteCheck } = await import("@/lib/site-tracker.server");

const levelId = "site-e2e-1";
await addSiteLevel({
  id: levelId,
  name: "Canyon Run",
  author: "Polar",
  arrowName: "Narrow Arrow",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  data: {
    map_name: "Canyon Run",
    game_mode: "speedrun",
    obstacles: [{ points: [{ x: 0, y: 0 }], field_type: "wind" }],
  },
});
const score = (timeMs: number, inputs: string) => ({
  id: `e2e-${timeMs}-${inputs}`,
  username: "Ash",
  timeMs,
  arrowName: "Narrow Arrow",
  inputCount: 10,
  inputs,
  createdAt: "2026-01-02T00:00:00.000Z",
});

await addSiteScore(levelId, score(12_000, "run-a"));

// REGRESSION: the exact production sequence that dropped the user's WR.
// A level is published, then its first run is submitted. The submit path must
// announce it — the tracker is cold, but this is a live submission, not a bulk
// poll seeding a backlog.
const firstSubmit = await runSiteCheck([levelId], { force: true, fromSubmit: true });
check(
  "e2e: a level's first record is announced from the submit path",
  firstSubmit.baseline === true && firstSubmit.tracked === 1 && firstSubmit.newRecords === 1,
  JSON.stringify(firstSubmit),
);

// A later bulk poll must not re-announce it.
const afterFirst = await runSiteCheck([levelId], { force: true });
check(
  "e2e: the poll does not re-announce the first record",
  afterFirst.newRecords === 0,
  JSON.stringify(afterFirst),
);

// A faster run is a record and is announced (no webhook, so sent stays 0).
await addSiteScore(levelId, score(9_000, "run-b"));
const improved = await runSiteCheck([levelId], { force: true, fromSubmit: true });
check(
  "e2e: a faster run is announced once",
  improved.baseline === false && improved.newRecords === 1,
  JSON.stringify(improved),
);

// Re-checking with no new run must not re-announce.
const repeat = await runSiteCheck([levelId], { force: true });
check(
  "e2e: an unchanged record is not re-announced",
  repeat.newRecords === 0,
  JSON.stringify(repeat),
);

// A slower run does not announce.
await addSiteScore(levelId, score(15_000, "run-c"));
const worse = await runSiteCheck([levelId], { force: true });
check("e2e: a slower run is not announced", worse.newRecords === 0, JSON.stringify(worse));

// The poll interval is honoured unless forced.
const throttled = await runSiteCheck([levelId]);
check("e2e: the interval skips an unforced re-check", throttled.skipped === true);

// --- Delivery: postDiscordMessage against a real local HTTP server ----------
// A real socket, not a mock: proves the POST shape (content + strict mentions)
// and the ok/failure mapping the tracker relies on.
const { postDiscordMessage, isDiscordWebhook } = await import("@/lib/site-tracker.server");
const { createServer } = await import("node:http");

let received: { content?: string; allowed_mentions?: unknown } | null = null;
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      received = JSON.parse(raw);
    } catch {
      received = null;
    }
    res.statusCode = req.url === "/fail" ? 500 : 204;
    res.end();
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const url = (path: string) => `http://127.0.0.1:${port}${path}`;

check(
  "delivery: a 2xx webhook reports sent",
  (await postDiscordMessage(url("/ok"), "hi")) === true,
);
check(
  "delivery: the body carries the content and strict mentions",
  received?.content === "hi" &&
    JSON.stringify(received?.allowed_mentions) === JSON.stringify({ parse: [] }),
  JSON.stringify(received),
);
check(
  "delivery: a 5xx webhook reports not-sent",
  (await postDiscordMessage(url("/fail"), "hi")) === false,
);
check(
  "delivery: an unreachable host reports not-sent",
  (await postDiscordMessage("http://127.0.0.1:1/nope", "hi")) === false,
);
check(
  "delivery: only a discord.com webhook passes the guard",
  isDiscordWebhook("https://discord.com/api/webhooks/1/x") && !isDiscordWebhook(url("/ok")),
);
await new Promise<void>((r) => server.close(() => r()));

// --- The real message builder (what the tracker actually posts) ---------------
const { buildSiteRecordMessage } = await import("@/lib/site-tracker.server");
const levelMeta = {
  name: "Wall Blink",
  author: "Polar",
  arrowName: "Narrow Arrow",
  hasCustomMechanics: true,
};
const bestRun = { username: "Polar", timeMs: 8_000, arrowName: "Narrow Arrow" };

// The user's exact case: a level's first record. It must read as a record, with
// no leftover bracket and the custom tag set (the level uses blink walls).
const firstMsg = buildSiteRecordMessage(levelMeta, bestRun, undefined);
check(
  "builder: first record names the player, level and time",
  firstMsg.includes("**Polar**") &&
    firstMsg.includes("**Wall Blink**") &&
    firstMsg.includes("**8.000s**"),
  firstMsg,
);
check(
  "builder: first record has no empty bracket",
  !firstMsg.includes("[]") && !firstMsg.includes("WR"),
  firstMsg,
);
check(
  "builder: {custom} renders for a mechanics level",
  buildSiteRecordMessage(levelMeta, bestRun, undefined, { siteWrTemplate: "{custom}" }) ===
    "custom",
);

// A later record shows the gain over the previous holder.
const improvedMsg = buildSiteRecordMessage(levelMeta, bestRun, prior(11_500, "Ash"), {
  siteWrTemplate: "{player} took it from {previous} by {diff}s [{wrDiff}]",
});
check(
  "builder: an improvement names the previous holder and the gain",
  improvedMsg === "Polar took it from Ash by -3.500s [WR -3.500]",
  improvedMsg,
);

// The clock tag uses the site board's m:ss.mmm format.
check(
  "builder: {clock} is m:ss.mmm",
  buildSiteRecordMessage(
    levelMeta,
    { username: "P", timeMs: 62_345, arrowName: "Speedy Arrow" },
    undefined,
    { siteWrTemplate: "{clock}" },
  ) === "1:02.345",
);

// A legacy config (single `siteTemplate`) still drives the WR message.
check(
  "builder: a legacy siteTemplate still renders the WR message",
  buildSiteRecordMessage(levelMeta, bestRun, undefined, {
    siteTemplate: "{player} @ {level}",
  }) === "Polar @ Wall Blink",
);

// --- Builder: the position message -------------------------------------------
const wrRun = { username: "Ash", timeMs: 7_500 };
const positionMsg = buildSitePositionMessage(
  levelMeta,
  { username: "Polar", timeMs: 8_000, arrowName: "Narrow Arrow", position: 3 },
  wrRun,
);
check(
  "position builder: names the player, place, level and gap",
  positionMsg.includes("**Polar**") &&
    positionMsg.includes("**3**") &&
    positionMsg.includes("**Wall Blink**") &&
    positionMsg.includes("[WR +0.500]"),
  positionMsg,
);
check(
  "position builder: never shows the champion mark",
  !positionMsg.includes("{champion}") && !positionMsg.startsWith("🏆"),
  positionMsg,
);

// --- End to end: a submission that places 2nd announces a position ------------
const posLevelId = "site-e2e-pos";
await addSiteLevel({
  id: posLevelId,
  name: "Position Run",
  author: "Polar",
  arrowName: "Narrow Arrow",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  data: { map_name: "Position Run", game_mode: "speedrun", obstacles: [] },
});
const named = (id: string, username: string, timeMs: number, inputs: string) => ({
  id,
  username,
  timeMs,
  arrowName: "Narrow Arrow",
  inputCount: 10,
  inputs,
  createdAt: "2026-01-02T00:00:00.000Z",
});

// The record holder is already on the board.
await addSiteScore(posLevelId, named("pos-a", "Ash", 7_000, "pos-run-a"));
// Seed the baseline quietly so the record is not announced here.
await runSiteCheck([posLevelId], { force: true, fromSubmit: true });

// A slower run arrives: it is not a record, but it is a placement, and only the
// submit path can see it. It must be announced as a position.
await addSiteScore(posLevelId, named("pos-b", "Polar", 8_500, "pos-run-b"));
const placed = await runSiteCheck([posLevelId], {
  force: true,
  fromSubmit: true,
  submission: {
    levelId: posLevelId,
    id: "pos-b",
    username: "Polar",
    timeMs: 8_500,
    arrowName: "Narrow Arrow",
  },
});
check(
  "e2e: a slower submission is announced as a position",
  placed.newRecords === 1,
  JSON.stringify(placed),
);

// The same run without the submission context is silent — a bulk poll cannot
// see placements, only a new level best.
await addSiteScore(posLevelId, named("pos-c", "Kai", 9_000, "pos-run-c"));
const polled = await runSiteCheck([posLevelId], { force: true });
check(
  "e2e: a bulk poll does not announce a placement",
  polled.newRecords === 0,
  JSON.stringify(polled),
);

// A submission that *is* the new record announces the WR, not a position, and
// only once.
await addSiteScore(posLevelId, named("pos-d", "Ash", 6_000, "pos-run-d"));
const newWr = await runSiteCheck([posLevelId], {
  force: true,
  fromSubmit: true,
  submission: {
    levelId: posLevelId,
    id: "pos-d",
    username: "Ash",
    timeMs: 6_000,
    arrowName: "Narrow Arrow",
  },
});
check(
  "e2e: a record submission announces once (WR, not also a position)",
  newWr.newRecords === 1,
  JSON.stringify(newWr),
);

// REGRESSION: a cold tracker, a level that already has a record, and a *slower*
// submission. The submission must be announced as its own position — the
// existing record holder's run must not be announced in its place.
const coldLevelId = "site-e2e-cold";
await addSiteLevel({
  id: coldLevelId,
  name: "Cold Run",
  author: "Polar",
  arrowName: "Narrow Arrow",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  data: { map_name: "Cold Run", game_mode: "speedrun", obstacles: [] },
});
await addSiteScore(coldLevelId, named("cold-a", "Ash", 7_000, "cold-run-a"));
await addSiteScore(coldLevelId, named("cold-b", "Polar", 9_000, "cold-run-b"));
const coldPlacement = await runSiteCheck([coldLevelId], {
  force: true,
  fromSubmit: true,
  submission: {
    levelId: coldLevelId,
    id: "cold-b",
    username: "Polar",
    timeMs: 9_000,
    arrowName: "Narrow Arrow",
  },
});
check(
  "e2e: a slower submission on a cold tracker announces exactly once (the placement, not the existing record)",
  coldPlacement.newRecords === 1 &&
    coldPlacement.messages?.[0]?.includes("took position **2**") === true &&
    coldPlacement.messages?.[0]?.includes("**Polar**") === true,
  JSON.stringify(coldPlacement.messages),
);

// A record submission announces the world record, naming the submitter — not a
// position, and not the previous holder.
check(
  "e2e: a record submission's message is the WR for the submitter",
  newWr.messages?.[0]?.includes("beat the world record") === true &&
    newWr.messages?.[0]?.includes("**Ash**") === true,
  JSON.stringify(newWr.messages),
);

// A non-record submission names the submitter as the one who placed, never the
// record holder whose run sits above it.
check(
  "e2e: a placement names the submitter, not the record holder",
  placed.messages?.[0]?.includes("**Polar**") === true &&
    placed.messages?.[0]?.includes("**Ash**") === false,
  JSON.stringify(placed.messages),
);

// --- A saved position template drives the message -----------------------------
// Delivery itself is the same `postDiscordMessage` path proven above; what is
// new is that the saved `sitePositionTemplate` (not just the default) is used.
const delivered = buildSitePositionMessage(
  { name: "Cold Run", author: "Polar", arrowName: "Narrow Arrow", hasCustomMechanics: false },
  { username: "Polar", timeMs: 9_000, arrowName: "Narrow Arrow", position: 2 },
  { username: "Ash", timeMs: 7_000 },
  { sitePositionTemplate: "{player} placed {position} [{wrDiff}]" },
);
check(
  "builder: a saved position template renders the placement",
  delivered === "Polar placed 2 [WR +2.000]",
  delivered,
);

console.log(`\n${failures === 0 ? "all" : `${failures} failing`} site tracker checks`);
process.exit(failures === 0 ? 0 : 1);
