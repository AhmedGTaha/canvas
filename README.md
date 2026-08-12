# Canvas

Canvas is an AI-assisted website-building SaaS. The current foundation includes secure authentication, user-owned workspaces, isolated projects, project-level collaboration, expiring invitation links, access revocation, and editing leases for later content domains.

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

Open [http://localhost:3000](http://localhost:3000), create an account, then create a workspace and project. Project owners can manage invitation links and members from a project’s Collaborators screen. Shared projects appear separately on a collaborator’s dashboard.

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
- `src/domain` contains validation, repositories, and independently testable workspace, project, authentication, invitation, membership, and lease services.
- `src/server/auth` owns cookie/session integration.
- `src/server/permissions` centralizes authorization checks.
- `src/server/db` owns the PostgreSQL client, schema mapping, and migration runner.
- `migrations` contains deterministic SQL migrations and database integrity constraints.

Sessions are opaque random tokens stored only in HTTP-only, same-site cookies; only token hashes are persisted. Credentials use Argon2id. Invitation tokens follow the same plaintext-once/hash-at-rest model and expire after seven days by default. Every workspace/project operation derives the user ID from the server session and rechecks the effective owner/collaborator role server-side.

Editing leases use a 60-second default timeout. The unique `(project_id, target_type, target_id)` key and conditional PostgreSQL upsert prevent two users from acquiring the same active target. Pages and building blocks do not exist yet; their project-ownership validation will be added with those later domains before lease APIs are exposed to a builder UI.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string for application data, sessions, and auth throttling. |
| `APP_URL` | Yes | Public Canvas origin, reserved for redirects and links as later phases expand. |
| `NODE_ENV` | Set by runtime | Enables production-only secure cookie behavior. |
| `INVITE_TTL_DAYS` | No | Invitation lifetime; defaults to `7`. |
| `LEASE_DURATION_SECONDS` | No | Active editing lease lifetime; defaults to `60`. |

No AI, object-storage, worker, or generated-runtime configuration is required yet.
