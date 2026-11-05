# Suíte de isolamento multiusuário (S1.4)

Dono: qa-engineer. Fonte: ADR-0008 (itens 1, 2, 4, 5), ADR-0009, ADR-0014 e os critérios da Fase 1 de
`docs/implementation-plan.md`. Roda no projeto `integration` do Vitest e precisa do cluster local no ar:

```
pnpm db:local:start
pnpm test:integration                                       # tudo (inclui esta suíte)
pnpm exec vitest run --project integration tests/integration/isolation   # só a suíte de isolamento
```

`tests/` não é um workspace (sem `node_modules`, `@chameleon/*` não resolve), então tudo é importado por caminho
relativo, concentrado em `support/workspace.ts`. A regra de dependências (`tests/architecture/deps-lib.ts`) só
restringe arquivos dentro de `apps/*` e `packages/*`; o único proibido aqui é `@prisma/*`.

## O que cada arquivo prova

| Arquivo                                | Prova                                                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route-gate.test.ts`                   | **Gate de rotas.** Falha se uma rota do manifesto real está `unclassified`, vem de router fora do registro (`<?>`), não está em `coverage.ts`, ou exige sessão/tem `:param` sem caso cruzado. Provas negativas com apps sintéticos. |
| `http-cross-owner.test.ts`             | Executa **todos** os casos de `cross-cases.ts` (A × B pelo HTTP real, fluxo de convite) e confere que cada caso atingiu as rotas que declara. Varredura final de canários.                                                          |
| `reference-resource-route.test.ts`     | Ciclo completo com uma rota de recurso (`/:revisionId`) sobre o `ProfileStore` real: modelo para a S2.1.                                                                                                                            |
| `profile-store-cross-owner.test.ts`    | Todo método do `ProfileStore` chamado como B com ids de A == recurso inexistente (mesmo código/mensagem), A intacto, `ID_CONFLICT` sem revelar o dono, vínculos cruzados rejeitados.                                                |
| `for-owner-private-models.test.ts`     | Um bloco por modelo de `PRIVATE_MODELS` (30): leitura vazia, update/delete sem efeito, criação/upsert/`owner` com `ownerId` alheio rejeitados, cliente sem escopo lança.                                                            |
| `composite-fk.test.ts`                 | **Gerado do catálogo do PostgreSQL**: toda FK privada é composta; para cada uma, UPDATE e INSERT apontando para linha de outro dono falham (23503). Autoteste mostra que sem a FK o ataque passaria.                                |
| `profile-revision-immutable.test.ts`   | UPDATE/DELETE de `ProfileRevision` falham; purge só com `SET LOCAL chameleon.allow_purge = 'on'`; `DELETE FROM "User"` sem a flag falha por inteiro, com a flag apaga tudo do dono e só dele.                                       |
| `canary-sweep.test.ts`                 | Serializa **tudo** que cada um dos 13 donos lê (ProfileStore + `forOwner` em todos os modelos) e prova que nenhum `CANARY-*`, e-mail ou id de outro dono aparece.                                                                   |
| `logs-privacy.test.ts`                 | Tráfego hostil (segredos/canários em corpo, query, cabeçalhos, cookies, 413, 500 com canário na mensagem) e varredura dos logs capturados.                                                                                          |
| `../snapshot-hash-equivalence.test.ts` | `buildProfileSnapshot` (`@chameleon/domain`) == helper independente do db (JCS + `node:crypto`) para as 12 fixtures v2, em memória e via `createProfileStore`; sensibilidade do hash.                                               |

Além disso **todo** arquivo que usa `createWorld()` roda `assertLogsClean(world)` no `afterAll`: nenhum fluxo da
suíte pode deixar senha, token, e-mail, hash argon2 ou canário no log capturado.

## O mundo de teste (`support/world.ts`)

`createWorld()` clona um banco migrado, sobe o app completo (com `LogCapture`) e cria **13 donos**, um por fixture de
perfil de `@chameleon/test-fixtures` (12 v2 + o legado 1.0.0), pelo caminho real: convite → aceite → `importProfile`
(profile-io) → `store.applyImport` (+ uma importação em prévia). `a` = `private-heavy` (22 canários), `b` = `non-tech-nurse`.
Mais um dono sintético (`coverage`, preenche vínculos que as fixtures não usam, p.ex. `certification_id` e alvos de
pendência em contato/evidência) e um dono vazio (`bare`). `createPair(world, label)` cria um par descartável A'/B' com
senhas distintas para casos que destroem sessões.

## Como adicionar cobertura quando uma rota nova surgir

Rodou `pnpm test:integration` e o `route-gate.test.ts` falhou com `GET /api/profiles/:profileId: sem cobertura cruzada`?
É o esperado. Passos:

1. **Declare a rota pelo registro**: `routes.<método>(path, { auth: 'session' | 'public' }, ...)`. Rota registrada por
   `router.get` direto aparece como `unclassified` e o gate falha mesmo que você a cubra.
2. **Escreva o caso cruzado** em `cross-cases.ts` (objeto em `CROSS_CASES`):
   - `routes`: as chaves `METHOD /caminho/:param` que o caso exercita (formato do manifesto);
   - `run(ctx)`: use `ctx.world.a` e `ctx.world.b` (já têm perfil, revisões e importações) e `ctx.http(client)` para que as
     rotas atingidas sejam registradas. Peça o recurso **de A como B** e um id inexistente: as respostas devem ser
     idênticas (status, corpo sem `requestId`). Para escrita, confirme que A ficou intacto (`readEverythingAs`).
     `ctx.observe(b, response)` acumula o que B recebeu; chame `expectNoLeaks(..., await forbiddenFor(world, b))`.
     Casos que destroem sessão ou usuário usam `ctx.pair('rotulo')`.
   - `reference-resource-route.test.ts` é um exemplo completo e executável.
3. **Registre em `coverage.ts`**: `'GET /api/profiles/:profileId': { kind: 'cross-case', caseId: '<id do caso>' }`.
   `no-private-data` é aceito **somente** para rota pública, sem `:param` e que não muta estado (ex.: `/health`), com
   justificativa. O gate recusa `no-private-data` em rota com sessão, com parâmetro ou mutante.
4. O gate também falha se: o caso não declara a rota; o caso não existe; há entrada de cobertura de rota removida; há
   caso não referenciado. `http-cross-owner.test.ts` falha se o caso declara uma rota que não atingiu.

Rota removida? Apague a entrada em `coverage.ts` (o gate aponta a entrada obsoleta).

## Quando surgirem modelos/tabelas novas

- Modelo privado novo: registre em `packages/db/src/private-models.ts`. `for-owner-private-models.test.ts` e
  `composite-fk.test.ts` o pegam sozinhos (o primeiro exige que o mundo de teste tenha **linhas** do modelo; se faltar, estenda
  `createWorld` ou `COVERAGE_PROFILE`). FK nova sem dados para exercitar faz `composite-fk.test.ts` falhar
  (`FKs sem dados nas fixtures para exercitar`).
- Fluxos novos que logam: o `afterAll` com `assertLogsClean` já cobre; registre segredos extras com `registerSecret`.

## Lacunas conhecidas e decisões

- Não há ainda rotas de perfil/importação/exportação/IA/arquivos: a cobertura HTTP real é a de autenticação. Os itens
  5(c) (busca, contexto de IA, DOCX/PDF) e 5(e) (arquivos) do ADR-0008 entram com a S2.1+/S3+; a suíte já tem os
  mecanismos (`forbiddenFor`, `readEverythingAs`, `CrossCaseContext`).
- `ID_CONFLICT` confirma que um UUID existe em algum dono (oráculo de existência de baixa severidade; UUIDs v7 não são
  adivinháveis). Registrado, não corrigido.
- The database blocks `UPDATE ... SET ownerId` on **every** table that has the column, including those whose only FK is
  to `User` (Credential, Session, ConsentRecord, AuditEvent, ProfessionalProfile): the `owner_immutable` migration
  installs the `<Table>_owner_immutable` trigger (covered by `packages/db/test/owner-immutable.int.test.ts`). `forOwner`
  remains the first line of defense; `db.unsafeRaw`/raw SQL stay subject to security review.
- `TRUNCATE` ignora o gatilho de imutabilidade da `ProfileRevision` (é o que `truncateAll()` do harness usa).
- Exclusão de conta pelo Prisma (`db.global.user.delete`) falha enquanto houver `ProfileRevision`: a S2.3 precisa de uma
  rotina em `packages/db` que execute `SET LOCAL chameleon.allow_purge = 'on'` na mesma transação do `DELETE`.
- Teste de bundle da web (chaves/segredos no build): já existe em `apps/web/test/bundle.test.ts` (S1.3); não duplicado.
