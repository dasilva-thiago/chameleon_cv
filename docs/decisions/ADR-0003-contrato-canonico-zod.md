# ADR-0003 — Contrato canônico em Zod, artefatos gerados e testes de alinhamento

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O Adendo §3.3 exige coerência entre MD, YAML, JSON Schema, tipos TS, Zod e banco, sem "cinco esquemas divergentes". A auditoria (`docs/domain-model.md` §1) mostra que o JSON Schema atual é permissivo, que o YAML tem defaults que parecem fatos e que o MD tem campos sem chave estruturada.

## Decisão
1. **A fonte única é o Zod 4**, em `packages/contracts/src/profile/v2/`. Os tipos TS saem por `z.infer`. O contrato tem duas camadas:
   - `ProfileDocumentV2`, de intercâmbio, em `snake_case` e versionado;
   - os DTOs de API e domínio, em `camelCase`.
   Funções puras de mapeamento ficam em `packages/profile-io` (documento ⇄ domínio) e `packages/db` (domínio ⇄ Prisma).
2. **Artefatos gerados** por `pnpm contracts:generate`, que são commitados e verificados por `pnpm contracts:check` (diff vazio):
   - `packages/contracts/generated/profile-document.v2.schema.json` via `z.toJSONSchema` (draft 2020-12), `$id` estável do projeto;
   - os JSON Schemas das saídas de IA (`job-analysis`, `adaptation-plan`, `resume-content`), passados aos provedores.
3. **Templates de pessoas**, mantidos à mão e testados:
   - `templates/profile/...v2.yaml`: usa `null`/`[]` e não tem defaults de fato. **Teste:** é válido no schema e, importado, produz **zero** registros.
   - `templates/profile/...v2.md`: cada campo leva a anotação `<!-- path: profile.experiences[].official_title -->`. **Teste:** todo caminho folha do Zod aparece no MD (salvo a lista explícita `internalOnlyPaths`), e todo caminho anotado existe no Zod. As mesmas âncoras servirão ao parser de MD (ADR-0013).
4. **Banco:**
   - teste de *round-trip* por fixture: documento → importar → persistir → exportar → documento, com igualdade profunda após normalização documentada (ids, `meta` padrão, ordem estável);
   - teste de cobertura: todo campo de `ProfileDocumentV2` tem destino (coluna, JSONB tipado ou `internalOnly`).
5. **Regras semânticas** que o JSON Schema não expressa (ids únicos, referências existentes, coerência de datas e de contexto) ficam em `superRefine` e são documentadas como "validação semântica". O JSON Schema publicado é declaradamente um subconjunto.

## Alternativas
- **JSON Schema como fonte, gerando Zod/TS** (json-schema-to-zod, json-schema-to-typescript): perde `superRefine`, gera tipos verbosos e exige duas validações em runtime.
- **Prisma como fonte** (prisma-zod-generator): acopla o contrato público ao formato do banco e impede um intercâmbio estável.
- **Manter os arquivos atuais à mão e só "revisar":** foi o que produziu as divergências encontradas.

## Consequências
- O MD e o YAML da raiz passam a ser históricos (1.0.0). Os novos templates v2 ficam em `templates/profile/`. O README do pacote deve apontar para eles (tarefa da Fase 0).
- Qualquer mudança no Zod quebra o `contracts:check` até regenerar e atualizar os templates, o que é intencional (Adendo §13, item 10).

## Verificação
`pnpm contracts:check` e os testes `contracts/test/{template-yaml,template-md-paths,json-schema-ajv}.test.ts`. O round-trip no banco roda no projeto `integration`.
