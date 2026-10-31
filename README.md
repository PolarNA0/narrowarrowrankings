# Narrow Arrow Rankings

A community rankings site for the mobile game **Narrow Arrow**: live leaderboards for every
official and custom level, player profiles and rank assignments, replay playback, and a
community board for tool-assisted (TAS) runs.

**Live app**: https://narrowarrowrankings.lovable.app

## What it does

**Leaderboards & records**
- Per-level leaderboards with arrow filtering, player search and PB-to-WR deltas.
- World and category records, easiest medals, recent runs, and player achievements.
- NarrowScore, total time and averages, rank points, and position points.

**Players**
- Profiles with medals, completion counts, and per-level breakdowns.
- Head-to-head comparison, rivalries, improvement targets, and milestone clubs.
- Community voting and level ratings.

**Customs & skins**
- Browse community levels and completions, plus a randomizer.
- Full skin catalogue and daily skin rotation.

**Tools**
- **Replay viewer** - replays any run with the game's real physics engine.
- **TAS editor** - edit a run input-by-input with undo/redo, drafts and ghost overlays.
- **TAS leaderboard** - one board per arrow, with a shareable record per level.
- **Brute optimizer** - hill-climbs a run's inputs against the real engine.
- **Level editor & generator** - build and export levels in the game's own format.
- **Play** - practice a level in the browser, with checkpoints bridged from a TAS run.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | TanStack Start (React 19, file-based routing) |
| Language | TypeScript |
| Build | Vite + Nitro |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Backend | Supabase (Postgres, auth, RLS) |
| Charts | Recharts |
| Physics | Rust/WASM `GameMechanicsEngine` (the game's own engine) |

## Local development

Requires **Node.js >= 20.19** (or >= 22.12) and npm.

```sh
git clone https://github.com/PolarNA0/narrowarrowrankings.git
cd narrowarrowrankings
npm install
npm run dev
```

Then open the URL Vite prints (default http://localhost:5173).

### Environment

Create a `.env` in the project root:

```sh
# Client-side (safe to expose; protected by RLS)
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>

# Server-side
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable-key>

# Required for server-side writes (TAS board submissions, config). Never expose
# this to the client - it bypasses RLS.
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Without `SUPABASE_SERVICE_ROLE_KEY`, the TAS board falls back to a per-process
in-memory store in development, so writes appear to work but vanish on restart.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

## Data sources

- **Official runs** come from the read-only upstream API (`api.narrowarrow.xyz`), proxied
  server-side through `src/lib/na-proxy.ts`. The upstream API has no submit endpoint, so this
  site **never writes to the game's official leaderboard**.
- **TAS runs** are site-owned records in Supabase (`app_docs`, collection `tas_boards`). They
  exist precisely so tool-assisted runs can be shared without touching the official board.
- **Site config** (tracker webhooks, sheet export settings, badges) also lives in `app_docs`.

## Deployment

The repo is connected to [Lovable](https://lovable.dev/projects/712a12a2-f4ed-4349-9678-37a309567c4c).
Pushing to the connected branch syncs back into the Lovable editor, so avoid force-pushing or
rewriting published history.

## Documentation

- [`AGENTS.md`](./AGENTS.md) - deep notes on the physics engine, replay pipeline, TAS tooling
  and Supabase layout. Start here before changing anything subtle.
- [`narrow-arrow-api-docs.md`](./narrow-arrow-api-docs.md) - the upstream API reference.
- [`roadmap.md`](./roadmap.md) - completed and planned work.

## Contributing

Contributions are welcome. Please open an issue describing the change first for anything
non-trivial, and run `npm run lint` plus `npm run build` before opening a PR.
