# ChameleonCV

A platform that adapts resumes to job postings from a **structured professional profile**, for any field and seniority. The system only uses facts that exist in the profile, and every claim in a generated resume points to the record that supports it.

> Status: work in progress. Done so far: monorepo scaffold, universal profile contract (v2.1.0) with YAML/JSON import, database layer with per-user isolation, session-based authentication and the web shell with login. Profile editing, job analysis, matching, resume generation and DOCX/PDF export are next. See the roadmap in [`docs/implementation-plan.md`](docs/implementation-plan.md), the architecture in [`docs/architecture.md`](docs/architecture.md) and the progress log in [`docs/progress.md`](docs/progress.md).

## Structure

| Path                     | Contents                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| `apps/api`               | Express 5 API (`createApp`, Zod-validated config, pino)           |
| `apps/web`               | React 19 + Vite + Tailwind 4 SPA                                  |
| `packages/contracts`     | Zod contracts and generated JSON Schemas                          |
| `packages/domain`        | Pure domain rules                                                 |
| `packages/profile-io`    | YAML/JSON/Markdown reading and writing, version migration         |
| `packages/db`            | Prisma 7 + PostgreSQL (the only package that imports `@prisma/*`) |
| `packages/ai`            | AI gateway and providers                                          |
| `packages/documents`     | DOCX/PDF generation                                               |
| `packages/test-fixtures` | Synthetic profiles and job postings for tests                     |

## Requirements

- Node.js 24 (see `.node-version`)
- pnpm 12 (`corepack enable` or a standalone install)
- PostgreSQL 16 or later. To use the project's local database, the PostgreSQL binaries (`initdb`, `pg_ctl`, `psql`, `postgres`) must be installed. Docker is **not** required.

## Installation

```bash
pnpm install
cp .env.example .env   # adjust if needed; .env is never committed
```

## Local database

The project creates its own PostgreSQL cluster in `.data/pg`, listening **only** on `127.0.0.1:54329`, with `trust` authentication (local development only). It does not interfere with any PostgreSQL already installed on the machine.

```bash
pnpm db:local:init     # create the cluster (once)
pnpm db:local:start    # start it and ensure the chameleon and chameleon_dev databases
pnpm db:local:status   # show state and server version
pnpm db:local:stop     # stop the server
```

The script locates the binaries through `PG_BIN` (the `bin` directory), the `PATH` or, on Windows, `C:\Program Files\PostgreSQL\<version>\bin`. To use a different PostgreSQL, set `DATABASE_URL` and `TEST_DATABASE_ADMIN_URL` in `.env`.

## Commands

| Command                         | What it does                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm dev`                      | API and web in development mode                                                          |
| `pnpm check`                    | formatting, lint, types, contracts and tests (no database, no network)                   |
| `pnpm test`                     | unit and component tests                                                                 |
| `pnpm test:integration`         | tests against a real PostgreSQL (needs `TEST_DATABASE_ADMIN_URL` and a running database) |
| `pnpm format` / `pnpm lint:fix` | fix formatting and lint                                                                  |
| `pnpm build`                    | build the API and the web app                                                            |

Test conventions: `*.test.ts(x)` are unit tests (or component tests in `apps/web`); `*.int.test.ts` and `tests/integration/**` are integration tests; `e2e/**/*.spec.ts` uses Playwright.

## Architecture rules enforced automatically

- `@prisma/*` can only be imported in `packages/db` (ESLint and `tests/architecture/deps.test.ts`).
- `packages/contracts` and `packages/domain` do not import `apps/*`.
- `apps/web` only imports `@chameleon/contracts`.

## Privacy

No real personal data may enter the repository: fixtures are synthetic, and real profile files live in `fixtures-private/` (ignored by git). Secrets live only in the local `.env`.
