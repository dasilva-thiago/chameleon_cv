# ChameleonCV

Plataforma para adaptar currículos a vagas a partir de um **perfil profissional estruturado**, de qualquer área e senioridade. O sistema só usa fatos que estão no perfil, e cada afirmação do currículo gerado aponta para o registro que a sustenta.

> Estado: scaffold do monorepo (fatia S0.1). Contrato do perfil, banco, autenticação e demais módulos entram nas fatias seguintes. Veja o roteiro em [`docs/implementation-plan.md`](docs/implementation-plan.md) e a arquitetura em [`docs/architecture.md`](docs/architecture.md).

## Estrutura

| Caminho                  | Conteúdo                                                     |
| ------------------------ | ------------------------------------------------------------ |
| `apps/api`               | API Express 5 (`createApp`, config validada por Zod, pino)   |
| `apps/web`               | SPA React 19 + Vite + Tailwind 4                             |
| `packages/contracts`     | Contratos Zod e JSON Schemas gerados                         |
| `packages/domain`        | Regras de domínio puras                                      |
| `packages/profile-io`    | Leitura/escrita YAML/JSON/MD e migração de versões           |
| `packages/db`            | Prisma 7 + PostgreSQL (único pacote que importa `@prisma/*`) |
| `packages/ai`            | Gateway e provedores de IA                                   |
| `packages/documents`     | Geração de DOCX/PDF                                          |
| `packages/test-fixtures` | Perfis e vagas sintéticos para testes                        |

## Requisitos

- Node.js 24 (veja `.node-version`)
- pnpm 12 (`corepack enable` ou instalação própria)
- PostgreSQL 16 ou superior. Para o banco local do projeto, os binários do PostgreSQL (`initdb`, `pg_ctl`, `psql`, `postgres`) precisam estar instalados; Docker **não** é necessário.

## Instalação

```bash
pnpm install
cp .env.example .env   # ajuste se necessário; .env nunca é versionado
```

## Banco de dados local

O projeto cria um cluster PostgreSQL próprio em `.data/pg`, escutando **somente** em `127.0.0.1:54329`, com autenticação `trust` (apenas para desenvolvimento local). Ele não interfere em nenhum PostgreSQL já instalado na máquina.

```bash
pnpm db:local:init     # cria o cluster (uma vez)
pnpm db:local:start    # inicia e garante os bancos chameleon e chameleon_dev
pnpm db:local:status   # mostra estado e versão do servidor
pnpm db:local:stop     # para o servidor
```

O script localiza os binários por `PG_BIN` (diretório `bin`), pelo `PATH` ou, no Windows, em `C:\Program Files\PostgreSQL\<versão>\bin`. Para usar outro PostgreSQL, basta ajustar `DATABASE_URL` e `TEST_DATABASE_ADMIN_URL` no `.env`.

## Comandos

| Comando                         | O que faz                                                                  |
| ------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                      | API e web em modo de desenvolvimento                                       |
| `pnpm check`                    | formato, lint, tipos, contratos e testes (sem banco e sem rede)            |
| `pnpm test`                     | testes unitários e de componente                                           |
| `pnpm test:integration`         | testes com PostgreSQL real (exige `TEST_DATABASE_ADMIN_URL` e banco ativo) |
| `pnpm format` / `pnpm lint:fix` | corrige formatação e lint                                                  |
| `pnpm build`                    | build da API e da web                                                      |

Convenções de teste: `*.test.ts(x)` são unitários (ou de componente em `apps/web`); `*.int.test.ts` e `tests/integration/**` são de integração; `e2e/**/*.spec.ts` usa Playwright.

## Regras de arquitetura verificadas automaticamente

- `@prisma/*` só pode ser importado em `packages/db` (ESLint e `tests/architecture/deps.test.ts`).
- `packages/contracts` e `packages/domain` não importam `apps/*`.
- `apps/web` só importa `@chameleon/contracts`.

## Privacidade

Nenhum dado pessoal real deve entrar no repositório: fixtures são sintéticas e arquivos de perfil real ficam em `fixtures-private/` (ignorado pelo git). Segredos ficam apenas no `.env` local.
