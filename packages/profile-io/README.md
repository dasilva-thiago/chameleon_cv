# @chameleon/profile-io

Leitura, migração, normalização, validação e serialização do documento de perfil (contrato
`2.1.0` em `@chameleon/contracts`; aceita também 2.0.0 e o legado 1.0.0). Funções puras, sem I/O de arquivo: quem lê/grava arquivos é a
API (`apps/api`).

## Pipeline de importação (ADR-0004)

```text
parse (YAML|JSON|Markdown anotado) → detectar schema_version → migrar (1.0.0 → 2.1.0, 2.0.0 → 2.1.0) → normalizar → validar (Zod)
  → forma canônica → defaults de governança (needs_review) → ids (UUID v7) → pré-visualização
```

- `loadProfile(input, { mode, format, limits })` — tudo até a forma canônica, **sem** defaults de
  governança nem ids definitivos. Devolve `{ ok, report, document }`.
- `importProfile(input, { existing, existingIdMap, generateId, mode, … })` — pipeline completo.
  Devolve `{ ok, report, document, preview }`. **Nada é persistido.**
- Formatos de entrada: YAML, JSON e o **Markdown anotado** do template v2 (secao abaixo).
  `loadProfile`/`importProfile` aceitam `format: 'auto' | 'yaml' | 'json' | 'markdown'` e
  `hint: { filename, contentType }` (a extensao `.md` seleciona o Markdown).
- `serializeProfile(document, 'yaml' | 'json')` — forma canônica (chaves na ordem do contrato,
  sem chaves nulas, datas e versões entre aspas, LF). Round-trip estável.

`report` é o `ImportReport` (`@chameleon/contracts`): versões de origem e destino, `steps`,
`warnings` (códigos em `IMPORT_WARNING_CODES`), `errors`, `unmapped` (conteúdo preservado fora do
modelo) e `id_map` (id local → UUID).

## Semântica

- **Ausência:** omitido ou `null` = não informado; `[]` = nenhum item; `""` é normalizado para
  `null` (`EMPTY_STRING_NORMALIZED`); registros sem conteúdo são descartados
  (`EMPTY_RECORD_DROPPED`). O contrato rejeita `""`.
- **Governança:** todo fato importado vira `needs_review`; o status declarado vai para
  `meta.declared_status`. **Exceção:** `archived` permanece `archived` e recebe `resume_use: never`
  (ADR-0005, emenda; aviso `ARCHIVED_STATUS_KEPT`); `conflicting` vira `needs_review`. Visibilidade (`public`, exceto `career_narrative` = `private`), uso em
  currículo (`allowed`, ou `never` se privado) e origem (`profile_import`) só são preenchidos
  quando o arquivo não os informa. Confirmar é uma ação explícita do usuário (fora deste pacote).
- **Modos:** `strict` (padrão) rejeita chaves desconhecidas; `lenient` converte em aviso
  `UNKNOWN_KEY_UNMAPPED` e preserva o valor em `report.unmapped`.
- **Ids:** ids locais (`EXP-001`) viram UUID v7 e **todas** as referências são reescritas;
  `existingIdMap` torna a reimportação idempotente; ids que já são UUID são mantidos.
- **Versões 2.x:** um arquivo `2.0.0` é aceito por `migratePreviousToCurrent` (o 2.1.0 só acrescenta;
  apenas `schema_version` muda, com o aviso informativo `SCHEMA_VERSION_UPGRADED`). Versões futuras
  (`VERSION_FUTURE`) e desconhecidas (`VERSION_UNSUPPORTED`) são recusadas.
- **Telefone:** formatos comuns (`(12) 91234-5678`, `+55 12 91234-5678`, `(415) 555-2671`,
  `+351 912 345 678`, `00351 ...`) são normalizados para a forma canônica (`+` opcional + 7 a 15
  dígitos; aviso informativo `PHONE_NORMALIZED`, sem o valor). Valor inválido é mantido e rejeitado
  pela validação com mensagem que não ecoa o número.
- **Reimportação sem ids:** ids ausentes geram UUIDs novos (não há casamento heurístico por
  conteúdo). Com `existing` informado, se o arquivo tem registros sem id, o relatório traz o aviso
  `IDS_MISSING_REIMPORT_RISK` (com a contagem por tipo): esses registros serão tratados como NOVOS e
  podem **duplicar** informação já cadastrada. Para atualizar em vez de duplicar, reimporte um arquivo
  exportado (com ids) ou acrescente ids ao arquivo.
- **Pré-visualização segura:** `ImportPreview.records[].label` é tipo + posição (`experience #2`),
  nunca conteúdo do registro; `id` identifica o registro. Nada privado (empregador omitido, motivo
  de saída, notas) vai para a preview, os avisos ou as mensagens de erro. Atenção: `report.unmapped`
  guarda, por desenho, o valor descartado (mostre-o só ao dono do perfil).
- **Migração 1.0.0 → 2.1.0** (`migrateV1ToV2`, `docs/domain-model.md` §4): registros-modelo vazios
  descartados; `fact_status` → `declared_status`; tecnologias → `skills` + `skill_usages` com o
  vocabulário do ADR-0007 (contexto sem fonte vira `unverified` + pendência); `disclosure` →
  `resume_use`; `freelance_and_business` → `experiences`; campos duplicados unidos; valores
  inválidos vão para `meta.private_notes` ou `unmapped` (nunca se perdem); consentimento dentro do
  arquivo é ignorado (`CONSENT_IN_FILE_NOT_RECORDED`); nível de idioma em texto livre
  ("advanced", "avançado") vira `self_described_level` com o original preservado, **sem inventar
  CEFR** (`LANGUAGE_LEVEL_SELF_DESCRIBED`); pendências repetidas para o mesmo registro e motivo são
  deduplicadas. Id do passo no relatório: `v1_0_0_to_v2_1_0`.

## Limites de segurança do parse (`DEFAULT_PARSE_LIMITS`)

| Limite            | Padrão  | Erro                      |
| ----------------- | ------- | ------------------------- |
| Tamanho do texto  | 2 MiB   | `TOO_LARGE` (bytes UTF-8) |
| Profundidade      | 32      | `TOO_DEEP`                |
| Nós totais        | 200.000 | `TOO_MANY_NODES`          |
| Tamanho de string | 20.000  | `STRING_TOO_LONG`         |
| Tamanho de chave  | 128     | `KEY_TOO_LONG`            |

YAML: esquema _core_ 1.2 (sem `!!binary`, `!!set`, timestamps ou tags customizadas); **sem**
âncoras, aliases, chaves de mescla (`<<`), tags explícitas, documentos múltiplos ou chaves
duplicadas. Chaves `__proto__`, `constructor` e `prototype` são recusadas em qualquer nível. Números
não finitos (`.inf`, `.nan`) são recusados. A raiz precisa ser um mapa/objeto.

## Annotated Markdown import (S2.4, ADR-0013 phase 2b)

`parseProfileMarkdown(text, { limits })` reads a FILLED copy of `templates/profile/*.v2.md` and
returns the same v2.1.0 interchange object that YAML/JSON import consumes, plus `warnings`
(`IMPORT_WARNING_CODES`) and `unmapped`. It never throws and the object then goes through the normal
pipeline (migrate, normalize, validate, defaults, ids). Detection: `detectTextFormat(text, hint)`
returns `markdown` for a `.md`/`.markdown` file name or `text/markdown` MIME hint, or when the text
contains a `<!-- path: ... -->` annotation (and no `schema_version:` YAML key).

**How it reads the form.** A field is a line (a bullet or a bold label) that ends with
`<!-- path: <contract path> -->`; the answer is the text between the label and the annotation. The
parser trusts only those anchors. Supported label styles: `**Label:** answer`,
`**Question? (lista)** answer` and `**Label** (long hint): answer`. Answers may continue on
following lines that are indented by 2+ spaces.

- **Records.** Repeatable sections hold any number of records. A new record starts at a heading
  that names a record (`... registro N`), when a field already filled in the open record is
  annotated again, or when an `id` field appears in a record that already has fields. Child records
  (experience items, project items, collaborators) also start after any heading. A record appears in
  the output only when it has content (an `id`, `meta`, or a discriminator such as `kind` alone is
  not content). Section 8.3 (`skills[].study_plan.*`) is attached to the most recent skill record
  (`RECORD_RELOCATED`, information).
- **Absence.** Blank answers, `[Preencher]`, `_`, `-`, `...` and "not provided" texts ("Não
  informado", "N/A", "Not provided", ...) produce no key: they never become values or negative
  facts. Placeholders are silent; a sentinel typed by the user raises `EMPTY_STRING_NORMALIZED`
  (information). An answer that still lists every printed option ("`true` ou `false`", the full
  enum list) is "nothing chosen"; they are counted in one `EMPTY_STRING_NORMALIZED` notice.
- **Explicit states.** `(não se aplica)`, `(prefiro não informar)`, `(ainda não avaliei)` and
  `(confirmar depois)` (accent/case-insensitive, also in English) become `field_states` /
  `meta.field_states`. `(confirmar depois)` may follow a value (the value is kept). A value typed
  next to one of the other markers is dropped (`INVALID_VALUE_DROPPED`). Records without
  `field_states` (contacts, evidence, pending items, restrictions, collaborators) cannot carry a
  state; the marker is ignored with a warning.
- **Multi-choice answers.** The English contract value (alone, backticked, or with the template's
  gloss such as "`allowed` (sim)") or the Portuguese gloss maps to the enum without loss:
  `sim/parcialmente/não` to `public/partial/not_public`, `sim/com restrição/não` to
  `allowed/restricted/not_allowed`, `sim/parcialmente (com aprovação)/não` to
  `allowed/requires_approval/never`, `sim/não/depende` to `yes/no/depends`, and so on. Unknown
  values raise `INVALID_ENUM_VALUE_DROPPED` and are kept in `unmapped`.
- **Types.** Booleans accept `true/false/sim/não`; numbers accept `40`, `40,5`, `1.500,50` (a lone
  separator followed by three digits, such as `1.500`, is ambiguous and rejected); end dates accept
  `present` (also `atual`); dates keep the precision typed. Lists accept nested bullets (each is an
  atomic item) or an inline list separated by `;` (if any `;` is present) or `,`. Phone numbers go
  through the existing normalizer.
- **Security.** Paths are accepted only from the contract path list and never the importer-owned
  `meta.status/declared_status/source/source_detail/source_excerpt` or `field_states` paths; other
  annotations are reported (`UNKNOWN_KEY_UNMAPPED`) and not applied. A path repeated for a singleton
  field keeps the first value (`DUPLICATE_FIELD_IGNORED`). HTML in values is plain text. Other HTML
  comments (also multi-line) are removed and the annotations inside them are ignored. Warnings carry
  paths and line numbers (`markdown:line:N`) and never file content; `unmapped` keeps the dropped
  value by design. Scanning is linear (no backtracking regexes), reuses `DEFAULT_PARSE_LIMITS`
  (bytes, nodes, string length per answer/line; depth is bounded by the fixed path list) and caps
  the report (100 warnings per code, 200 unmapped entries).
- **Report.** `report.source_format` is `markdown` (contract enum and DB enum `ImportSourceFormat`, S2.3a); the
  step `parse_markdown` is kept.
  Unreadable input fails with `EMPTY`, `TOO_LARGE`, `STRING_TOO_LONG`, `TOO_MANY_NODES` or
  `NO_ANNOTATIONS` (free Markdown without anchors is not supported).

**Limitations.** Free Markdown, tables, fenced code and DOCX/PDF are not read. Lines under a field
that are not indented are not part of its answer (they are reported). `[]` ("explicitly none") has
no Markdown form: an empty section is simply absent. Without a record heading or an `id`, two
consecutive records that never repeat a field are read as one record. A study plan (8.3) cannot
target a skill other than the most recent one. `[text](url)` links are not unwrapped. A person who
really wants every option of an inline enum list must not print them backticked in contract order.

## Fora do escopo desta fatia

- Persistência do `ImportRecord`, aplicação do merge/replace e confirmação em lote: API/DB.
- Importação de DOCX/PDF: pós-MVP.
