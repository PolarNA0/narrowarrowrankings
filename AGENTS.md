<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep navigation grouped through GroupedNavigation with secondary section views, so every feature remains accessible without overcrowding the header.
- Merge single-board and bulk-board updates into the same client leaderboard state, preserving observed PB improvements when older snapshots arrive, so profile totals stay synchronized.
- `/api/all-leaderboards` warms its persisted snapshot in `BATCH`-sized slices per request (`src/routes/api/all-leaderboards.ts`). Never fetch all `LEVELS` in one refresh: the upstream limit is ~120 req/min and a full deep load is 216 requests (~113s), which exceeds the handler's 20s wait, so nothing persists and `loaded` stays 0. Successive requests advance the warm-up and each completed slice is written to the `app_docs` snapshot.
- Profile medal data comes from the live `/user/{username}` fields `medal_counts`, `medal_counts_packs`, `medal_counts_community` (tiers: bronze/silver/gold/platinum/author), plus `custom_levels_completed`, `maps_completed`, `total_maps`, and `daily_stats`. The old `custom_medals`/`official_medals`/`pack_medals` fields never existed upstream — don't reintroduce them.
- Replay input decoding lives in `src/lib/replay.ts`: `inputs` is base64, 4 two-bit symbols per byte (MSB pair first), sampled at 240Hz (1000/240 ≈ 4.1667ms/tick). Symbols: 0=neutral/coast, 1=right steer, 2=left steer, 3=brake (both steer directions held). `ReplayViewer` collapses runs into held segments like `r72`.
- Replay physics (`src/lib/replay-sim.ts`) no longer approximates the game's `Player`. It drives the exact engine - the same Rust/WASM `GameMechanicsEngine` the Flutter app loads via `physics_core_capacitor.js` - bundled at `src/lib/physics/{rust.js,rust_bg.wasm}`. `simulateRun` is async, steps the engine one 240Hz input tick at a time, and records a point every fourth tick (60Hz) to match the render rate; `SIM_TICK_MS = 1000/60` lives in `replay-sim.ts` and `REPLAY_TICK_MS = 1000/240` in `replay.ts`. The engine's `rotation` is 0 facing -y, so `SimPoint.rot = rotation - PI/2`. The old hand-fitted constants (THRUST 114, LINEAR_DAMP 0.19, INERTIA 6600, STEP_S=4*DT) were a wrong model: the real per-tick math is v*=0.9992 aerodynamics, thrust = 0.002*throttle along heading, |v| capped at 10, av=(av+0.0003*steer)*0.979216, throttle +/-1/60. Symbol mapping: 1=right, 2=left, 3=brake. A run can still DNF because the level geometry fetched live postdates the run (recorded Highway Jet runs hit a wall present only in the current revision).
