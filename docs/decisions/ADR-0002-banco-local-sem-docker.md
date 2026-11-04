# ADR-0002 — PostgreSQL local e de testes sem Docker e sem credenciais

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O serviço PostgreSQL 18 local (porta 5432) tem credenciais desconhecidas, que não devem ser adivinhadas, e o Docker não está instalado. Os testes de isolamento multiusuário precisam rodar de verdade, localmente e no CI. Verificação feita em 2026-11-04 com os binários de `C:\Program Files\PostgreSQL\18\bin`:
- `initdb -U chameleon --auth=trust` funcionou como usuário comum, sem privilégio de administrador;
- `pg_ctl start` com `-p 54329 -c listen_addresses=127.0.0.1` subiu o cluster;
- `CREATE DATABASE x TEMPLATE y` funcionou;
- `ALTER TABLE ... FORCE ROW LEVEL SECURITY` funcionou.

## Decisão
1. **Cluster local do projeto**, criado por `scripts/dev-db.mjs` (comandos `init|start|stop|status`) a partir dos binários instalados:
   - o caminho vem de `PG_BIN`, do `PATH` ou da maior versão encontrada em `C:\Program Files\PostgreSQL\*\bin`;
   - dados em `.data/pg` (gitignored), superusuário `chameleon` com auth `trust`, escutando **somente** em `127.0.0.1:54329`;
   - bancos `chameleon_dev` e `chameleon_test_tpl`.
   O serviço da porta 5432 não é tocado.
2. **`DATABASE_URL` sempre configurável.** Qualquer PostgreSQL ≥ 16 serve (ex.: um banco criado pelo usuário no serviço 5432, ou um gerenciado).
3. **Testes de integração:**
   1. o `globalSetup` do projeto Vitest `integration` usa `TEST_DATABASE_ADMIN_URL` para criar e migrar (`prisma migrate deploy`) um banco-template, com nome derivado do hash das migrações;
   2. cada worker clona `chameleon_test_<run>_<worker>` a partir do template;
   3. o `teardown` remove os clones.
   Os testes não compartilham estado.
4. **CI:** GitHub Actions `services: postgres:18` com as mesmas variáveis.
5. **Fallback documentado e não implementado:** o pacote npm `embedded-postgres` (18.6.0-beta.19, MIT) para máquinas sem binários do PG. Só é adotado se surgir uma máquina sem PostgreSQL instalado.

## Alternativas rejeitadas
- **SQLite:** sem JSONB, enums nativos, RLS, `citext` e CHECKs equivalentes. Bifurcaria o schema e as migrações do Prisma.
- **PGlite (WASM):** conexão única, sem `CREATE DATABASE`, roles nem RLS fiéis, e com o Prisma via adaptador da comunidade. Seria um segundo motor a manter.
- **Testcontainers:** exige Docker.
- **Adivinhar ou redefinir a senha do serviço 5432:** proibido e invasivo.

## Consequências
- Primeiro uso: `pnpm db:local:init && pnpm db:local:start && pnpm db:migrate`.
- O cluster local é inseguro por design (`trust`) e por isso fica restrito ao loopback e a uma porta não padrão. Nunca usar esse modo fora de desenvolvimento. O script recusa `listen_addresses` diferente de `127.0.0.1`.
- `db:reset` recusa executar se o host de `DATABASE_URL` não for `127.0.0.1` ou `localhost`.

## Verificação
- `pnpm db:local:status` informa a versão.
- `pnpm test:integration` cria e remove os bancos por worker.
- A suíte de isolamento roda nesse banco.
