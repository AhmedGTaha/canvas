# Canvas

Canvas is an AI-assisted website builder. Members organize a website as a page tree,
describe pages and reusable sections in natural language, preview the result safely,
undo and restore their work, and export the finished site as a standalone Next.js +
TypeScript project.

Everything Canvas generates is **frontend-only**: there is no generated backend, and
generated code never runs on the Canvas server.

## Features

- **Accounts and workspaces** — Argon2id credentials, opaque session cookies, per-project owner/collaborator roles, invitation links.
- **Page tree** — folders and pages, canonical routes, homepage selection, SEO metadata, duplication, soft deletion.
- **Media library** — private, project-scoped images served only through authenticated routes.
- **Brand and theme** — company identity, logos, semantic light/dark color sets, and design scales resolved into CSS tokens.
- **AI page generation** — durable jobs, immutable Page Versions, structured validation, restricted compilation.
- **Building Blocks** — reusable sections; global blocks resolve through one stable UUID and propagate everywhere.
- **Element-level editing** — click a region in the Preview and ask Canvas to change that region only.
- **History** — Change Sets, Undo/Redo with conflict protection, Page/Block version history and restore, named project checkpoints.
- **Export** — validated ZIP containing a runnable Next.js project with no Canvas internals.

## Prerequisites

- Node.js 22 or newer, npm 10 or newer
- PostgreSQL 15 or newer (or Docker with Compose)
- Writable disk for private object storage (uploaded media and export archives)
- Optional: a Gemini API key for AI generation

## Local setup

```bash
npm install
cp .env.example .env          # then edit the placeholders
docker compose up -d postgres # or point DATABASE_URL at your own PostgreSQL
npm run db:migrate
npm run dev                   # Canvas at http://localhost:3000
npm run worker                # in a second terminal: AI + export worker
```

`PREVIEW_TOKEN_SECRET` must be at least 32 random characters, otherwise Preview refuses
to start. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run worker` | Durable worker: AI generation, export jobs, periodic housekeeping |
| `npm run maintenance` | One-shot housekeeping pass (for a scheduler/cron) |
| `npm run db:migrate` | Apply every pending migration in order |
| `npm test` | Full test suite |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run test:ai-provider` | Optional paid smoke check against the real AI provider |

Extra test switches:

```bash
CANVAS_E2E_BUILD=1 npx vitest run src/domain/journey.e2e.test.ts   # also npm install + next build the exported ZIP
CANVAS_EXPORT_BUILD=full npm test                                  # run every export job through a real next build
```

## Database migrations

Migrations are plain, ordered SQL files in `migrations/`, applied inside a transaction
and recorded in `schema_migrations`. `npm run db:migrate` is idempotent: it applies only
files that have not run yet, so the same command works for a fresh database (`0001 →
latest`) and for upgrading an existing one.

Migrations are forward-only. To roll back, restore a database backup.

## Storage

`STORAGE_DRIVER=local` writes private objects under `LOCAL_STORAGE_PATH`
(`.canvas-storage` by default). The directory is gitignored and must be writable and
included in backups: it holds uploaded media bytes and export archives. Media is served
only through the authenticated `/api/media/{assetId}` route or a short-lived, project-
scoped Preview token. Object keys are never exposed to clients.

## AI provider

Canvas boots and runs without AI credentials; generation fails safely with a plain
message. To enable it set `AI_PROVIDER=gemini`, a server-only `GEMINI_API_KEY`, and
optionally `AI_MODEL` and `AI_PROVIDER_TIMEOUT_MS`, then run `npm run worker`.

The provider adapter never reads Canvas persistence. Context is assembled by the Project
Context Builder from authorized project data only, and the orchestration service is the
only component that persists results.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `APP_URL` | Yes | Public Canvas origin; used for links and Preview frame ancestry. |
| `PREVIEW_TOKEN_SECRET` | Yes | HMAC secret (32+ characters) for Preview sessions. |
| `NODE_ENV` | Runtime | `production` enables Secure session cookies. |
| `STORAGE_DRIVER` | No | Object storage adapter; `local` (default). |
| `LOCAL_STORAGE_PATH` | No | Private object root; defaults to `.canvas-storage`. |
| `MEDIA_MAX_BYTES` | No | Maximum bytes per uploaded image; defaults to 10 MB. |
| `PREVIEW_TOKEN_TTL_SECONDS` | No | Preview session lifetime (30–900); defaults to `300`. |
| `INVITE_TTL_DAYS` | No | Invitation lifetime; defaults to `7`. |
| `LEASE_DURATION_SECONDS` | No | Editing lease lifetime; defaults to `60`. |
| `AI_PROVIDER` | No | Provider selection; `gemini` (default). |
| `GEMINI_API_KEY` | For AI only | Server-only provider credential. |
| `AI_MODEL` | No | Model name; defaults to `gemini-2.5-flash`. |
| `AI_PROVIDER_TIMEOUT_MS` | No | Provider timeout; defaults to `120000`. |
| `CANVAS_EXPORT_BUILD` | No | `typecheck` (default) or `full` to run a real `next build` per export. |
| `CANVAS_METRICS_TOKEN` | No | Enables `GET /api/internal/metrics` for callers with this bearer token. |

## Deployment

1. Provision PostgreSQL 15+ and persistent storage for `LOCAL_STORAGE_PATH`.
2. Set every required variable above; set `NODE_ENV=production` and an `APP_URL` on HTTPS.
3. Run `npm run db:migrate` before starting new application instances.
4. Start the web process (`npm run build && npm start`) and at least one `npm run worker`.
   The worker is required for AI generation and exports; without it those jobs stay queued.
5. Schedule `npm run maintenance` (every few minutes is fine) if you do not run a worker,
   or rely on the worker's built-in idle housekeeping.
6. Probe `GET /api/health` for liveness and database reachability.

Preview runs in an `allow-scripts` opaque-origin iframe under a restrictive CSP. In
production, serving the Preview routes from a **separate origin** to `APP_URL` gives the
strongest isolation; the same token-backed routes work unchanged.

## Operations

Canvas emits one structured JSON line per operational event (`auth.failed`,
`access.denied`, `invite.*`, `generation.*`, `validation.failed`,
`preview.compile_failed`, `history.*`, `export.*`, `storage.failed`, `permission.changed`,
`maintenance.*`). Tokens, secrets, storage keys, signed URLs, prompts, and generated
source are redacted before anything is written. Counters and durations are also kept in
process and exposed via `/api/internal/metrics` when `CANVAS_METRICS_TOKEN` is set.

Housekeeping is idempotent and never touches history: it expires stale editing leases,
fails jobs abandoned by a crashed worker, releases export archives past retention (always
keeping each project's newest download), and removes export scratch directories. Media,
Page/Block Versions, Change Sets, and Checkpoints are never deleted.

## Quality checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Integration tests run against `DATABASE_URL` and truncate application tables. Point them
at an expendable local database only.

## Architecture

- `src/app` — routes and thin server actions.
- `src/components` — presentation components with no database access.
- `src/domain` — validation, repositories, and independently testable services: auth, workspaces, projects, pages, media, theme, collaboration, AI generation, blocks, history, export, maintenance.
- `src/generated-runtime` — Preview manifest, signed sessions, restrictive response policy, isolated document renderer, runtime router and messaging.
- `src/server` — database client and migrations, authorization, sessions, object storage, jobs, observability, HTTP error normalization.
- `migrations` — deterministic SQL with the database-level integrity constraints Canvas depends on.

Immutable history is the backbone: Page Versions, Block Versions, Change Sets, and
Checkpoints are never mutated or deleted. Restores move active pointers and are recorded
as auditable, reversible Change Sets.
