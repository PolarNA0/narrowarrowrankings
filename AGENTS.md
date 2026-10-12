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
- Replay physics (`src/lib/replay-sim.ts`) reproduces the game's `Player` (`RigidBody2D`): `_physics_process` forces `delta = 1/60`, so one physics step consumes **four** 240Hz input samples (`INPUTS_PER_STEP = 4`). Two rate corrections matter: the throttle spins up over `engine_startup_ticks` (60 at 240Hz = 0.25s), so a 60Hz step must ramp it by **four** `DT` increments (`STEP_S = 4*DT`) — ramping by one `DT` left the arrow crawling the first second, the reported "starts late"; and the fitted constants come from the shipped engine's real free-flight/steer response (`THRUST = 114`, `LINEAR_DAMP = 0.19`, `INERTIA = 6600`). Symbol mapping is 1=right / 2=left; neutral spins throttle up, only brake (3) spins it down. A run ends near the finish rather than crossing at the recorded time because the level geometry is fetched live and can postdate the run.
