# AGENTS.md

SGC feedback bot: receives DMs on SGC (social.giorgiovola.casa), asks the sender to confirm
("si"/"no"), and on "si" creates a task in an Orbit project column.

## Stack

- Bun + TypeScript, no runtime dependencies (plain `fetch`). Bun loads `.env` automatically.
- `bun run start` / `bun run dev` (watch) / `bun run typecheck` (run `bun install` first).

## Layout

- `src/index.ts`: bot logic. Message queue (one at a time, in order), confirmation flow,
  persisted state (`state.json`: `lastMessageId` + per-user pending feedback), task formatting.
- `src/sgc.ts`: SGC bot API client (REST + message stream, 429 retry).
- `src/orbit.ts`: Orbit client over the public REST API `/api/public/v1`
  ([docs](https://github.com/coollabsio/orbit/blob/main/docs/public-api.md)).
  At startup resolves workspace (`GET /me`), project by `ORBIT_PROJECT_KEY`, status by
  `ORBIT_STATUS_NAME`; then `POST /workspaces/{ws}/tasks`.
- `src/config.ts`: env vars (see `.env.example`).

## Conventions

- User-facing bot messages are in Italian.
- Answers are parsed case/accent/punctuation-insensitively ("Sì!" == "si"); "si"/"yes" confirm, "no" cancels.
- On first run (no `state.json`) old DMs are skipped, not answered.
- Keep it dependency-free and small; match the existing client style (`request()` helper with
  429 `Retry-After` handling, errors prefixed `[sgc]` / `[orbit]`).

## Orbit token

- Needs scopes `tasks:read` + `tasks:write` on the target project.
- Prefer a service-account token (Settings → API tokens): tasks are authored by the bot,
  not a person, and it doesn't break if that person's account changes.

## Testing

- No test suite. Verify with `bun run typecheck`, and check Orbit config read-only with
  `bun -e 'import {initOrbit} from "./src/orbit"; await initOrbit()'`.
- Don't create real Orbit tasks or send SGC messages while testing unless asked.
- Never commit `.env` or `state.json`.
