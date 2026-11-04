# ADR-0004 — Versionamento do documento de perfil (2.0.0) e migração do 1.0.0

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
Os arquivos distribuídos declaram `schema_version: "1.0.0"` com semântica permissiva (vocabulários de contexto diferentes, `""` como ausência, `fact_status: confirmed` por padrão). As correções necessárias são **incompatíveis**: enums impostos, objetos fechados, `usage_context` renomeado, `freelance_and_business` consolidado. O Adendo §11 exige testar a "importação de versão antiga do schema", e o §6.3 exige registrar como cada versão foi convertida.

## Decisão
- **SemVer do documento:**
  - MAJOR = remoção ou renomeação de campo, ou mudança de semântica ou de enum;
  - MINOR = campo opcional ou valor de enum novo;
  - PATCH = documentação ou correção de validação que não rejeita documentos antes válidos.
- **O contrato corrigido é `2.0.0`.** O `1.0.0` vira legado suportado. Fazer correção incompatível mantendo "1.0.0" faria uma mesma versão ter duas semânticas, o que inviabiliza a migração.
- **Pipeline de importação:** `parse (YAML|JSON) → detectar schema_version → cadeia de migrações puras (v1_0_0→v2_0_0, ...) → validar no Zod atual → normalizar → pré-visualizar → aplicar`.
  - Cada passo devolve `{document, warnings[], steps[]}`.
  - O `ImportRecord` guarda as versões de origem e de destino, os passos, os avisos, o `idMap` e o conteúdo `unmapped`.
  - Versão desconhecida, futura ou ausente gera erro claro, sem "adivinhar".
- **Snapshots** guardam `schemaVersion`. Na leitura de snapshot antigo, aplica-se a mesma cadeia em memória; o original não é reescrito.
- A exportação sempre emite a versão corrente.

## Alternativas
- **Corrigir no lugar mantendo 1.0.0:** rejeitada (ambiguidade).
- **1.1.0:** viola o SemVer, porque as mudanças quebram documentos válidos.
- **Migração "best effort" sem registro:** viola o Adendo §6.3.

## Consequências
- O mapeamento completo está em `docs/domain-model.md` §4.
- As fixtures legadas (`packages/contracts/fixtures/legacy/v1.0.0/`) incluem uma cópia do YAML da raiz e casos sintéticos preenchidos.

## Verificação
Testes `profile-io/test/migrate-v1.test.ts`:
- o template 1.0.0 importa sem registros fantasma;
- um documento 1.0.0 preenchido migra com os avisos esperados;
- `fact_status: confirmed` vira `needs_review` com `declared_status`;
- `technologies_used.usage_context: professional` sem experiência ligada gera pendência;
- versão `9.9.9` é rejeitada.

## Emenda 2026-11-04 — contrato 2.1.0 (MINOR aditivo, S0.2b)

A conversão do perfil-piloto (S0.4) e a validação das fixtures (S0.3b) mostraram lacunas reais do 2.0.0. Seguindo a regra de congelamento (plano §3.7: mudança exige ADR curta, bump de versão e atualização de templates, JSON Schema e fixtures na mesma entrega), o contrato corrente passa a ser **`2.1.0`**. Todas as mudanças são aditivas: nenhum documento 2.0.0 válido deixa de ser válido.

Changelog do contrato 2.1.0:

1. **Telefone.** O importador aceita formatos comuns (parênteses, espaços, pontos, hífens, `+` ou `00`) e grava a forma canônica (`+` opcional + 7 a 15 dígitos). O contrato valida a forma canônica e, por tolerância, as formas de entrada. Valor inválido gera erro sem ecoar o número.
2. **Idiomas.** Novo campo opcional `languages[].self_described_level` (texto curto, palavras da pessoa). Nunca é promovido a CEFR automaticamente. `native` já existia em `LanguageLevel` e continua válido. A migração 1.0.0 mapeia texto livre ("advanced", "avançado", "intermediate") para `self_described_level`, preservando o original, sem inventar CEFR.
3. **`field_states` aninhado.** `meta.field_states` (e `field_states` dos blocos) aceitam caminhos dentro do registro (`metric.value`, `business.portfolio_url`), validados contra os campos reais do tipo, como já era feito em `target.field` de pendências e restrições.
4. **Importação de `archived`** (emenda do ADR-0005): permanece `archived` com `resume_use: never`.
5. **Relatório de importação:** novos códigos `SCHEMA_VERSION_UPGRADED`, `PHONE_NORMALIZED`, `LANGUAGE_LEVEL_SELF_DESCRIBED`, `ARCHIVED_STATUS_KEPT` e `IDS_MISSING_REIMPORT_RISK` (reimportação de arquivo sem ids sobre perfil existente: aviso de risco de duplicação, sem casamento heurístico por conteúdo). `ImportPreview.label` passa a ser um rótulo seguro (tipo + posição), sem valores de campos privados.
6. **Migração 2.0.0 → 2.1.0:** trivial. Só `schema_version` muda, com aviso informativo `SCHEMA_VERSION_UPGRADED`. `SUPPORTED_SCHEMA_VERSIONS = [1.0.0, 2.0.0, 2.1.0]`; o Zod valida apenas a versão corrente (`PREVIOUS_PROFILE_SCHEMA_VERSIONS` lista as anteriores aceitas pelo importador). O passo 1.0.0 → corrente passa a se chamar `v1_0_0_to_v2_1_0` no relatório.
7. **Migração 1.0.0:** pendências duplicadas para o mesmo registro fundido e o mesmo motivo são deduplicadas.

Impacto: templates v2 (YAML e MD anotado), JSON Schema gerado, fixtures sintéticas e `docs/domain-model.md` (§2 e §4, com changelog) foram atualizados na mesma entrega. Snapshots persistidos em 2.0.0 continuam legíveis pela cadeia de migração em memória.
