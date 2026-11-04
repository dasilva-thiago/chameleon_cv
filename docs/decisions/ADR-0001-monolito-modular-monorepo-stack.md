# ADR-0001 — Monólito modular em monorepo pnpm e versões da stack

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O repositório é greenfield. O plano §9 sugere React+Vite+TS+Tailwind, Express 5, Zod, Prisma, PostgreSQL, Vitest, Playwright e Docker. O Adendo §6.1 exige monólito modular. O ambiente não tem Docker. A consulta ao npm em 2026-11-04 mostrou incompatibilidades nas versões mais recentes:
- o typescript-eslint 8.72 aceita `typescript <6.1.0`, e a última versão do TypeScript é a 7.0.2;
- o eslint-plugin-jsx-a11y aceita `eslint ^9`, e a última versão do ESLint é a 10.14;
- a tag `latest` do `prisma` aponta para `8.0.0-rc.30`, enquanto a linha estável é a 7.10.1.

## Decisão
- **pnpm workspaces**, sem Turborepo (os scripts `pnpm -r`/`--filter` bastam). Pacotes: `apps/api`, `apps/web`, `packages/{contracts,domain,db,ai,documents,profile-io,test-fixtures}`. Escopo npm `@chameleon/*`.
- Pacotes internos são consumidos como fonte TS (`exports` → `src/index.ts`). A API roda com `tsx` em desenvolvimento e é empacotada com `tsup`. A web usa Vite.
- **Versões fixadas** (exatas no `package.json`, faixas apenas para patch):

| Item | Versão |
|---|---|
| Node | 24.x (`engines` + `.node-version`) |
| TypeScript | **6.0.3** (não 7.x, até o typescript-eslint suportar) |
| ESLint | **9.39.x** + typescript-eslint 8.72 + jsx-a11y + react-hooks |
| Prettier | sim |
| Prisma / @prisma/client / @prisma/adapter-pg | **7.10.1** (não 8.0 RC) |
| Zod | 4.6.x (gera JSON Schema nativo, `z.toJSONSchema`) |
| Express | 5.3.x · helmet 8 · express-rate-limit 8 · pino 10 |
| React | 19.3 · Vite 8.3 · @vitejs/plugin-react 6 · Tailwind 4.3 (`@tailwindcss/vite`) |
| Testes | Vitest 5.1 (projetos: unit, web, integration; os testes de contrato rodam em `unit`) · @playwright/test 1.64.1 · @axe-core/playwright |
| Documentos | docx 9.15 · playwright-core 1.64.1 · pdfjs-dist 6.5 ou unpdf 2.1 · mammoth 1.13 |
| Auth | @node-rs/argon2 2.2 (binários pré-compilados; não usa node-gyp) |
| Perfil | yaml 2.9 · ajv 8.20 (usado só para testar o JSON Schema gerado) |

- Docker fica opcional e apenas para deploy futuro.

## Alternativas
- **Turborepo/Nx:** cache e orquestração desnecessários para nove pacotes.
- **NestJS ou Fastify:** o plano e o domínio do proprietário favorecem Express 5, e não há ganho que justifique a troca.
- **Biome em vez de ESLint:** não tem regras de acessibilidade JSX nem `no-restricted-imports` por padrão de caminho com a mesma maturidade.
- **TypeScript 7 (nativo):** mais rápido, mas quebraria o lint tipado. Reavaliar quando o typescript-eslint suportar.

## Consequências
- O primeiro `pnpm install` precisa de rede.
- Atualizar o TypeScript ou o ESLint para a próxima major exige uma nova ADR.
- O `pnpm-lock.yaml` é ponto de contenção: apenas um agente por vez adiciona dependências (ver `docs/implementation-plan.md` §3).

## Verificação
`pnpm install && pnpm typecheck && pnpm lint && pnpm test` verdes no scaffold. Um teste de grafo de dependências reprova importações proibidas (`docs/architecture.md` §2.1).
