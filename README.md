# Categories Game

Realtime multiplayer "ארץ עיר" built as a web-first product with a dedicated realtime server, MongoDB persistence, Redis-backed room coordination, and AI-assisted validation.

## Workspace

- `apps/web`: Next.js client
- `apps/server`: Express + Socket.IO realtime server
- `packages/shared`: shared types, rules, scoring helpers

## Local development

1. Start MongoDB and Redis with Docker:
   - `docker compose up -d`
2. Verify `.env` exists in the project root.
3. Install dependencies with `npm install`.
4. Run the apps:
   - `npm run dev:server`
   - `npm run dev:web`
5. Open `http://localhost:3000`.

If you do not set `OPENAI_API_KEY`, the app falls back to deterministic validation instead of AI-based category checks.

## Railway

- Deploy `apps/server` as a Node service.
- Deploy `apps/web` as a Next.js service.
- Provision MongoDB and Redis on Railway and set the environment variables from `.env.example`.

