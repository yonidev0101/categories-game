# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start infrastructure (MongoDB + Redis)
docker compose up -d

# Dev servers (run in separate terminals)
npm run dev:server   # Express + Socket.IO on :4000
npm run dev:web      # Next.js on :3000

# Build all workspaces
npm run build

# Individual workspace builds
npm --workspace @categories-game/server run build
npm --workspace @categories-game/web run build
```

There are no test scripts configured. Node >=22 is required.

## Railway Deployment

No git repo — Railway uses direct file upload via CLI. Run from project root via bash (not PowerShell — if blocked use `cmd /c` prefix).

```bash
# Deploy services (run from project root)
railway up --service web
railway up --service server

# Check deployment status
railway deployment list -s web --json
railway deployment list -s server --json

# Check which service is currently active
railway status
```

Two services in the `categories-game` Railway project (environment: `production`):
- `web` — Next.js, built with `Dockerfile.web`
- `server` — Express + Socket.IO, built with `Dockerfile.server`

## Architecture

This is an npm workspaces monorepo with three packages:

- **`apps/server`** — Express + Socket.IO realtime server (port 4000)
- **`apps/web`** — Next.js 15 client (port 3000), Hebrew UI
- **`packages/shared`** — Types, scoring logic, and game utilities shared between both apps

### Server Architecture

The server is a single `apps/server/src/index.ts` that wires together:

- **`GameService`** — Core game logic. Rooms are stored **in-memory** (`Map<string, StoredRoom>`). MongoDB and Redis are optional and silently degrade.
- **`MongoPersistence`** — Persists room snapshots, submissions, round results, and AI validation logs. If `MONGODB_URI` is empty or unavailable, all writes are no-ops.
- **`RedisCoordinator`** — Publishes pub/sub notifications (`room:<code>:updates`) for future multi-instance coordination. If `REDIS_URL` is empty, all publishes are no-ops. Redis is **not** the authoritative state.
- **`AIValidatorService`** — Calls OpenAI `/v1/responses` with structured JSON output to validate Hebrew answers. If `OPENAI_API_KEY` is absent, falls back to deterministic validation (non-empty answer = valid).

HTTP REST endpoints handle room creation/join/start/settings. Socket.IO handles real-time events during a round.

### Game Phase State Machine

```
lobby -> in_round -> countdown -> validating -> round_results -> (next round or game_over)
```

- `in_round`: Players fill answers; first player to finish triggers `countdown`
- `countdown`: Timer runs (`countdownSeconds`); remaining players can still submit
- `validating`: All answers locked; AI validation runs per player sequentially
- `round_results` / `game_over`: Scoreboard shown

### Scoring

- Unique answer (only one player answered that category): **15 pts**
- Non-duplicate valid answer: **10 pts**
- Duplicate answer (same normalized text as another player): **5 pts**
- Invalid answer: **0 pts**

`classic` mode: answer must start with the round letter. `advanced` mode: answer must contain both letters anywhere.

### Client Architecture

The web app has two main views:

- **`/` (LandingShell)** — Create or join a room via REST, saves `{ sessionToken, playerId }` to localStorage keyed by room code.
- **`/rooms/[code]` (RoomClient)** — Single large client component managing all game phases. Fetches initial state via REST, then subscribes to Socket.IO events. The session token from localStorage is sent on `join_room` to authenticate the socket connection.

The socket singleton (`apps/web/lib/socket.ts`) is created once and reused across renders with `autoConnect: false`.

### Shared Package

`packages/shared/src/game.ts` contains all pure game logic (scoring, answer normalization, letter validation, room code generation). Both server and client import from `@categories-game/shared`. The package ships both `.ts` source and compiled `.js` — Next.js consumes it as TypeScript directly.

## Environment Variables

Copy `.env.example` to `.env` at the project root. All server vars are read by `apps/server/src/config.ts` via `dotenv`. Web vars (`NEXT_PUBLIC_*`) are read by `apps/web/lib/config.ts`.

Key variables:
- `OPENAI_API_KEY` — optional; omit for deterministic fallback validation
- `OPENAI_MODEL` — defaults to `gpt-4.1-mini`
- `MONGODB_URI` / `REDIS_URL` — optional; server runs fully in-memory without them
