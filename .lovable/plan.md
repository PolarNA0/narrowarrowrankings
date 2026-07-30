# Profile medals, forced legacy runs, theming & fixes

## 1. Correct official medals on profiles

Today the profile's Gold / Silver / Bronze / Top 10 boxes come straight from the game API's `official_medals` field, which knows nothing about legacy runs or runs you removed. That's why Polar shows 18 WRs.

New behaviour: medals are computed in the app from the same merged 64-level leaderboards the rest of the site uses.

- For each of the 64 official levels, build the final standings: API runs + legacy runs merged (best time per player wins), removed runs stripped, one entry per player.
- A player's placement on a level = their position in those standings. Position 1 = gold/WR, 2 = silver, 3 = bronze, top 10 = top-10 count.
- A legacy time that beats every API time counts as the WR — this falls out of the merge automatically.
- Show the recomputed counts, with the API's own numbers kept as a smaller "API reported" line so discrepancies stay visible.
- Medals only count once every level's leaderboard has loaded; while loading, show a "computing" state instead of a wrong number.

## 2. Legacy runs always visible

- Remove the "Legacy: Visible / Hidden" toggle from the header.
- Remove the `hideLegacyRuns` state and its saved setting; legacy runs are always merged into every leaderboard, average, WR and profile calculation.

## 3. Fix removing runs from leaderboards

The `removedRuns` collection is currently empty, so no removal has ever been saved — the cause isn't confirmed yet, so step one is to reproduce and read the actual error instead of guessing.

- Reproduce the removal as a signed-in admin and capture the real error from the write.
- Replace the silent `console.error` + generic alert with a toast that shows the actual failure message.
- Fix whatever the reproduction shows (most likely an auth/permission rejection on the write path or the row not matching on read-back), then verify end to end: remove a run, confirm it disappears from the board, averages and profiles, confirm it appears in the admin "Removed Runs" tab, and restore it.

## 4. Appearance & customizable settings

New "Settings" panel (gear icon in the header), persisted locally:

- **Background themes**: Midnight (current), Deep Ocean, Carbon, Nebula Purple, Forest, and a pure-black AMOLED option — each a full palette swap through the existing design tokens, not one-off colours.
- **Accent colour** picker that drives highlights, WR badges and charts.
- **Density**: comfortable / compact table rows.
- **Time format**: `12.345s` vs `0:12.345`.
- **Animations**: toggle motion effects off for low-end devices.
- **Default landing tab** and default level pack.

## 5. Extra features

- **Medal case** on the profile: per-pack breakdown of golds/silvers/bronzes plus a "closest to WR" shortlist of levels the player is nearest to taking.
- **Podium view** for each level: top-3 highlight strip above the table, with legacy runs marked.
- **Rivals**: on a profile, the players with the most levels within 1 % of that player's times, one click to compare.
- **Global medal table**: leaderboard of all players ranked by golds, then silvers, then bronzes, computed from the same merged standings.

## Technical notes

- Medal computation lives in a new `src/lib/medals.ts` helper fed by `processedAllLevelsData`, so it reuses the existing legacy-merge and removed-run filtering and stays consistent with the Average tab.
- Settings live in a `SettingsContext` with `localStorage` persistence; themes are CSS variable sets in `src/styles.css` applied via a `data-theme` attribute on the root element — no hardcoded colour utilities.
- Removal debugging goes through the browser against the live preview so the real write error is observed, not inferred.
