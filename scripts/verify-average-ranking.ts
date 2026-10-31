/**
 * Verify the average table's ordering and overall-rank resolution.
 *
 * Run: npx tsx scripts/verify-average-ranking.ts
 *
 * The bug this pins: the table used to be ordered by average position only, so a
 * player with a faster total time could sit below a slower one and look wrong.
 * Both orderings are legitimate, so the fix is to offer both and to label them —
 * these checks assert each ordering is actually by its own metric, and that the
 * two can disagree (which is why the toggle exists at all).
 */
import { DEFAULT_OVERALL_RANKS, RANK_ORDER } from "@/constants";
import {
  resolveOverallRank,
  sortAverageRows,
  timeToNextRank,
  type RankableRow,
} from "@/lib/average-ranking";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass += 1;
    console.log(`OK   ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// ---- Ordering ------------------------------------------------------------
{
  const rows: RankableRow[] = [
    { avgPosition: 2.0, totalTime: 900 }, // worse average, faster total
    { avgPosition: 1.5, totalTime: 1100 }, // better average, slower total
    { avgPosition: 3.0, totalTime: 700 }, // worst average, fastest total
  ];

  const byPos = sortAverageRows(rows, "position");
  check(
    "position order sorts by avg position ascending",
    byPos.map((r) => r.avgPosition).join(",") === "1.5,2,3",
    byPos.map((r) => r.avgPosition).join(","),
  );

  const byTotal = sortAverageRows(rows, "total");
  check(
    "total order sorts by total time ascending",
    byTotal.map((r) => r.totalTime).join(",") === "700,900,1100",
    byTotal.map((r) => r.totalTime).join(","),
  );

  // The reported bug: a slower total above a faster one. Under total ordering
  // that can never happen, which is the property to pin.
  const monotonic = byTotal.every((r, i) => i === 0 || byTotal[i - 1].totalTime <= r.totalTime);
  check("total order is monotonic in total time", monotonic);

  check(
    "the two orderings genuinely disagree",
    byPos.map((r) => r.totalTime).join(",") !== byTotal.map((r) => r.totalTime).join(","),
  );

  check(
    "sorting does not mutate the input",
    rows[0].avgPosition === 2.0 && rows[0].totalTime === 900,
  );
}

// ---- Tie-breaking --------------------------------------------------------
{
  const tied: RankableRow[] = [
    { avgPosition: 2.0, totalTime: 500 },
    { avgPosition: 2.0, totalTime: 400 },
  ];
  const byPos = sortAverageRows(tied, "position");
  check(
    "equal avg position breaks the tie on total time",
    byPos[0].totalTime === 400 && byPos[1].totalTime === 500,
  );
  const byTotal = sortAverageRows(
    [
      { avgPosition: 3.0, totalTime: 400 },
      { avgPosition: 1.0, totalTime: 400 },
    ],
    "total",
  );
  check("equal total time breaks the tie on avg position", byTotal[0].avgPosition === 1.0);
}

// ---- Rank resolution -----------------------------------------------------
{
  // Champion cutoff 23.05, Elite 24.10 in DEFAULT_OVERALL_RANKS.
  const champ = resolveOverallRank(23.0, RANK_ORDER, DEFAULT_OVERALL_RANKS);
  check("a time under the Champion cutoff is Champion", champ.rankId === "Champion", champ.rankId);
  check("Champion has no next rank", champ.nextRankId === null && champ.nextCutoff === null);

  const elite = resolveOverallRank(24.0, RANK_ORDER, DEFAULT_OVERALL_RANKS);
  check("a time between cutoffs resolves to the next rank", elite.rankId === "Elite", elite.rankId);
  check(
    "the next rank is the faster one, with its cutoff",
    elite.nextRankId === "Champion" && elite.nextCutoff === 23.05,
    `${elite.nextRankId} @ ${elite.nextCutoff}`,
  );

  const gap = timeToNextRank(24.0, elite);
  check("the gap to the next rank is exact", gap != null && Math.abs(gap - 0.95) < 1e-9, `${gap}`);

  const exact = resolveOverallRank(23.05, RANK_ORDER, DEFAULT_OVERALL_RANKS);
  check("a time exactly on the cutoff earns that rank", exact.rankId === "Champion", exact.rankId);

  // A 0 cutoff must never be satisfied — it would otherwise swallow every time.
  const zeroConfig = {
    ...DEFAULT_OVERALL_RANKS,
    Champion: { ...DEFAULT_OVERALL_RANKS.Champion, timeCutoff: 0 },
  };
  const withZero = resolveOverallRank(1000, RANK_ORDER, zeroConfig);
  check(
    "a zero cutoff is skipped rather than matching every time",
    withZero.rankId !== "Champion",
    withZero.rankId,
  );

  const slow = resolveOverallRank(9999, RANK_ORDER, DEFAULT_OVERALL_RANKS);
  check(
    "a very slow time falls to the last rank",
    slow.rankId === RANK_ORDER[RANK_ORDER.length - 1],
    slow.rankId,
  );
  check("the last rank has no next rank", slow.nextRankId === null);
}

// ---- Scaling (a single pack is a fraction of every level) ----------------
{
  // At half scale the Champion cutoff is 23.05 / 2 = 11.525, so a 10s total is
  // Champion. The same total is also Champion at full scale, so the meaningful
  // assertion is that the *boundary* moves with the scale factor.
  const half = resolveOverallRank(10.0, RANK_ORDER, DEFAULT_OVERALL_RANKS, 0.5);
  check(
    "a scaled cutoff is compared against the scaled total",
    half.rankId === "Champion",
    half.rankId,
  );

  const boundary = resolveOverallRank(12.0, RANK_ORDER, DEFAULT_OVERALL_RANKS, 0.5);
  check(
    "a total just past the scaled Champion cutoff drops a rank",
    boundary.rankId === "Elite",
    `12.0 vs 11.525 -> ${boundary.rankId}`,
  );
  check(
    "the next-rank cutoff is scaled too",
    boundary.nextRankId === "Champion" && Math.abs((boundary.nextCutoff ?? 0) - 11.525) < 1e-9,
    `${boundary.nextRankId} @ ${boundary.nextCutoff}`,
  );

  const gap = timeToNextRank(12.0, boundary);
  check("the scaled gap is exact", gap != null && Math.abs(gap - 0.475) < 1e-9, `${gap}`);
}

// ---- Real config sanity --------------------------------------------------
{
  const cutoffs = RANK_ORDER.map((id) => DEFAULT_OVERALL_RANKS[id]?.timeCutoff ?? 0);
  const ascending = cutoffs.every((c, i) => i === 0 || c >= cutoffs[i - 1]);
  check("rank cutoffs increase from fastest to slowest", ascending, cutoffs.join(" < "));
  check(
    "every rank in RANK_ORDER has a config entry",
    RANK_ORDER.every((id) => !!DEFAULT_OVERALL_RANKS[id]),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
