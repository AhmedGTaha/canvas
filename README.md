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

Open [http://localhost:3000](http://localhost:3000), create an account, then create a workspace and project. The Pages screen manages site structure and URLs. Brand / Theme manages company identity, semantic colors, controlled design scales, and a live light/dark preview. Project owners manage invitation links and members from Collaborators.

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
- `migrations` contains deterministic SQL migrations and database integrity constraints.

Sessions are opaque random tokens stored only in HTTP-only, same-site cookies; only token hashes are persisted. Credentials use Argon2id. Invitation tokens follow the same plaintext-once/hash-at-rest model and expire after seven days by default. Every workspace/project operation derives the user ID from the server session and rechecks the effective owner/collaborator role server-side.

Page routes are stored as canonical current metadata and uniquely constrained per active project. Only page ancestors contribute URL segments; folders remain organizational. Project-scoped advisory transaction locks serialize tree changes so cycle, route, homepage, and sibling-order checks operate on the latest tree. Current SEO metadata lives on `page_nodes`; future immutable page versions will snapshot it without changing page UUID identity.

Editing leases use a 60-second default timeout. The unique `(project_id, target_type, target_id)` key and conditional PostgreSQL upsert prevent two users from acquiring the same active target. Page targets are now verified against active pages in the same project; building-block verification will arrive with that domain.

Project themes use strict semantic `#RRGGBB` light/dark color sets and normalized `0–100` design scales. The shared resolver converts these into serializable radius, spacing, shadow, typography, border, and `--project-*` CSS tokens. Revision-checked autosave prevents stale writes. Brand rows include nullable future media UUIDs, but logo selection and same-project media foreign keys are intentionally deferred until Phase 5 introduces `media_assets`; arbitrary logo URLs are not supported.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for application data, sessions, and auth throttling. |
| `APP_URL` | Yes | Public Canvas origin, reserved for redirects and links as later phases expand. |
| `NODE_ENV` | Set by runtime | Enables production-only secure cookie behavior. |
| `INVITE_TTL_DAYS` | No | Invitation lifetime; defaults to `7`. |
| `LEASE_DURATION_SECONDS` | No | Active editing lease lifetime; defaults to `60`. |

No AI, object-storage, worker, or generated-runtime configuration is required yet.
