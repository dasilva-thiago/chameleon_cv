# @chameleon/profile-io

Leitura, migração, normalização, validação e serialização do documento de perfil (contrato
`2.1.0` em `@chameleon/contracts`; aceita também 2.0.0 e o legado 1.0.0). Funções puras, sem I/O de arquivo: quem lê/grava arquivos é a
API (`apps/api`).

## Pipeline de importação (ADR-0004)

```text
parse (YAML|JSON) → detectar schema_version → migrar (1.0.0 → 2.1.0, 2.0.0 → 2.1.0) → normalizar → validar (Zod)
  → forma canônica → defaults de governança (needs_review) → ids (UUID v7) → pré-visualização
```

- `loadProfile(input, { mode, format, limits })` — tudo até a forma canônica, **sem** defaults de
  governança nem ids definitivos. Devolve `{ ok, report, document }`.
- `importProfile(input, { existing, existingIdMap, generateId, mode, … })` — pipeline completo.
  Devolve `{ ok, report, document, preview }`. **Nada é persistido.**
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

## Fora do escopo desta fatia

- Parser do Markdown anotado (`<!-- path: ... -->`): S2.4 (ADR-0013, fase 2b).
- Persistência do `ImportRecord`, aplicação do merge/replace e confirmação em lote: API/DB.
- Importação de DOCX/PDF: pós-MVP.
