/**
 * The daily rotation must be stable, deterministic and fair.
 *
 * The Daily tab names a featured level per calendar day. If the pick depended on
 * anything but the date and the candidate list — array order, wall-clock time,
 * device locale — two players would see different levels on the same day, and
 * the board under it would be for the wrong level. This pins the rotation to:
 *
 *  * the same date always yields the same level,
 *  * the pick does not depend on the order of the candidates,
 *  * consecutive days walk the pool in order (no repeats within a cycle),
 *  * every level in the pool is featured exactly once per cycle,
 *  * a one-level pool and an empty pool do not crash,
 *  * the history strip is ordered newest-first and matches the day picks.
 */
import {
  dayKey,
  dayNumber,
  isRunOnDay,
  pickDailyLevel,
  recentDailyLevels,
  runDay,
  type DailyCandidate,
} from "@/lib/daily-level";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const POOL: DailyCandidate[] = [
  { levelId: "B05C7EDE", name: "Blue Slides" },
  { levelId: "801170F9", name: "Diamond Rally" },
  { levelId: "9892299A", name: "Green Cross" },
  { levelId: "1777118905185", name: "Highway Jet" },
];

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

function main() {
  // ---- same date, same pick ------------------------------------------------
  {
    const a = pickDailyLevel(POOL, day("2026-10-20"));
    const b = pickDailyLevel(POOL, day("2026-10-20"));
    check("same date yields the same level", a?.levelId === b?.levelId, `${a?.levelId}`);
    // Same calendar day but a different hour must not change the pick.
    const c = pickDailyLevel(POOL, new Date("2026-10-20T23:59:00Z"));
    const d = pickDailyLevel(POOL, new Date("2026-10-20T00:01:00Z"));
    check("the pick is stable across the whole day", c?.levelId === d?.levelId);
  }

  // ---- order independence --------------------------------------------------
  {
    const a = pickDailyLevel(POOL, day("2026-10-20"));
    const shuffled = [POOL[2], POOL[0], POOL[3], POOL[1]];
    const b = pickDailyLevel(shuffled, day("2026-10-20"));
    check("candidate order does not change the pick", a?.levelId === b?.levelId);
  }

  // ---- a full cycle covers the pool exactly once ---------------------------
  {
    const seen: string[] = [];
    for (let i = 0; i < POOL.length; i++) {
      const d = new Date(Date.UTC(2026, 9, 20) + i * 86_400_000);
      const pick = pickDailyLevel(POOL, d);
      if (pick) seen.push(pick.levelId);
    }
    check("a cycle features every level", new Set(seen).size === POOL.length, seen.join(","));
    check("no repeats inside a cycle", seen.length === new Set(seen).size, `n=${seen.length}`);
  }

  // ---- edge pools ----------------------------------------------------------
  {
    check("an empty pool yields null", pickDailyLevel([], day("2026-10-20")) === null);
    const one = pickDailyLevel([POOL[0]], day("2026-10-20"));
    check("a one-level pool always features it", one?.levelId === POOL[0].levelId);
  }

  // ---- the day key and day number are UTC calendar days --------------------
  {
    check("dayKey is the UTC date", dayKey(new Date("2026-10-20T23:30:00Z")) === "2026-10-20");
    check(
      "consecutive days differ by one",
      dayNumber(day("2026-10-21")) - dayNumber(day("2026-10-20")) === 1,
    );
    check(
      "dayNumber is the same all day",
      dayNumber(new Date("2026-10-20T00:00:00Z")) === dayNumber(new Date("2026-10-20T23:59:59Z")),
    );
  }

  // ---- the history strip ---------------------------------------------------
  {
    const history = recentDailyLevels(POOL, 7, day("2026-10-20"));
    check("history has the requested length", history.length === 7, `${history.length}`);
    check("history is newest first", history[0].date === "2026-10-20", history[0].date);
    check(
      "history days strictly decrease",
      history.every((h, i) => i === 0 || h.date < history[i - 1].date),
    );
    check(
      "history matches the day picks",
      history.every((h) => {
        const pick = pickDailyLevel(POOL, new Date(`${h.date}T12:00:00Z`));
        return pick?.levelId === h.levelId;
      }),
    );
  }

  // ---- the day filter on runs ---------------------------------------------
  {
    check("a UTC timestamp maps to its day", runDay("2026-10-23T00:30:00.000Z") === "2026-10-23");
    check(
      "a late UTC timestamp stays on its day",
      runDay("2026-10-23T23:59:59.000Z") === "2026-10-23",
    );
    check("a run with no date has no day", runDay(null) === null && runDay("") === null);
    check("a malformed date has no day", runDay("not-a-date") === null);
    check("isRunOnDay matches the day", isRunOnDay("2026-10-23T12:00:00Z", "2026-10-23"));
    check("isRunOnDay rejects another day", !isRunOnDay("2026-10-22T12:00:00Z", "2026-10-23"));
  }

  console.log(failures === 0 ? "\nall daily-rotation checks passed" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
