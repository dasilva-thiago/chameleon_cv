# ADR-0013 — Armazenamento de arquivos e formatos de importação

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
- O plano §12 pede para não guardar arquivos gerados como blob no PostgreSQL no MVP, e o §17 pede sanitização, bloqueio de path traversal e autorização em downloads.
- O Adendo §3.2 e o plano §5 colocam a importação de DOCX/PDF como extração preliminar, posterior ao MVP.

## Decisão

**Storage**
- Interface `StorageProvider { put, getStream, delete, deletePrefix }`. A implementação do MVP é `LocalStorageProvider`, em `STORAGE_ROOT` (padrão `.data/storage`, gitignored, fora de qualquer diretório servido).
- Chave opaca `<ownerId>/<purpose>/<uuidv7>`. **Nunca** se usa o nome enviado pelo usuário no caminho. O caminho resolvido é verificado com `path.relative`, deve ficar dentro da raiz, e links simbólicos são rejeitados.
- Os metadados (`UploadedFile`, `DocumentExport`) ficam no banco com `sha256` e tamanho.
- O download passa por uma rota autenticada, com verificação de dono via `forOwner` e `Content-Disposition` com nome sanitizado (RFC 6266). Há também `X-Content-Type-Options: nosniff`.
- Validação na entrada:
  - limite de tamanho (`UPLOAD_MAX_BYTES`, padrão 2 MB para importação de perfil e 10 MB para evidência);
  - MIME detectado por assinatura (`file-type`) e lista permitida por finalidade;
  - texto em UTF-8 válido.
- Não há antivírus no MVP (limitação registrada). Os arquivos nunca são executados nem renderizados como HTML.
- A exclusão de conta chama `deletePrefix(ownerId/)`, com verificação pós-exclusão.
- Futuro: `S3CompatibleStorageProvider`, com a mesma interface.

**Importação (ordem de entrega)**

| Fase | Formato |
|---|---|
| 2 (MVP) | **YAML e JSON** no contrato v2 ou 1.0.0 (com migração), via upload ou colar texto. Pré-visualização obrigatória: contagem por seção, avisos, `unmapped`, mapa de ids e diff com o perfil atual. Aplicação explícita em transação, com criação de `ProfileRevision` e `ImportRecord` |
| 2b | **Markdown do template v2 anotado** (`<!-- path: ... -->`), por parser determinístico das âncoras. Markdown livre não é suportado: o resultado diz o que não foi reconhecido |
| 7 (pós-MVP) | **DOCX/PDF de currículo antigo**: extração de texto (`mammoth`/`unpdf`) → IA estruturada com `source_excerpt` por item → todos os itens com `source = resume_import`, `status = needs_review` e pré-visualização obrigatória. Nunca vira verdade automática |

- **Modos de aplicação:**
  - `merge` (padrão): adiciona registros novos; registros com o mesmo id são atualizados apenas com confirmação por item;
  - `replace`: cria uma nova revisão; nada é apagado sem confirmação.
- **Exportação de perfil:** YAML e JSON v2 com ids UUID. Uma reimportação idempotente não duplica registros.
- **Perfil-piloto:** conversão única, feita manualmente e com apoio de agente, de `BASE_DE_DADOS_CURRICULO_THIAGO.md` (prosa) para `fixtures-private/pilot.profile.v2.yaml` (gitignored). Não é importação de produto.

## Alternativas
- **Blobs no PostgreSQL:** desaconselhados pelo plano para o MVP; aumentam o banco e o backup.
- **Importar DOCX/PDF já no MVP:** maior risco de fatos errados e fora do escopo do MVP.

## Verificação
Testes:
- upload acima do limite → 413;
- MIME falso → 415;
- nome com `../` não afeta o caminho;
- download de outro dono → 404;
- reimportação idempotente;
- importação 1.0.0 com avisos;
- pré-visualização não persiste nada.

## Amendment (S2.4) — annotated Markdown import, phase 2b delivered

`parseProfileMarkdown` (`packages/profile-io/src/markdown.ts`) now reads a filled
`templates/profile/*.v2.md` into the v2.1.0 interchange object and feeds the same pipeline as
YAML/JSON (`detectTextFormat` recognises `.md` hints and `<!-- path: ... -->` annotations;
`loadProfile`/`importProfile` accept `format: 'markdown'`). Delivered behaviour:

- **Anchors only.** The parser trusts the `<!-- path: ... -->` annotations and nothing else. Paths must
  belong to the contract path list and must not be importer-owned (`meta.status`, `declared_status`,
  `source*`, `field_states`); anything else is reported (`UNKNOWN_KEY_UNMAPPED`, kept in
  `report.unmapped`) and not applied. Free Markdown fails with `NO_ANNOTATIONS`.
- **Records and absence.** Repeatable sections may hold several records, delimited by "registro N"
  headings, repeated fields or `id` lines (child records also by headings). Placeholders, blanks and
  "not provided" texts produce no key, so they never become facts or leak as values; explicit markers
  (`(não se aplica)`, `(prefiro não informar)`, `(ainda não avaliei)`, `(confirmar depois)`) become
  `field_states`; yes/no/partial style answers map to the contract enums without loss.
- **Untrusted input.** Same `ParseLimits` as YAML/JSON, linear scanning, report caps, values kept as
  inert text, and warnings with paths and line numbers only (never file content).
- **Open items.** `ImportReport.source_format` and the `ImportSourceFormat` DB enum still lack a
  `markdown` value, so the report records Markdown as `object` plus the step `parse_markdown`
  (a contract + migration change owned by the contracts/DB slice). New warning code
  `DUPLICATE_FIELD_IGNORED`. Details and limitations: `packages/profile-io/README.md`.

## Amendment (S2.3a) — `markdown` source format

`ImportReport.source_format` (`IMPORT_SOURCE_FORMATS` in `@chameleon/contracts`) and the Prisma enum
`ImportSourceFormat` now both include `markdown` (migration `20261105090000_import_source_markdown`;
`packages/db/test/contract-alignment.test.ts` keeps the two lists equal). `importProfile`/`loadProfile`
record annotated Markdown as `markdown` (the `parse_markdown` step stays). This closes the "open item" above.
Raw uploaded content is still not stored in `ImportRecord`; stored files are a storage-layer concern (S2.x).
