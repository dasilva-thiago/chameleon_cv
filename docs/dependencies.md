# Dependências diretas — versão e licença

**Atualizado em:** 2026-11-04 (fatia S0.1). Fase 0 e Fase 1 instaladas; `axe-core` (devDependency de `apps/web`, testes de acessibilidade do editor/importação de perfil, 2026-11-05) instalado; `docx` e `playwright-core` (dependências de `@chameleon/documents`, exportação DOCX/PDF, P4) e `jszip`/`unpdf` (devDependencies de teste do mesmo pacote e `jszip` na API) instalados; multer, file-type, mammoth etc. **ainda não**.
Versões fixadas (exatas) nos `package.json`; licenças conforme o registro npm (`pnpm view <pkg> license`). Todas são permissivas (MIT, ISC, Apache-2.0, BSD).

## Raiz (`chameleon-cv`, dev)

| Pacote                   | Versão | Licença    |
| ------------------------ | ------ | ---------- |
| typescript               | 6.0.3  | Apache-2.0 |
| eslint                   | 9.39.5 | MIT        |
| @eslint/js               | 9.39.5 | MIT        |
| typescript-eslint        | 8.72.1 | MIT        |
| eslint-plugin-jsx-a11y   | 6.10.2 | MIT        |
| eslint-plugin-react-hooks | 7.1.1 | MIT        |
| globals                  | 17.14.0 | MIT       |
| prettier                 | 3.9.10 | MIT        |
| vitest                   | 5.1.0  | MIT        |
| vite                     | 8.3.5  | MIT        |
| @vitejs/plugin-react     | 6.2.1  | MIT        |
| jsdom                    | 30.1.3 | MIT        |
| tsx                      | 4.23.15 | MIT       |
| @types/node              | 24.19.2 | MIT       |

## `@chameleon/contracts`

| Pacote | Versão | Licença | Uso |
| ------ | ------ | ------- | --- |
| zod    | 4.6.7  | MIT     | contrato canônico |
| ajv (dev) | 8.20.0 | MIT  | validar o JSON Schema gerado (S0.2) |
| tsx (dev) | 4.23.15 | MIT | scripts `generate`/`check` |

## `@chameleon/domain`, `@chameleon/profile-io`

| Pacote | Versão | Licença | Pacote do workspace |
| ------ | ------ | ------- | ------------------- |
| uuid   | 14.0.3 | MIT     | domain (ids v7)     |
| yaml   | 2.9.1  | ISC     | profile-io          |

## `@chameleon/db`

| Pacote                 | Versão  | Licença    |
| ---------------------- | ------- | ---------- |
| @prisma/client         | 7.10.1  | Apache-2.0 |
| @prisma/adapter-pg     | 7.10.1  | Apache-2.0 |
| pg                     | 8.23.1  | MIT        |
| prisma (dev)           | 7.10.1  | Apache-2.0 |
| @types/pg (dev)        | 8.23.1  | MIT        |

## `@chameleon/api`

| Pacote                  | Versão | Licença |
| ----------------------- | ------ | ------- |
| express                 | 5.3.0  | MIT     |
| helmet                  | 8.3.0  | MIT     |
| express-rate-limit      | 8.7.3  | MIT     |
| pino                    | 10.4.0 | MIT     |
| pino-http               | 11.0.0 | MIT     |
| cookie                  | 2.0.1  | MIT     |
| @node-rs/argon2         | 2.2.2  | MIT     |
| zod                     | 4.6.7  | MIT     |
| supertest (dev)         | 7.3.1  | MIT     |
| @types/express (dev)    | 5.0.6  | MIT     |
| @types/supertest (dev)  | 7.2.1  | MIT     |
| tsup (dev)              | 9.0.0  | MIT     |
| tsx (dev)               | 4.23.15 | MIT    |

## `@chameleon/web`

| Pacote                         | Versão    | Licença |
| ------------------------------ | --------- | ------- |
| react / react-dom              | 19.3.1    | MIT     |
| react-router                   | 8.5.1     | MIT     |
| @tanstack/react-query          | 5.105.3   | MIT     |
| react-hook-form                | 7.91.0    | MIT     |
| @hookform/resolvers            | 6.0.2     | MIT     |
| vite (dev)                     | 8.3.5     | MIT     |
| @vitejs/plugin-react (dev)     | 6.2.1     | MIT     |
| tailwindcss / @tailwindcss/vite (dev) | 4.3.4 | MIT |
| @testing-library/react (dev)   | 16.3.3    | MIT     |
| @testing-library/dom (dev)     | 10.4.2    | MIT     |
| @testing-library/jest-dom (dev) | 7.0.1    | MIT     |
| @testing-library/user-event (dev) | 14.6.8 | MIT     |
| @types/react / @types/react-dom (dev) | 19.3.0 | MIT |

## Divergências em relação ao ADR-0001 e ao plano §6

- **@hookform/resolvers 6.0.2** em vez da 7.0.2 (a mais recente): a 7.0.2 foi publicada em 2026-11-03, abaixo da janela mínima de idade de release do pnpm 12. Escolhida a 6.0.2 (2026-10-28), compatível com `react-hook-form` 7.x e Zod 4. Reavaliar a 7.x depois.
- **tsup 9.0.0**, **react-router 8.5.1**, **@tanstack/react-query 5.105.3**, **react-hook-form 7.91.0**, **@testing-library/\*** e **jsdom 30.1.3**: o plano não fixa versão; foram usadas as mais recentes estáveis em 2026-11-04.
- **eslint 9.39.5**: o pnpm emite o aviso "deprecated" porque existe a 10.14; mantida a linha 9 conforme o ADR-0001 (o `eslint-plugin-jsx-a11y` 6.10.2 só aceita ESLint ^9).
- **@testing-library/dom** (peer obrigatório do `@testing-library/react`) e **vite** na raiz (peer do vitest e do plugin React) foram adicionados; não constam no §6.
- Nada de F2+ foi instalado. `@types/cookie` não foi necessário.
- Scripts de build (postinstall) permitidos explicitamente em `pnpm-workspace.yaml` (`allowBuilds`): `esbuild`, `prisma`, `@prisma/engines`.
