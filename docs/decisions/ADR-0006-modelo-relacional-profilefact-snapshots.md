# ADR-0006 — Modelo relacional: ProfileFact, tabelas tipadas, JSONB e snapshots imutáveis

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O Adendo §6.2 pede para evitar "JSON gigante", permitir filtrar, validar, versionar e relacionar, e considerar uma camada `ProfileFact`. O plano §4.6 e o §7.3 exigem `sourceFactIds` em cada bullet. O Adendo §6.3 exige que alterar o perfil não modifique currículos aprovados.

## Decisão
1. **Tabelas tipadas por entidade** (Experience, ExperienceItem, Project, ProjectItem, Education, Course, Skill, SkillUsage, LanguageProficiency, Certification, Award, Publication, Volunteering, ProfileStatement, CompetencyExample), com colunas para tudo o que é filtrado, ordenado, juntado ou validado.
2. **`ProfileFact`** como camada de governança, com uma linha por registro citável e **PK compartilhada**: `Experience.id = ProfileFact.id`. Ela concentra `kind`, `status`, `visibility`, `resumeUse`, `source`, `fieldStates`, `declaredStatus` e os timestamps. `EvidenceLink`, `PendingItem.targetFactId` e `UsageRestriction.targetFactId` têm **FK real** para `ProfileFact`.
3. **Política de JSONB:** só (a) atributos descritivos não citáveis validados por Zod (`details`), (b) documentos de preferência, (c) snapshots imutáveis e (d) mapas esparsos. **Nada citável fica dentro de JSONB**, porque todo item que um bullet pode citar é linha com UUID.
4. **`ProfileRevision`** imutável com `snapshot` (ProfileDocument v2 completo) e `contentHash` (SHA-256 de JSON canônico RFC 8785). É criado antes de cada geração, reutilizado se o hash não mudou. `MatchAnalysis`, `ResumeVersion` e `RequirementMatchEvidence` referenciam o **snapshot** (ids como valores, sem FK para linhas vivas).
5. **Imutabilidade no banco:** triggers `BEFORE UPDATE OR DELETE` em `ProfileRevision`, `ResumeVersion` aprovada/exportada e `DocumentExport`. A exceção controlada é a exclusão de conta (`SET LOCAL chameleon.allow_purge = 'on'`). Os CHECKs de `SkillUsage` ficam em migração SQL manual.
6. **Datas** como `date` + precisão (`year|month|day`).
7. **Exclusão:** arquivar é o padrão; a exclusão definitiva é explícita; o pedido LGPD prevalece (ADR-0014).

Padrões a validar com `prisma validate` na fatia 1.A (não verificados por execução nesta ADR):

```prisma
model ProfileFact {
  id        String @id @db.Uuid
  ownerId   String @db.Uuid
  profileId String @db.Uuid
  kind      FactKind
  status    FactStatus @default(needs_review)
  // ...visibility, resumeUse, source, fieldStates Json, timestamps
  profile    ProfessionalProfile @relation(fields: [profileId, ownerId], references: [id, ownerId], onDelete: Cascade)
  experience Experience?
  @@unique([id, ownerId])
  @@index([ownerId, profileId, status])
}
model Experience {
  id      String @id @db.Uuid
  ownerId String @db.Uuid
  fact    ProfileFact @relation(fields: [id, ownerId], references: [id, ownerId], onDelete: Cascade)
  @@unique([id, ownerId])
  // colunas tipadas + details Json
}
```

## Alternativas
- **Tabela EAV ou `ProfileFact` genérica com payload JSONB para tudo:** flexível, mas perde tipos, CHECKs e consultas essenciais. É o "JSON gigante" disfarçado.
- **Metadados repetidos em cada tabela tipada, sem `ProfileFact`:** evidências e pendências ficariam polimórficas, sem FK, e consultas como "todas as pendências do perfil" exigiriam UNION de 15 tabelas.
- **Histórico apontando para linhas vivas com FK:** editar ou excluir o perfil alteraria ou quebraria currículos aprovados.

## Consequências
- Criar um registro é sempre uma transação de duas linhas (fato + tabela tipada), encapsulada em `packages/db`.
- Um teste de integração verifica, para cada `FactKind`, a coerência entre `ProfileFact.kind` e a tabela tipada.

## Verificação
- Testes de integração: round-trip de fixtures (ADR-0003).
- Tentativa de `UPDATE` em revisão ou versão aprovada falha.
- Arquivar um fato não altera uma `ResumeVersion` aprovada nem seu `validationReport`.

## Adendo S1.1a (2026-11-04): spike dos padrões no Prisma 7.10.1 + PostgreSQL 18

Validado por execução contra o cluster local (schema multi-arquivo, `@prisma/adapter-pg`, `prisma migrate dev/deploy`). **Nenhum fallback do R2 foi necessário.**

- **PK compartilhada** `ProfileFact.id` = `Experience.id`, com relação 1:1 `fields: [id, ownerId]`: `prisma validate` e a migração geraram a FK composta sobre a PK. Criação funciona em duas formas: nested `profileFact.create({ data: { id, ..., experience: { create: { title } } } })` (o filho **não** recebe `id` nem `ownerId`; vêm do pai) e duas linhas em `$transaction` com escalares (`ownerId` explícito). Tabela tipada sem fato e fato inexistente são rejeitados (P2003); a cascata fato -> tipada funciona.
- **FK composta** `(xId, ownerId) -> (id, ownerId)` entre tabelas: gerada como esperado, exige `@@unique([id, ownerId])` no pai. Vínculos entre donos falham no banco (SQLSTATE 23503, constraint `<Tabela>_<col>_ownerId_fkey`).
- **FK composta opcional** (`experienceId?` + `ownerId` obrigatório): o Prisma exige o campo oposto na tabela referenciada; `experienceId` nulo desliga a FK (MATCH SIMPLE). **`onDelete: SetNull` é inviável** (anularia `ownerId`): usar `Cascade`/`Restrict`/`NoAction`.
- **CHECK e trigger** em migração SQL manual (diretório próprio): aplicados por `migrate deploy`; `migrate dev` reporta "in sync" (não há drift). A exceção `SET LOCAL chameleon.allow_purge = 'on'` funciona dentro de transação.
- **Erros no cliente:** violações de CHECK/trigger chegam como `P2039`; unicidade como `P2002`; FK como `P2003`. A mensagem é localizada pelo PostgreSQL; testes devem conferir o **nome da constraint**.
- **Não impedido pelo banco:** coerência `ProfileFact.kind` x tabela tipada (continua na aplicação + teste, como previsto).
- **citext:** `@db.Citext` exige `CREATE EXTENSION citext` na primeira migração (extensão confiável, sem superusuário).
- `prisma generate` com o gerador `prisma-client` exige `output` (gerado em `packages/db/src/generated/prisma`); `prisma.config.ts` define `schema` e `datasource.url`; o Prisma 7 não carrega `.env` sozinho.
- Evidências: `packages/db/test/adr0006-patterns.int.test.ts` (+ `test/fixtures/adr0006-patterns.sql`, DDL do spike) e `packages/db/test/identity-schema.int.test.ts` (invariantes de catálogo no schema real).
