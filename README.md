# ChameleonCV

A **private, personal tool** (single owner) that keeps one structured professional profile, stores job postings, analyzes each posting against the profile, generates tailored resumes with every claim traced to a profile fact, and exports DOCX/PDF. It is not a SaaS or multi-user product.

> Status: **first functional version complete** (2026-11-05). You can maintain the profile (editor, YAML/JSON/Markdown import with preview, export, evidence, pending items), save job postings, analyze each posting against the profile (requirement -> evidence -> strength -> gap, deterministic and local), generate a tailored resume where every line carries the profile facts that support it, review and edit it, approve a version (immutable) and export DOCX/PDF. Not done: AI-assisted wording (needs a provider, key and budget chosen by the owner), visual verification of the DOCX in Word/LibreOffice, a home dashboard. Product definition: [`docs/REDEFINICAO_PRODUTO_PESSOAL.md`](docs/REDEFINICAO_PRODUTO_PESSOAL.md); roadmap and next steps: [`docs/implementation-plan.md`](docs/implementation-plan.md); architecture: [`docs/architecture.md`](docs/architecture.md); progress and test results: [`docs/progress.md`](docs/progress.md).

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

| Command                         | What it does                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                      | API and web in development mode                                                                                                          |
| `pnpm check`                    | formatting, lint, types, contracts and tests (no database, no network)                                                                   |
| `pnpm test`                     | unit and component tests                                                                                                                 |
| `pnpm test:integration`         | tests against a real PostgreSQL (needs `TEST_DATABASE_ADMIN_URL` and a running database)                                                 |
| `pnpm format` / `pnpm lint:fix` | fix formatting and lint                                                                                                                  |
| `pnpm test:e2e`                 | Playwright on the real stack (API on a throw-away database, Vite, Chromium): profile -> job -> analysis -> resume -> approve -> DOCX/PDF |
| `pnpm build`                    | build the API and the web app                                                                                                            |

Test conventions: `*.test.ts(x)` are unit tests (or component tests in `apps/web`); `*.int.test.ts` and `tests/integration/**` are integration tests; `e2e/**/*.spec.ts` uses Playwright.

## Architecture rules enforced automatically

- `@prisma/*` can only be imported in `packages/db` (ESLint and `tests/architecture/deps.test.ts`).
- `packages/contracts` and `packages/domain` do not import `apps/*`.
- `apps/web` only imports `@chameleon/contracts`.

## Privacy

No real personal data may enter the repository: fixtures are synthetic, and real profile files live in `fixtures-private/` (ignored by git). Secrets live only in the local `.env`.
