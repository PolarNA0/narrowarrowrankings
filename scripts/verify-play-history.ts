/**
 * The run log is the safety net for automatic upload: a finished run must
 * survive a restart (and a reload) even when its upload failed, and the log must
 * stay bounded and never corrupt storage. These checks drive the real
 * `play-history` module over a stubbed `localStorage`, so the trimming, the
 * per-level filtering and the upload-outcome update are exercised as written.
 */
import {
  addPlayHistory,
  clearPlayHistory,
  listPlayHistory,
  loadAutoUpload,
  loadPlayerName,
  playHistoryFor,
  saveAutoUpload,
  savePlayerName,
  setPlayHistoryUpload,
  type PlayHistoryEntry,
} from "@/lib/play-history";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/** A localStorage stub whose write can be forced to throw at a size limit. */
function makeStorage(limitBytes = Infinity) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const projected = [...map.entries()]
        .filter(([key]) => key !== k)
        .reduce((n, [key, val]) => n + key.length + val.length, 0);
      if (projected + k.length + v.length > limitBytes) {
        throw new Error("QuotaExceededError");
      }
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

function install(storage: ReturnType<typeof makeStorage>) {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

function entry(over: Partial<Parameters<typeof addPlayHistory>[0]> = {}) {
  return {
    levelId: "LVL",
    levelName: "Highway Jet",
    arrowName: "Narrow Arrow",
    tick: 2400,
    timeMs: 10000,
    speed: 1,
    finished: true,
    realTime: true,
    inputs: "AAAA",
    inputCount: 4,
    ...over,
  };
}

// --- A finished run is recorded and read back ---------------------------------
install(makeStorage());
const first = addPlayHistory(entry({ timeMs: 9000, isPb: true }));
const all = listPlayHistory();
check("a run is recorded", all.length === 1 && all[0].id === first.id);
check("the PB flag is kept", all[0].isPb === true);
check("a run starts with no upload outcome", all[0].upload === undefined);

// --- Newest first, and filtered per level+arrow -------------------------------
addPlayHistory(entry({ timeMs: 8500, arrowName: "Speedy Arrow" }));
addPlayHistory(entry({ timeMs: 8000 }));
const ordered = listPlayHistory();
check("the log is newest-first", ordered[0].timeMs === 8000 && ordered[2].timeMs === 9000);
const narrow = playHistoryFor("LVL", "Narrow Arrow");
check(
  "history is filtered per level+arrow",
  narrow.length === 2 && narrow.every((e) => e.arrowName === "Narrow Arrow"),
  `${narrow.length} rows`,
);
check("a different arrow is not mixed in", playHistoryFor("LVL", "Energy Arrow").length === 0);

// --- An upload outcome is attached to the right row ---------------------------
setPlayHistoryUpload(first.id, { kind: "site", status: "ok", rank: 3, isRecord: false });
const updated = listPlayHistory().find((e: PlayHistoryEntry) => e.id === first.id);
check("the upload outcome lands on its row", updated?.upload?.status === "ok");
check("the rank is kept", updated?.upload?.rank === 3);
check(
  "other rows are untouched",
  listPlayHistory().find((e) => e.id !== first.id)?.upload === undefined,
);

// --- A non-1x run is recorded but not marked real-time ------------------------
addPlayHistory(entry({ speed: 0.1, realTime: false }));
const slow = listPlayHistory().find((e) => e.realTime === false);
check("a non-1x run is logged", slow !== undefined && slow.speed === 0.1);

// --- The log is bounded, dropping the oldest ----------------------------------
install(makeStorage());
for (let i = 0; i < 60; i++) addPlayHistory(entry({ timeMs: 1000 + i }));
const bounded = listPlayHistory();
check("the log is capped", bounded.length === 50, `${bounded.length} rows`);
check(
  "the cap drops the oldest, keeps the newest",
  bounded[0].timeMs === 1059 && bounded[bounded.length - 1].timeMs === 1010,
);

// --- A full storage quota sheds entries instead of losing the log -------------
install(makeStorage(4000));
let stored = 0;
for (let i = 0; i < 40; i++) {
  addPlayHistory(entry({ timeMs: 2000 + i, inputs: "A".repeat(200) }));
  stored = listPlayHistory().length;
}
check("a quota-limited write still keeps a log", stored > 0, `${stored} rows kept`);
check(
  "the kept log is valid JSON-backed entries",
  listPlayHistory().every((e) => e.id.length > 0),
);

// --- The name and the auto-upload switch persist ------------------------------
install(makeStorage());
check("auto-upload defaults to on", loadAutoUpload() === true);
check("the name starts empty", loadPlayerName() === "");
savePlayerName("Polar");
saveAutoUpload(false);
check("the name round-trips", loadPlayerName() === "Polar");
check("auto-upload round-trips", loadAutoUpload() === false);
saveAutoUpload(true);
check("auto-upload turns back on", loadAutoUpload() === true);

// --- Clearing empties the log -------------------------------------------------
install(makeStorage());
addPlayHistory(entry());
addPlayHistory(entry());
check("there are rows before the clear", listPlayHistory().length === 2);
clearPlayHistory();
check("clearing empties the log", listPlayHistory().length === 0);

// --- Corrupt storage is tolerated --------------------------------------------
install(makeStorage());
(
  globalThis as { window: { localStorage: { getItem: (k: string) => string } } }
).window.localStorage = { getItem: () => "not json" } as never;
check("corrupt storage yields an empty log", listPlayHistory().length === 0);

console.log(
  failures === 0
    ? "\nall play-history checks passed"
    : `\n${failures} play-history check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
