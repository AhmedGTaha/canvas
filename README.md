# Canvas

Canvas is an AI-assisted website builder. Members organize a website as a page tree,
describe pages and reusable sections in natural language, preview the result safely,
undo and restore their work, and export the finished site as a standalone Next.js +
TypeScript project.

Everything Canvas generates is **frontend-only**: there is no generated backend, and
generated code never runs on the Canvas server.

**Generated document versus export target.** What a model produces is a safe static Canvas
document — an HTML body fragment, authored CSS, and optional vanilla browser JavaScript —
never React, JSX, TSX, or Next.js source. That document is what Canvas validates, previews,
versions, and stores. The *export* step is separate: Canvas assembles the safe documents
into a runnable **Next.js + React + TypeScript** project shell. Next.js is the export
target, not the thing the model writes.

## Features

- **Accounts and workspaces** — Argon2id credentials, opaque session cookies, per-project owner/collaborator roles, invitation links.
- **Page tree** — folders and pages, canonical routes, homepage selection, SEO metadata, duplication, soft deletion.
- **Media library** — private, project-scoped images served only through authenticated routes.
- **Brand and theme** — company identity, logos, semantic light/dark color sets, and design scales resolved into CSS tokens.
- **AI page generation** — durable jobs, a first-class PageDesignPlan before source, immutable Page Versions, and deterministic HTML/CSS/JS validation. New pages are planned, similarity-checked against the rest of the project, and only then generated as a safe static document.
- **Bring your own AI** — account-owned provider connections (Gemini, OpenAI, Anthropic, OpenAI-compatible), encrypted credentials, one model selection per person, and usage, latency and cost analytics by account and by project.
- **Building Blocks** — reusable sections; global blocks resolve through one stable UUID and propagate everywhere.
- **Element-level editing** — click a region in the Preview and ask Canvas to change that region only.
- **History** — Change Sets, Undo/Redo with conflict protection, Page/Block version history and restore, named project checkpoints.
- **Workflow tools** — one searchable command system, durable AI/export task visibility, safe queued AI follow-ups, and committed change reviews.
- **Export** — validated ZIP containing a runnable Next.js project with no Canvas internals.

## Prerequisites

- Node.js 22 or newer, npm 10 or newer
- PostgreSQL 15 or newer (or Docker with Compose)
- Writable disk for private object storage (uploaded media and export archives)
- An API key for at least one AI provider (Google Gemini, OpenAI, Anthropic, or any OpenAI-compatible endpoint) — entered in the app, not in `.env`

## Local setup

```bash
npm install
cp .env.example .env          # then edit the placeholders
docker compose up -d postgres # or point DATABASE_URL at your own PostgreSQL
npm run db:migrate
npm run dev                   # Canvas at http://localhost:3000
npm run worker                # in a second terminal: AI + export worker (local only)
```

`PREVIEW_TOKEN_SECRET` must be at least 32 random characters, otherwise Preview refuses to
start. `CANVAS_CREDENTIAL_KEY` must be 32 bytes, otherwise Canvas refuses to store an AI
credential rather than storing one it cannot protect. Generate each with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Then open a project and use **AI model and usage** to connect a provider and choose a
model. Canvas boots and runs without any AI credential: every screen keeps working, and AI
requests fail with a clear configuration error rather than crashing.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run worker` | Local runner: AI generation, export jobs, periodic housekeeping. Not used in Vercel production, where queues run both job types |
| `npm run maintenance` | One-shot housekeeping pass (for a scheduler/cron) |
| `npm run db:migrate` | Apply every pending migration in order |
| `npm test` | Full test suite |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run test:ai-provider` | Optional paid smoke check against a real provider (needs the `SMOKE_AI_*` variables) |

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
(`.canvas-storage` by default). `STORAGE_DRIVER=vercel-blob` uses a **private** Vercel
Blob store for the same `ObjectStorage` interface, and is required on Vercel: a function
filesystem is not durable shared storage. Both adapters hold uploaded media and export
archives. Media is served only through the authenticated `/api/media/{assetId}` route or
a short-lived, project-scoped Preview token. Object keys and Blob URLs are never exposed
to clients.

## AI providers and credentials

Canvas is bring-your-own-key, and the key belongs to a **person**. Each account connects
its own provider and picks one model; every AI job Canvas runs uses the credential of
whoever created that job. A collaborator generating a page on someone else's website
spends their own credit, never the owner's, and an account with no credentials fails with
an ordinary configuration error rather than falling back to anyone else's key. No provider
credential lives in the environment, and no provider is privileged over another.

### Supported providers

| Provider | Base URL | Model discovery |
|---|---|---|
| Google Gemini | provider default | Yes |
| OpenAI | optional override | Yes |
| Anthropic | optional override | Yes |
| OpenCode Zen | provider default | Yes — free models only |
| OpenAI-compatible | **required** | When the endpoint offers `/models`; otherwise add model IDs by hand |

Adding another provider means adding one adapter under `src/server/ai/` and one entry in
`src/server/ai/provider-registry.ts`. Canvas domain code never branches on a provider or a
model name: it resolves a project's selection into a `ProviderConnectionConfig` and asks
the registry for an adapter. Provider SDK types, finish reasons, media shapes and error
envelopes stay inside their adapter.

### The workflow

1. Open the **account menu → AI settings → Connections** and add a provider with its API
   key (plus a base URL for an OpenAI-compatible endpoint).
   Adding an **OpenCode Zen** key automatically loads its currently available free models.
2. **Load models** discovers what the provider offers, or model IDs are added by hand.
   Discovered models arrive disabled; you enable the ones you want, and can record each
   model's capabilities and pricing.
3. **Test connection** proves the credential works before anything depends on it.
4. Pick one enabled connection and model on the **Model** tab. That is your selection, on
   every website you work on.
5. Generation resolves job actor → their account's connection → enabled model → adapter at
   execution time, inside the worker.

### Credential security

The only AI secret in the environment is `CANVAS_CREDENTIAL_KEY`, a 32-byte master key.
Provider credentials are encrypted with AES-256-GCM before they are stored, bound to the
connection **and the account** they belong to, so a ciphertext copied into another
connection or another account cannot be decrypted. (Connections created before credentials
became account-scoped keep their original workspace binding until the key is next saved,
so nobody has to re-enter a working key.) A stored key is **never** returned to a browser
— only a four-character hint — and never appears in logs, prompts, job rows, queue rows,
generation metadata, Preview, exports, or analytics. There is no API by which one account
can read, use, or even see another's connection.

Removing a connection or disabling a model never damages a website: existing pages,
versions and history are untouched, and that person's next AI request fails with a clear
configuration error until another model is chosen. Everyone else keeps working.

### Page Design Planning

New page generation begins with a first-class **PageDesignPlan** rather than going straight
to HTML. One planning call to the same account-selected model returns three lightweight,
structurally different composition candidates; the planner selects the strongest with a
rationale, and the server validates it. Canvas then computes a deterministic **composition
fingerprint** from the selected plan — section roles, width/alignment/density rhythm, media
emphasis, repetition — using *no* theme values, and compares it against the other pages in
the project. If the plan is too close to an existing page's skeleton, Canvas performs one
bounded re-plan; if it is still too similar it fails cleanly (`AI_DESIGN_PLAN_TOO_SIMILAR`)
rather than shipping a duplicate layout. Only the selected plan is fed into source
generation, and its compact fingerprint is persisted with the Page Version so later pages
can be compared without re-planning. Modifications and selected-element edits keep their
existing preserve-unrelated semantics and never route through the planner.

This enforces the separation the product depends on: the **Theme is a visual language**
(colour, type, radius, spacing, shadow, borders) and never a page layout; **Building Blocks**
are the mechanism for intentional shared composition; and each page's composition is
designed for its own job. Two unrelated businesses on the same Theme share a visual language
without sharing a template.

### Generation pipeline

Every result still flows through the same safe pipeline, whichever provider produced it:

provider → design plan → structured response → Zod schema validation → source/security
validation → composition conformance → immutable version → transactional activation.

Selected Media is sent inline as bytes, so no storage key or signed URL leaves Canvas. A
model that lacks a capability the request needs — structured output, or image input — fails
with `AI_MODEL_CAPABILITY_UNSUPPORTED` rather than silently dropping the attachment.
Provider failures are normalized (`AI_NOT_CONFIGURED`, `AI_PROVIDER_AUTH_FAILED`,
`AI_PROVIDER_RATE_LIMITED`, `AI_CONTEXT_TOO_LARGE`, `AI_PROVIDER_TIMEOUT`,
`AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_INVALID_RESPONSE`,
`AI_MODEL_CAPABILITY_UNSUPPORTED`), and only transient classes are retried.

Prompts are composed from provider-independent sections in a fixed order — platform rules,
operation, craft standard, design plan, output contract, project instructions, design
system, reusable sections, site structure, target state, media, conversation, closing
anchor — and the same
composed prompt goes to whichever adapter the project selected. Each operation (create
page, modify page, modify element, create/modify a reusable section, validation repair)
carries its own instructions and a prompt version such as `canvas-page-create-v2`, recorded
on every request so prompt revisions can be compared on real analytics.

A candidate rejected by Canvas validation gets a **bounded repair pass**: the sanitized
diagnostic and the rejected candidate go back to the same project-selected model with
repair-specific instructions, at most twice. The invalid candidate is never activated, and
validation repair is counted separately from transient provider retries.

### Analytics semantics

AI settings reports per-project request, token, latency and cost analytics over 24 hours,
7 days, or 30 days. Two distinctions are load-bearing:

- **Model latency is not total time.** `providerLatencyMs` is the provider round trip;
  job duration is everything Canvas did, including context assembly, validation, repair and
  activation. Validation time is reported separately again. Nothing that was not measured is
  inferred — an unmeasured value is reported as unavailable, never as zero.
- **An estimate is not a bill.** A cost the provider itself reported is labelled
  provider-reported. Otherwise Canvas estimates from the pricing metadata recorded on the
  model, and labels it as an estimate. When pricing is unknown, cost is **unavailable** —
  never `0`. Each usage row stores the pricing and pricing version it was costed with, so
  editing a model's pricing later never rewrites past estimates. Canvas never scrapes
  pricing at runtime.

The **Test model** console sends one prompt straight to the selected model and reports the
response, provider, model, status, total latency, tokens, estimated cost and timestamp. It
creates no page version, Change Set, generation job, or agent conversation message, and it
is rate limited per user and per project. Time to first token is reported as unavailable
rather than invented, because Canvas does not stream that request.

### Optional real-provider smoke check

`npm run test:ai-provider` exercises every Canvas AI operation against a live provider and
asserts each result still passes the unchanged validation pipeline. It makes real, billable
calls, so it is opt-in through its own variables and never reads a workspace connection:

```bash
SMOKE_AI_PROVIDER=openai SMOKE_AI_MODEL=gpt-5 SMOKE_AI_API_KEY=... npm run test:ai-provider
```

Without those variables it reports SKIPPED and exits successfully. Every other test in the
suite uses mocks and makes no paid calls.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `APP_URL` | Yes | Public Canvas origin; used for links and Preview frame ancestry. |
| `PREVIEW_TOKEN_SECRET` | Yes | HMAC secret (32+ characters) for Preview sessions. |
| `NODE_ENV` | Runtime | `production` enables Secure session cookies. |
| `STORAGE_DRIVER` | No | Object storage adapter; `local` by default off Vercel, `vercel-blob` by default on Vercel. |
| `LOCAL_STORAGE_PATH` | No | Private object root; defaults to `.canvas-storage`. |
| `BLOB_READ_WRITE_TOKEN` | With `vercel-blob` outside linked Vercel runtime | Vercel Blob read/write token. A connected private Blob store adds it automatically. |
| `MEDIA_MAX_BYTES` | No | Maximum bytes per uploaded image; defaults to 10 MB. |
| `PREVIEW_TOKEN_TTL_SECONDS` | No | Preview session lifetime (30–900); defaults to `300`. |
| `INVITE_TTL_DAYS` | No | Invitation lifetime; defaults to `7`. |
| `LEASE_DURATION_SECONDS` | No | Editing lease lifetime; defaults to `60`. |
| `CANVAS_CREDENTIAL_KEY` | For AI only | 32-byte master key encrypting workspace AI credentials at rest. Provider API keys are entered in the app, never here. |
| `AI_PROVIDER_TIMEOUT_MS` | No | Provider timeout; defaults to `120000`. |
| `SMOKE_AI_PROVIDER` / `SMOKE_AI_MODEL` / `SMOKE_AI_API_KEY` / `SMOKE_AI_BASE_URL` | No | Opt-in credentials for the paid provider smoke check only. |
| `CANVAS_EXPORT_BUILD` | No | `typecheck` (default) or `full` to run a real `next build` per export. |
| `CANVAS_GENERATION_DISPATCH` | No | `queue` or `worker`. Defaults to `queue` on Vercel and `worker` elsewhere. |
| `CANVAS_EXPORT_DISPATCH` | No | `queue` or `worker`. Defaults to `queue` on Vercel and `worker` elsewhere. |
| `CRON_SECRET` | On Vercel | Bearer token Vercel Cron presents to `/api/cron/generation-maintenance`. Without it the route refuses every request. |
| `CANVAS_METRICS_TOKEN` | No | Enables `GET /api/internal/metrics` for callers with this bearer token. |

## Deployment

1. Provision PostgreSQL 15+. On Vercel, create and connect a **private Vercel Blob**
   store, set `STORAGE_DRIVER=vercel-blob`, and ensure `BLOB_READ_WRITE_TOKEN` is
   available to Production (Vercel normally provisions it when the store is connected).
2. Set every required variable above; set `NODE_ENV=production` and an `APP_URL` on HTTPS.
3. Run `npm run db:migrate` before starting new application instances.
4. Start the web process (`npm run build && npm start`).
5. Run jobs one of two ways:
   - **On Vercel (default):** `vercel.json` registers `/api/queues/generation-jobs` and
     `/api/queues/export-jobs` as push consumers. Nothing long-running is needed. Set
     `CRON_SECRET` so the once-daily maintenance route cannot be driven by anyone else.
   - **On your own host:** set `CANVAS_GENERATION_DISPATCH=worker` and
     `CANVAS_EXPORT_DISPATCH=worker`, run at least one `npm run worker`, plus
     `npm run maintenance` on a schedule.
7. Probe `GET /api/health` for liveness and database reachability.

### AI generation on Vercel Queues

Creating a page, Building Block, or assistant job writes the `generation_jobs` row first,
then publishes **only that job's id** to the queue. The consumer claims the row with a
conditional UPDATE before doing any work, so at-least-once delivery is safe: a duplicate
claims nothing and returns. Retries, cancellation, provider selection, progress, and
results all continue to live in `generation_jobs`; the queue never carries prompts,
credentials, or provider material.

### Export jobs on Vercel Queues

Creating an export writes `export_jobs` first, then sends only `{ jobId }` to the
`canvas-export-jobs` topic. The consumer claims that exact row before calling the existing
export pipeline, so duplicate queue delivery cannot create two archives. An export queue
message also schedules a bounded delayed watchdog: it republishes only rows that stayed
queued or whose function claim expired. Unexpected infrastructure faults retry once with
a short backoff; validation and build failures remain terminal and user-safe. The daily
maintenance sweep is only the final recovery net.

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
- `src/domain` — validation, repositories, and independently testable services: auth, workspaces, projects, pages, media, theme, collaboration, AI generation, AI connections/model resolution/analytics, provider-independent prompt composition, blocks, history, export, maintenance.
- `src/generated-runtime` — Preview manifest, signed sessions, restrictive response policy, isolated document renderer, runtime router and messaging.
- `src/server` — database client and migrations, authorization, sessions, object storage, jobs, observability, HTTP error normalization, credential encryption, and the AI provider adapters and registry.
- `migrations` — deterministic SQL with the database-level integrity constraints Canvas depends on.

The mounted project workbench is split into explicit presentation boundaries: `TitleBar`,
`ActivityBar`, `ContextSidebar`, `PreviewStage`, and `AgentPanel`. `workspace-layout.ts`
owns breakpoint normalization and persisted pane state; intercepted `/panel/*` routes render
detail drawers or focused work without replacing that mounted workbench.

Immutable history is the backbone: Page Versions, Block Versions, Change Sets, and
Checkpoints are never mutated or deleted. Restores move active pointers and are recorded
as auditable, reversible Change Sets.
