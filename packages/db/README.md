# @chameleon/db

Persistência (PostgreSQL + Prisma 7 com `@prisma/adapter-pg`), isolamento por dono e harness de banco
para testes. Única fronteira onde `@prisma/*` e SQL cru são permitidos (ADR-0008).

## Layout

| Caminho                             | Conteúdo                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `prisma/schema/*.prisma`            | Schema multi-arquivo: `base`, `identity`, `profile-core`, `profile-records`, `profile-history` |
| `prisma/migrations/`                | Migrações versionadas (geradas pelo Prisma + migrações SQL manuais)                            |
| `prisma.config.ts`                  | Config do CLI (lê `DATABASE_URL`; carrega o `.env` da raiz)                                    |
| `src/generated/prisma/`             | Client gerado (`pnpm db:generate`). **Não editar.** Ignorado por prettier/eslint               |
| `src/client.ts`, `src/for-owner.ts` | `createDb()`, `forOwner()`                                                                     |
| `src/private-models.ts`             | Registro central: modelos privados x globais                                                   |
| `src/mappers/`                      | Mapeamento PURO documento <-> linhas (specs, codec, to/from-rows, plano de diff)               |
| `src/profile-store/`                | `createProfileStore(db, { snapshot })` (S1.1b)                                                 |
| `src/account/`                      | `db.purgeAccount`, `exportAccountData`, registro de exportacao (S2.3a)                         |
| `src/testing/`                      | Harness de teste (`@chameleon/db/testing`)                                                     |

## Comandos (da raiz)

```
pnpm db:local:init && pnpm db:local:start   # uma vez; cluster 127.0.0.1:54329 (ADR-0002)
pnpm db:generate                            # prisma generate (typecheck do pacote também gera)
pnpm db:migrate [--name x] [--create-only]  # prisma migrate dev (cria/aplica em DATABASE_URL)
pnpm db:migrate:deploy                      # prisma migrate deploy
pnpm db:reset                               # recusa host não local; migrate reset --force
```

### Convenções do schema

- Tabelas em PascalCase e colunas em camelCase (sem `@map`): SQL manual precisa de aspas
  (`"Session"."tokenHash"`).
- Todo dado privado: coluna `ownerId` (UUID), `@@unique([id, ownerId])` e **FK composta** `(xId, ownerId)`
  para qualquer outra tabela privada. FK opcional composta é válida (`MATCH SIMPLE`: `xId` nulo
  desliga a FK), mas **`onDelete: SetNull` não funciona** (anularia `ownerId`); use `Cascade`,
  `Restrict` ou `NoAction`.
- Registre cada model novo em `src/private-models.ts` (privado, com `ownerId`) ou em `GLOBAL_MODELS`
  (com justificativa). O teste `private-models.test.ts` e o teste de catálogo
  (`identity-schema.int.test.ts`) falham se faltar `@@unique([id, ownerId])`, se uma FK para tabela
  privada não incluir `ownerId`, ou se tabela e registro divergirem. Relações de modelo global para
  privado entram em `PRIVATE_RELATIONS_OF_GLOBAL` (the guard also derives the relations of global models
  from the runtime data model, so a new relation is blocked from day one). A new global model needs a
  policy in `scopeGlobalModelArgs`; without one `forOwner()` rejects it (fail closed).
- **`ownerId` imutável (migração `owner_immutable`):** todo UPDATE que mude `"ownerId"` falha (`owner_immutable`,
  SQLSTATE 23000) em **toda** tabela com a coluna, inclusive as de FK só para `User` (`Credential`, `Session`,
  `ConsentRecord`, `AuditEvent`, `ProfessionalProfile`). Sem exceção de purge: a exclusão de conta é DELETE
  (cascata a partir de `User`), que o trigger não toca. **Tabela nova com `ownerId`:** termine a migração com
  `SELECT chameleon_install_owner_immutable_triggers();` (idempotente; lê o catálogo). O teste
  `test/owner-immutable.int.test.ts` falha se alguma tabela com `ownerId` ficar sem o trigger.
- CHECKs, índices parciais e triggers vão em migração SQL manual (diretório novo
  `prisma/migrations/<timestamp>_<nome>/migration.sql`; `prisma migrate dev` não os detecta como drift).
- `CREATE EXTENSION citext` está na primeira migração (e-mail `@db.Citext`).
- Erros de banco chegam como `PrismaClientKnownRequestError` (`P2002` unicidade, `P2003` FK, `P2039`
  para CHECK/trigger); o **nome da constraint** vem na mensagem e é o que os testes conferem (a
  mensagem do PostgreSQL é localizada).

## Identidade (S1.1a)

| Modelo            | Escopo | Observações                                                                                                 |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| `User`            | global | e-mail `citext` único; `User.id` é o `ownerId` dos demais                                                   |
| `Credential`      | dono   | só hash argon2id (CHECK `$argon2id$%`); uma por `(ownerId, kind)`                                           |
| `Session`         | dono   | só `tokenHash` (SHA-256 hex, CHECK de formato); expiração deslizante + absoluta; sem IP                     |
| `Invite`          | global | `tokenHash` único; um convite **em aberto** por e-mail (índice parcial `usedAt IS NULL`)                    |
| `ConsentRecord`   | dono   | `purpose` (CHECK de formato), `granted`, `policyVersion`, `recordedAt`; append-only                         |
| `AuditEvent`      | dono   | sem PII em `metadata`                                                                                       |
| `JobPosting`      | dono   | vaga salva (P1): texto original, `descriptionHash` SHA-256, situação, metadados; CHECKs de tamanho/hash/URL |
| `AccountDeletion` | global | registro minimo SEM PII de uma exclusao (id, instante, total agregado de linhas); append-only               |

## Agregado de perfil (S1.1b)

26 modelos privados (todos com `ownerId`, `@@unique([id, ownerId])` e FKs compostas). O desenho esta em
`docs/domain-model.md` §3.2; abaixo, o que foi realmente implementado.

| Grupo                 | Modelos                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raiz                  | `ProfessionalProfile` (blocos singleton em JSONB; FK para `User` com cascade), `ProfileFact` (governanca, PK compartilhada)                                                                                                                                  |
| Fatos (tabela tipada) | `ProfileStatement`, `CompetencyExample` (+ `CompetencyExampleSkill`), `Experience`, `ExperienceItem`, `Project`, `ProjectItem`, `Education`, `Course`, `Skill`, `SkillUsage`, `LanguageProficiency`, `Certification`, `Award`, `Publication`, `Volunteering` |
| Nao citaveis          | `ContactPoint`, `Evidence` (+ `EvidenceLink`), `PendingItem`, `UsageRestriction`, `ProjectCollaborator`                                                                                                                                                      |
| Historico             | `ProfileRevision` (snapshot imutavel + `contentHash`), `ImportRecord` (versoes, passos, avisos, `idMap`, `unmapped`)                                                                                                                                         |

Decisoes de mapeamento (o que o contrato 2.1.0 pede ao banco):

- **Colunas x `details`:** o que se filtra, ordena, junta ou valida e coluna tipada (enums Prisma = enums do
  contrato; um teste confere a igualdade). O resto dos atributos descritivos vai para `details` JSONB com as
  chaves do contrato (snake_case); campo novo do contrato sem spec cai em `details` e nao se perde. Tabelas
  sem `details` (`ProfileStatement`, `Certification`, `ContactPoint`, `UsageRestriction`...) lancam
  `UNMAPPED_FIELD` se o contrato crescer. Listas de texto (`aliases`, `topics`...) ficam em `details`
  (JSONB distingue `[]` de ausente; o `String[]` do Prisma nao).
- **Ausencia (ADR-0005):** NULL/omitido = nao informado; `[]` = nenhum item (`emptyCollections` no perfil
  para colecoes de topo; marcador `[]` em `details` para listas internas; bloco `{}` difere de bloco ausente).
- **`ProfileFact`:** `status`, `visibility`, `resumeUse` e `source` sao sempre concretos; sem `meta`, o efetivo
  e o mais restritivo (`needs_review`, `private`, `requires_approval`, `other`). `metaPresent`/`metaKeys`
  lembram o que o documento declarou, para a leitura devolver exatamente o `meta` original.
  `confirmedAt`/`archivedAt`/`resolvedAt` sao gerenciados pelo store. `archived` e preservado (CHECK:
  `archivedAt` existe se e somente se o status e `archived`).
- **`field_states`:** JSONB com CHECK por funcao (`chameleon_field_states_valid`): chave = campo ou caminho
  aninhado de ate 3 niveis (`metric.value`), valor = um dos 5 estados. Vale tambem para os blocos singleton.
- **Telefone:** gravado na forma canonica (`+` opcional + 7 a 15 digitos; o store normaliza) e CHECK no banco.
- **Versao do contrato:** `schemaVersion` `2.x` (CHECK); a leitura sempre emite 2.1.0; `ProfileRevision` guarda
  a versao do snapshot (CHECK: igual a `snapshot.schema_version`).
- **`self_described_level`:** coluna `selfDescribedLevel` (CHECK ate 200), independente de `overallLevel`.
- **Datas parciais:** `date` (1o dia do periodo, UTC) + `...Precision` (`year|month|day`); `isCurrent` = `present`.
  CHECKs: data e precisao andam juntas; precisao coerente com o dia armazenado.
- **Vinculos:** `evidence.supports` e `meta.evidence_ids` sao a mesma relacao declarada dos dois lados:
  `EvidenceLink.supportsPosition`/`evidenceIdsPosition` registram de que lado veio (ao menos um). Alvos de
  `pending_items`/`restrictions` viram `targetFactId | targetContactPointId | targetEvidenceId` (no maximo
  um; contato e evidencia nao sao fatos) mais `targetField`/`term`.
- **Contexto de uso (ADR-0007):** CHECKs `SkillUsage_single_source_chk` e `SkillUsage_context_source_chk`.
- **Coerencia `ProfileFact.kind` x tabela tipada (gap da S1.1a):** triggers `<Tabela>_fact_kind` (kind e
  perfil coerentes), `ProfileFact_typed_row` (deferivel: todo fato tem a linha tipada ao fim da transacao),
  `<Tabela>_fact_orphan` (nao apagar so a linha tipada) e `ProfileFact_kind_immutable`.
- **`ProfileRevision` imutavel:** trigger `ProfileRevision_immutable` (UPDATE/DELETE falham). Excecao:
  `SET LOCAL chameleon.allow_purge = 'on'` em DELETE (exclusao de conta; sem a flag a cascata de
  `DELETE FROM "User"` tambem falha). Unico chamador: `db.purgeAccount` (secao "Exclusao e exportacao de conta").
- **`ImportSourceFormat`:** `yaml | json | object | markdown` (migracao `import_source_markdown`; o teste
  `contract-alignment` confere com `IMPORT_SOURCE_FORMATS` do contrato).

### ProfileStore

```ts
import { createDb, createProfileStore } from '@chameleon/db';
import { buildProfileSnapshot } from '@chameleon/domain'; // db NAO importa domain: a funcao e injetada

const store = createProfileStore(createDb(), { snapshot: buildProfileSnapshot });

await store.saveProfileDocument(ownerId, document, {
  onMissing: 'archive',
  revision: 'manual_save',
});
const loaded = await store.loadProfileDocument(ownerId); // { profileId, document (2.1.0 canonico), ... } | null
await store.createRevision(ownerId, { reason: 'pre_generation' }); // { revision, reused }
await store.applyImport(ownerId, {
  document: result.document,
  report: result.report,
  mode: 'merge',
});
const existingIdMap = await store.getImportIdMap(ownerId); // alimenta importProfile({ existingIdMap })
```

- Usa **somente** `db.forOwner(ownerId)` (transacao interativa `RepeatableRead`, 60 s); os mapeadores puros
  ficam em `src/mappers` (testados sem banco). Todo id de registro precisa ser **UUID** (rode o importador
  antes); ids ausentes sao gerados; UUID em maiusculas vira minusculo.
- `onMissing` (registros que existem no banco e nao estao no documento): `archive` (padrao: fatos viram
  `archived` + `resume_use: never`; contatos, evidencias, pendencias e restricoes sao removidos), `keep`
  (merge) ou `delete` (definitivo). `applyImport`: `merge` = `keep`, `replace` = `archive`.
- Ids de um arquivo exportado por **outro dono** colidem na PK: `ID_CONFLICT` sem revelar de quem; com
  `regenerateConflictingIds` a gravacao e repetida com ids novos (`idRemap` no resultado).
- Reimportacao idempotente: mesmos ids -> `summary.totals.created === 0` e `updated === 0`; a revisao e
  reutilizada quando o hash nao muda.
- Limitacoes: referencias repetidas numa lista (`[A, A]`) sao colapsadas; as escritas sao por tabela
  (`createMany`/`update`), nao aninhadas, entao o `forOwner` injeta e confere `ownerId` em todas; a coerencia
  de perfil entre linhas do mesmo dono so e verificada onde ha `profileId` (`Skill`, fato); `ImportRecord`
  ainda nao tem `uploadedFileId` (S2.x).

### Fuso (UTC)

O `@prisma/adapter-pg` envia `DateTime` sem deslocamento: com o cluster em `America/Sao_Paulo`, 12:00Z era
gravado como 15:00Z. Correcao em tres camadas: `options: '-c timezone=UTC'` em **toda** conexao do app
(`createDb`) e do harness; `ALTER DATABASE ... SET timezone` na migracao `utc_timezone` e nos clones de teste.
Todas as colunas de instante ja eram `timestamptz(3)`; nao houve conversao de dados. Teste:
`test/timezone.int.test.ts`.

## `createDb()` e `forOwner(ownerId)`

```ts
import { createDb } from '@chameleon/db';

const db = createDb(); // DATABASE_URL (ou { connectionString })

const scoped = db.forOwner(ownerId); // UUID obrigatório
await scoped.session.findMany(); // WHERE ownerId = :ownerId
await scoped.consentRecord.create({ data: { ownerId, purpose, granted, policyVersion } });

await db.global.user.findUnique({ where: { email } }); // modelos globais: User, Invite
await db.global.session.findMany(); // lança UnscopedAccessError
await db.unsafeRaw.session.findUnique({ where: { tokenHash } }); // escape hatch (auth, manutenção)
```

O que `forOwner` faz em **modelos privados**: `findMany/findFirst(OrThrow)/count/aggregate/groupBy/
updateMany/deleteMany` recebem `ownerId` no `where`; `findUnique(OrThrow)/update/delete` estendem o
`where` único com `ownerId`; `create/createMany/createManyAndReturn/upsert` injetam `ownerId` em `data`
(o tipo do Prisma ainda exige `ownerId`: informe-o; se for diferente do escopo, lança
`OwnerScopeViolationError`). `ownerId` divergente em `where`/`data`, alterar `ownerId` em update/upsert,
informar a relação `owner` e **qualquer operação desconhecida** lançam erro (fail closed). O `ownerId`
é validado como UUID (um `undefined` nunca vira "sem filtro").

**Escrita por relação é proibida.** Em `data` de `create/createMany/createManyAndReturn/update/updateMany/
updateManyAndReturn/upsert` (`create` e `update`), qualquer campo de relação com valor definido
(`profile: { connect | connectOrCreate | create | createMany | set | disconnect | delete | update | upsert |
updateMany | deleteMany }`, inclusive relações to-many do pai) lança `NestedRelationWriteError` (subclasse de
`OwnerScopeViolationError`) antes de qualquer SQL. Os campos de relação vêm do modelo de dados do client
gerado (`relationFieldsOfClient`; o Prisma 7 não exporta `Prisma.dmmf`, então lê-se `_runtimeDataModel`, e
`test/relation-fields.test.ts` o confere contra `prisma/schema/*.prisma`; se o formato mudar, `createDb`
falha). Motivo: o `connect` do Prisma troca `(xId, ownerId)` **juntos**, o que satisfaz a FK composta e
movia a linha de B para o dono A (confirmado em `ContactPoint`, `ImportRecord` e `ProfileFact`). Use o escalar
(`profileId`, formato _unchecked_): o `ownerId` continua injetado e conferido, e a FK composta rejeita pai de
outro dono (`P2003`). `where`, `select` e `include` com relações (leituras) continuam permitidos. Leituras e
`delete`/`deleteMany` não carregam `data`.

### Global models (`User`, `Invite`) and raw operations (S1.5a)

A global model has no `ownerId`, so it is isolated by **fail-closed rules** in `src/for-owner.ts`. They
are identical on `db.global` and inside `forOwner()`:

- **No relation in any argument.** `where`, `select`, `include`, `orderBy` and `data`, **at any depth**,
  must not contain a relation field of a global model (the list is derived from `_runtimeDataModel` plus
  `PRIVATE_RELATIONS_OF_GLOBAL`): `credentials`, `sessions`, `consentRecords`, `auditEvents`, `profiles`
  **and also `invitesUsed`/`usedBy`**. The whole `User <-> Invite` cycle is forbidden: a 5+ hop chain
  (`invite -> usedBy -> invitesUsed -> ...`) used to reach another owner's `sessions`. To read both sides,
  issue two queries (`invite.findUnique`, then `user.findUnique`).
- **Relation `_count` is forbidden.** `_count` inside `select`/`include` (any depth) throws: it returned
  counts of other owners' private rows. The scalar `_count` of `aggregate`/`groupBy` is still allowed.
- **Depth limit = error.** More than `MAX_GLOBAL_ARGS_DEPTH` (32) nesting levels, or a self-referencing
  object, throws `OwnerScopeViolationError`. The old limit (16) treated the rest as "no relation" (fail open).
- **Unknown operations** (`findRaw`, `aggregateRaw`...) on a global model throw.
- **Nested relation writes** (`user.update({ data: { credentials: { create } } })`,
  `invite.update({ data: { usedBy: { update } } })`) are a case of the first rule: they throw before any SQL,
  on `db.global` and on `forOwner()`. Consequence: there is no nested write into `User`/`Invite` anymore;
  write each table with its own call (inside a `$transaction` when atomicity matters).

Inside `forOwner(ownerId)` the global models are **restricted** (they used to be passed through unscoped):

| Model    | Behavior inside `forOwner(ownerId)`                                                                                                                                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`   | Scoped to `id = ownerId` (reads, `update*`, `delete*`, `count`...). `create` injects/checks `id = ownerId` (invite acceptance creates the user with the pre-generated `ownerId`). `data.id` in an update throws; `findUnique({ where: { id: other } })` throws.  |
| `Invite` | Only `update`/`updateMany` whose `where` targets one invite (string `tokenHash` or `id`), `data` limited to `usedAt`/`usedByUserId`, and `usedByUserId` equal to `ownerId`. Reads, `create`, `delete`, `upsert` and other columns throw: use `db.global.invite`. |

Client-level raw operations (`$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, `$executeRawUnsafe`) throw
`OwnerScopeViolationError` on `db.global` and on `forOwner()` clients, including inside interactive
`$transaction`s (top-level `$allOperations` hook without a model). `$runCommandRaw` (MongoDB only) and
`$queryRawTyped` (`typedSql` preview, disabled) are already refused by Prisma itself with this provider and
configuration. **`db.unsafeRaw` is the only escape hatch** and its use is restricted to
`apps/api/src/auth` (session lookup by `tokenHash`) and `packages/db` (tests, maintenance); any other use
fails the security review.

Tests: `test/global-model-guard.test.ts` (pure) and `test/global-model-guard.int.test.ts` (real database,
including the review probes: `_count`, deep chains, `invite -> usedBy.update`, raw SQL).

### Lacunas conhecidas (R3) e rede de segurança

| Lacuna                                                                                          | Mitigação                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Escrita por relação (`connect`, `create`, `set`...) em `data`                                   | **Fechada**: `NestedRelationWriteError` na aplicação + trigger `<Tabela>_owner_immutable` no banco (`ownerId` nunca muda por UPDATE). Veja acima                                                                   |
| `$queryRaw`/`$executeRaw` (+ `Unsafe`) on `forOwner()` and `global` clients                     | **Closed** (S1.5a): they throw `OwnerScopeViolationError`. `db.unsafeRaw` remains (next row)                                                                                                                       |
| `db.unsafeRaw` has no protection                                                                | Only escape hatch for raw SQL/unguarded clients; allowed only in `apps/api/src/auth` (session lookup by `tokenHash`) and `packages/db`; list every use in the review                                               |
| `cursor` de paginação aponta para linha de outro dono (vaza apenas a posição, nunca o conteúdo) | `where` escopado continua valendo                                                                                                                                                                                  |
| Global models (`User`, `Invite`)                                                                | **Closed** (S1.5a): `User` is restricted to `id = ownerId` in `forOwner()`, `Invite` only accepts the invite-acceptance write; relations, relation `_count` and nested writes are rejected (see the section above) |
| Interactive/batch `$transaction` inherits the extension (tested), including the raw SQL block   | n/a                                                                                                                                                                                                                |
| `omit`/`select` globais e extensões de resultado não são verificados                            | n/a hoje                                                                                                                                                                                                           |
| Sem RLS no PostgreSQL                                                                           | Endurecimento planejado na Fase 7 (ADR-0008, item 6)                                                                                                                                                               |

## Exclusao e exportacao de conta (S2.3a, ADR-0014)

```ts
// Codigo de servidor confiavel (modulo de conta da API). NAO passa por forOwner nem exige unsafeRaw.
const result = await db.purgeAccount(ownerId); // { purged, deletionId, rowsDeleted, tables }
const data = await exportAccountData(db, ownerId, { store }); // AccountExport (JSON puro)
```

- **`db.purgeAccount(ownerId)`** (`src/account/purge.ts`): uma transacao interativa que (1) liga a flag com
  `set_config('chameleon.allow_purge', 'on', true)` (local a transacao: revertida no COMMIT/ROLLBACK, nunca fica
  numa conexao do pool), (2) trava a linha de `User`, (3) apaga convites ligados a conta (guardam e-mail),
  (4) `DELETE FROM "User"` (cascata em todas as tabelas do dono, inclusive `ProfileRevision` imutavel), (5) confere
  **pelo catalogo** (toda tabela com coluna `"ownerId"`, nao uma lista a mao) que sobraram 0 linhas e, se sobrou
  alguma, desfaz tudo (`PurgeIncompleteError`), (6) grava um `AccountDeletion` (sem referencia ao dono). Dono
  inexistente: `{ purged: false }`, nada gravado. `ownerId` precisa ser UUID. Tabela nova com `ownerId` e FK
  em cascata para `User` (direta ou via perfil) entra no purge sem alterar codigo; sem cascata, o purge falha
  alto em vez de deixar dado para tras. Nao apaga arquivos do storage nem encerra o cookie: isso e da API.
- **`exportAccountData(db, ownerId, { store, now? })`** (`src/account/export.ts`): le por `db.forOwner` (e o convite
  aceito por `db.global`), com `select` explicito (lista de permissao: coluna nova nao sai sem ser classificada).
  Secoes: `account`, `profiles` (documento canonico via `store.loadProfileDocument`), `revisions` (com snapshot),
  `imports` (sem conteudo bruto; o arquivo enviado fica no storage), `consents`, `auditEvents`, `sessions`
  (metadados), `credentials` (so o tipo), `invitations`. Nunca `passwordHash` nem `tokenHash`. As secoes sao lidas
  em sequencia (nao num unico snapshot).
- **`ACCOUNT_EXPORT_REGISTRY`** (`src/account/registry.ts`): toda tabela e `exported` (secao + colunas retidas) ou
  `excluded` (motivo). `Record<Prisma.ModelName, ...>` quebra a compilacao e `account-export-registry.test.ts` /
  `account-export.int.test.ts` quebram os testes se um model/tabela/coluna ficar sem classificacao.
- Testes: `test/account-purge.int.test.ts` (dois donos + canarios, flag nao vaza na mesma conexao, atomicidade,
  tabela futura), `test/account-export.int.test.ts`, `test/account-export-registry.test.ts`.

## Harness de teste (`@chameleon/db/testing`)

Requer `TEST_DATABASE_ADMIN_URL` (já no `.env`; o `vitest.config.ts` carrega o `.env`) e o cluster no ar
(`pnpm db:local:start`). **Recusa qualquer host que não seja `127.0.0.1`, `localhost` ou `::1`** e só
remove bancos `chameleon_test_*`.

```ts
// foo.int.test.ts  (projeto `integration`; o nome precisa terminar em .int.test.ts)
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '@chameleon/db/testing';

let testDb: TestDb;
beforeAll(async () => (testDb = await createTestDb())); // clone novo e vazio, já migrado
afterAll(async () => testDb.drop());
beforeEach(async () => testDb.truncateAll()); // opcional: limpa as tabelas entre testes

it('...', async () => {
  const user = await testDb.db.global.user.create({ data: { email: 'a@example.test' } });
  await testDb.db.forOwner(user.id).session.create({ data: { ownerId: user.id /* ... */ } });
  await testDb.sql('SELECT 1'); // SQL cru (pg) para violações de FK/CHECK e inspeção do catálogo
  // testDb.url -> connection string do clone (para subir a API de teste apontando para ele)
});
```

- `createTestDb()` -> `{ name, url, db, sql, truncateAll, drop }`. `withTestDb(fn)` cria, executa e
  remove (mesmo em falha).
- Primeiro uso do processo: garante o **template** `chameleon_test_tpl_<hash das migrações>`
  (criado sob advisory lock com `prisma migrate deploy` em banco temporário e renomeado, então nunca
  existe template pela metade). Mudou uma migração -> hash novo -> template novo, sem passo manual.
- Cada chamada clona `CREATE DATABASE chameleon_test_<run>_w<worker>_<n> TEMPLATE ...` (~100 ms);
  workers e arquivos nunca compartilham estado. `drop()` usa `DROP DATABASE ... WITH (FORCE)`.
- Bancos órfãos (execução interrompida) carregam um carimbo no `COMMENT` e são varridos
  automaticamente: clones com mais de 6 h, templates antigos com mais de 7 dias.
- `truncateAll()` não dispara triggers de linha (as de imutabilidade da S1.1b não atrapalham).
- Nenhum `globalSetup` é necessário (a criação do template é preguiçosa e idempotente entre workers).
- `process.env.CHAMELEON_TEST_RUN_ID` (opcional) fixa o identificador da execução nos nomes.
- No CI, o `services: postgres` em `localhost` funciona com o mesmo `TEST_DATABASE_ADMIN_URL`.

## Spike dos padrões Prisma 7 (ADR-0006, adendo)

Resultado completo no adendo do ADR-0006. Resumo: PK compartilhada, FK composta `(id, ownerId)`
(obrigatória e opcional), schema multi-arquivo com adapter-pg, CHECK e trigger manuais **funcionam**; o
fallback do R2 **não** foi necessário. O DDL do spike é mantido como fixture em
`test/fixtures/adr0006-patterns.sql` e exercitado por `test/adr0006-patterns.int.test.ts`.
