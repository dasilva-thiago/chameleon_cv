# Geração dos JSON Schemas do contrato

O contrato canônico é o Zod 4 em `src/profile/v2/` (ADR-0003). Os artefatos derivados ficam em
`generated/` e são **commitados**:

| Comando                   | Efeito                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:generate` | Grava `generated/profile-document.v2.schema.json` (`z.toJSONSchema`, draft 2020-12).                                       |
| `pnpm contracts:check`    | Falha (código 1) se o arquivo commitado diferir do gerado **ou** se o schema não compilar no Ajv 2020-12 em modo `strict`. |

Qualquer mudança no Zod quebra o `contracts:check` até regenerar e atualizar `templates/profile/**`
e as fixtures (intencional; Adendo §13, item 10).

## O JSON Schema é um subconjunto

Ele expressa a **estrutura**: objetos fechados (`additionalProperties: false`), enums, padrões de
data/e-mail, limites de tamanho e números não negativos. Ele **não** expressa as regras semânticas,
que só existem no Zod (`superRefine`):

- ids únicos em todo o documento; `evidence_ids`, `supports`, `related_*_id`, alvos de pendências e
  restrições resolvendo para registros do tipo certo;
- coerência entre datas (`end_date` não pode ser definitivamente anterior a `start_date`);
- contexto de uso de competências vs. fonte (ADR-0007); competências duplicadas;
- `meta.field_states` coerente com os valores e com os campos reais do registro (inclusive caminhos aninhados como `metric.value`); registros sem conteúdo;
- URLs sem credenciais e DOI; validação de calendário (`2023-02-29`).

Valide documentos sempre com `parseProfileDocument`/`safeParseProfileDocument`
(`@chameleon/contracts`); use o JSON Schema para editores, documentação e verificações estruturais.

`ajv-formats` não é dependência do projeto: `scripts/ajv.ts` registra os formatos que o Zod emite
(`email`) com expressões simples.
