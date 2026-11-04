# Templates do perfil profissional (contrato 2.1.0)

Mantidos à mão e **testados** contra o contrato Zod (ADR-0003):

- `MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.yaml` — usa `null`/`[]`, sem defaults com aparência de
  fato. Teste: é válido e, importado, gera **zero** registros
  (`packages/profile-io/test/import.test.ts`, `templates-roundtrip.test.ts`).
- `MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.md` — formulário para pessoas. Todo campo termina com a
  anotação `<!-- path: profile.experiences[].official_title -->`. Teste bidirecional
  (`packages/contracts/test/template-md-paths.test.ts`): todo caminho anotado existe no contrato e
  todo campo preenchível está anotado ou isento por `MD_EXEMPT_PATH_RULES`
  (`meta.status`, `meta.declared_status`, `meta.source`, `meta.source_detail`,
  `meta.source_excerpt` e `field_states`, que o importador/sistema preenchem ou o MD expressa com
  marcadores como `(não se aplica)`).

Os arquivos `MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.{md,yaml}` e `PERFIL_PROFISSIONAL_SCHEMA.json` da
raiz são a especificação histórica **1.0.0** (cópias em
`packages/contracts/fixtures/legacy/v1.0.0/`).
