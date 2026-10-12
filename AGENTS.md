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
- Profile medal data comes from the live `/user/{username}` fields `medal_counts`, `medal_counts_packs`, `medal_counts_community` (tiers: bronze/silver/gold/platinum/author), plus `custom_levels_completed`, `maps_completed`, `total_maps`, and `daily_stats`. The old `custom_medals`/`official_medals`/`pack_medals` fields never existed upstream — don't reintroduce them.
- Replay input decoding lives in `src/lib/replay.ts`: `inputs` is base64, 4 two-bit symbols per byte (MSB pair first), sampled at 240Hz (1000/240 ≈ 4.1667ms/tick). Symbols: 0=left, 1=right, 2=neutral, 3=brake (both steer directions). The left/right label order is a best-effort guess kept in `REPLAY_SYMBOLS`, so flip it in that one place if a replay is ever confirmed to steer the other way. `ReplayViewer` collapses runs into held segments like `r72`.
