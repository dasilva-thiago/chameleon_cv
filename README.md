# ChameleonCV

A personal tool that works like [career-ops](https://github.com/santifer/career-ops): **paste a job posting and get an
evaluation of the job and a resume tailored to it**, written by AI from what the system knows about you and checked by
the program against that knowledge.

1. **Professional base** (page "Base"): your CV in Markdown (the only source of facts, like `cv.md`) and your profile
   and rules (targets, dealbreakers, salary ranges, location policy, framing, writing rules — like `modes/_profile.md`).
   Every save is an immutable revision.
2. **Evaluation** (job page): the AI reads the posting alone (requirements, importance, keywords), then judges it against
   your base: type of role, broken rules, match per requirement with evidence quoted from your CV, gaps with mitigation,
   scores, a 1-5 score, a verdict and a suggested salary. The program checks every quote and decides the recommendation
   from the score (4.0+ apply, 3.5-3.9 only with a reason, below: don't).
3. **Tailored resume**: the AI writes the headline, summary, key skills and bullets with the job's keywords; the program
   keeps titles, companies, dates and links from your CV and flags invented numbers, changed titles, seniority claims,
   avoided expressions and terms your base does not support. You edit, approve (immutable) and export DOCX/PDF.

Product definition: [`docs/REDEFINICAO_PRODUTO_PESSOAL.md`](docs/REDEFINICAO_PRODUTO_PESSOAL.md) · architecture:
[`docs/architecture.md`](docs/architecture.md) · decision:
[`ADR-0015`](docs/decisions/ADR-0015-fluxo-career-ops-base-markdown.md).

## Structure

| Path                 | Contents                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| `apps/api`           | Express 5 API (auth, base, jobs, evaluation, resumes, export)             |
| `apps/web`           | React 19 + Vite + Tailwind 4 SPA                                          |
| `packages/contracts` | Zod contracts shared by API and web                                       |
| `packages/domain`    | Pure rules: CV reader, resume builder, career-ops checks, evaluation gate |
| `packages/ai`        | Multi-provider router (Gemini, Groq, ...) and the career-ops prompts      |
| `packages/db`        | Prisma 7 + PostgreSQL (the only package that imports `@prisma/*`)         |
| `packages/documents` | DOCX/PDF/HTML rendering                                                   |

## Requirements

- Node.js 24, pnpm 12, PostgreSQL 16+ binaries (Docker is **not** required).
- **At least one AI key** in `.env` (the Gemini key is free: https://aistudio.google.com/apikey). Without AI the
  evaluation is unavailable and the resume is your base without tailoring.

## Setup

```bash
pnpm install
cp .env.example .env   # fill in an AI key; .env is never committed
pnpm db:local:init     # once: creates a private cluster in .data/pg (127.0.0.1:54329)
pnpm db:local:start
pnpm db:migrate:deploy
pnpm dev               # API on :3000, web on :5173
```

Create the first account with an invite: `pnpm --filter @chameleon/api admin:invite you@example.com`.

## Commands

| Command                 | What it does                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | API and web in development mode                                                                    |
| `pnpm check`            | formatting, lint, types and unit/component tests (no database, no network)                         |
| `pnpm test:integration` | tests against a real local PostgreSQL                                                              |
| `pnpm test:e2e`         | Playwright on the real stack with a scripted AI: base → job → evaluation → resume → approve → file |
| `pnpm ai:check`         | validate the configured AI keys and models                                                         |
| `pnpm build`            | build the API and the web app                                                                      |

## Rules enforced automatically

- `@prisma/*` only in `packages/db`; `apps/web` only imports `@chameleon/contracts` (ESLint + `tests/architecture`).
- Every private table is scoped to its owner (`forOwner`, composite FKs, immutable `ownerId`); the isolation suite in
  `tests/integration/isolation` fails if a new route has no cross-owner test.

## Privacy

Real data never enters the repository: fixtures are synthetic and personal files live in `fixtures-private/` (ignored by
git). Phone and e-mail are removed from every AI prompt. Secrets live only in `.env`.
