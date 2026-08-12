# Canvas

Canvas is an AI-assisted website-building SaaS. The current foundation includes authentication, isolated projects, collaboration, a structural page tree, and a centralized project identity/theme system with semantic light and dark design tokens.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- PostgreSQL 15 or newer, or Docker with Compose

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env`. The example is ready for the included local PostgreSQL container; use a different `DATABASE_URL` if PostgreSQL already runs elsewhere.

3. Start PostgreSQL:

   ```bash
   docker compose up -d postgres
   ```

4. Run all committed migrations:

   ```bash
   npm run db:migrate
   ```

5. Start Canvas:

   ```bash
   npm run dev
   ```

6. In another terminal, start the durable PostgreSQL-backed AI worker:

   ```bash
   npm run worker
   ```

Open [http://localhost:3000](http://localhost:3000), create an account, then create a workspace and project. The Pages screen manages site structure and URLs. Media provides a private, project-scoped image library. Brand / Theme manages company identity, logos selected from Media, semantic colors, controlled design scales, and a live light/dark preview. Project owners manage invitation links and members from Collaborators.

Builder renders the controlled project runtime in an iframe sandbox with an opaque origin. Preview sessions and asset URLs use short-lived HMAC tokens, so set `PREVIEW_TOKEN_SECRET` to a private random value of at least 32 characters. The local same-origin route is a development compromise: `allow-same-origin` is deliberately omitted, embedded resource requests are credentialless, preview responses have a restrictive CSP, and preview code cannot read Canvas cookies or browser storage. Production can move the same token-backed routes to a dedicated preview origin for stronger process/origin isolation. Light mode uses the primary logo; Dark mode uses the alternate logo when available and otherwise falls back to primary. Membership is rechecked for token-protected requests. A removed collaborator may retain already-rendered, non-sensitive manifest text until the isolated frame refreshes, but cannot load protected media or create a new session; tokens expire after five minutes by default.

## Quality checks

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Integration tests use `DATABASE_URL` and clear records from the Phase 1 tables. Run them only against an expendable local/test database. For a separate database, provide the URL explicitly, migrate it first, then run the test command.

## Architecture

- `src/app` contains routes and thin server actions.
- `src/components` contains reusable UI and feature presentation components with no database access.
- `src/domain` contains validation, repositories, and independently testable workspace, project, authentication, collaboration, page-tree, theme, design-token, and lease services.
- `src/server/auth` owns cookie/session integration.
- `src/server/permissions` centralizes authorization checks.
- `src/server/db` owns the PostgreSQL client, schema mapping, and migration runner.
- `src/server/storage` defines object storage and its local development adapter.
- `src/generated-runtime` owns the versioned preview manifest, signed sessions, restrictive response policy, isolated document renderer, runtime router, messaging protocol, and placeholder content-provider boundary.
- `migrations` contains deterministic SQL migrations and database integrity constraints.

Sessions are opaque random tokens stored only in HTTP-only, same-site cookies; only token hashes are persisted. Credentials use Argon2id. Invitation tokens follow the same plaintext-once/hash-at-rest model and expire after seven days by default. Every workspace/project operation derives the user ID from the server session and rechecks the effective owner/collaborator role server-side.

Page routes are stored as canonical current metadata and uniquely constrained per active project. Only page ancestors contribute URL segments; folders remain organizational. Project-scoped advisory transaction locks serialize tree changes so cycle, route, homepage, and sibling-order checks operate on the latest tree. Current SEO metadata lives on `page_nodes`; future immutable page versions will snapshot it without changing page UUID identity.

Editing leases use a 60-second default timeout. The unique `(project_id, target_type, target_id)` key and conditional PostgreSQL upsert prevent two users from acquiring the same active target. Page targets are now verified against active pages in the same project; building-block verification will arrive with that domain.

Project themes use strict semantic `#RRGGBB` light/dark color sets and normalized `0–100` design scales. The shared resolver converts these into serializable radius, spacing, shadow, typography, border, and `--project-*` CSS tokens. Revision-checked autosave prevents stale writes. Brand logos reference stable, same-project media UUIDs; arbitrary logo URLs are not supported.

Media metadata and hierarchy live in PostgreSQL while image bytes live behind the `ObjectStorage` interface. Local development stores private objects under `.canvas-storage` by default; this directory is gitignored and must remain writable by the Canvas server. Files are only returned through the authenticated `/api/media/{assetId}` route. Moving or renaming library items never moves object keys, and soft deletion intentionally retains binaries for future version history.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for application data, sessions, and auth throttling. |
| `APP_URL` | Yes | Public Canvas origin, reserved for redirects and links as later phases expand. |
| `NODE_ENV` | Set by runtime | Enables production-only secure cookie behavior. |
| `INVITE_TTL_DAYS` | No | Invitation lifetime; defaults to `7`. |
| `LEASE_DURATION_SECONDS` | No | Active editing lease lifetime; defaults to `60`. |
| `STORAGE_DRIVER` | No | Object storage adapter; Phase 5 supports `local` (default). |
| `LOCAL_STORAGE_PATH` | No | Local private object root; defaults to `.canvas-storage`. |
| `MEDIA_MAX_BYTES` | No | Maximum bytes per uploaded image; defaults to `10485760` (10 MB). |
| `PREVIEW_TOKEN_SECRET` | Yes | Private HMAC secret of at least 32 characters for preview sessions. |
| `PREVIEW_TOKEN_TTL_SECONDS` | No | Preview session lifetime, constrained to 30–900 seconds; defaults to `300`. |
| `AI_PROVIDER` | No | Server-side provider selection; Phase 7 supports `gemini` (default). |
| `GEMINI_API_KEY` | For AI only | Server-only Gemini credential. Normal Canvas features work without it. |
| `AI_MODEL` | No | Gemini model name; defaults to `gemini-2.5-flash`. |
| `AI_PROVIDER_TIMEOUT_MS` | No | Provider request timeout; defaults to `120000`. |

AI credentials are optional. Without them, Canvas and Project Settings continue to work; an AI job fails safely with “AI is not configured for this environment.” For AI operations, set `AI_PROVIDER=gemini`, a server-only `GEMINI_API_KEY`, and optionally `AI_MODEL` and `AI_PROVIDER_TIMEOUT_MS`. Run `npm run worker` beside the application. Jobs are claimed using PostgreSQL row locking, survive browser navigation, retry transient failures at most three times, and honor cancellation between stages. Gemini client-side abort stops local response handling but may not stop provider billing after submission, so cancelled responses are discarded. Run the optional paid smoke check with `npm run test:ai-provider` only when credentials are configured.

The provider adapter never reads Canvas persistence. Project-owned data is authorized and assembled by the Project Context Builder, prompt semantics are applied by a provider-neutral assembler, and only the orchestration service persists normalized results and usage. Context includes bounded project identity, brand/theme, current instruction revision, active page structure, selected media metadata, recent conversation history, and canonical frontend-only constraints. Every lookup carries the current project ID; foreign page, conversation, media, and job IDs are rejected.
