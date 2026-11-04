# ADR-0005 — Semântica de ausência e metadados de governança dos fatos

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
- O Adendo §4 exige diferenciar `not_provided`, `not_applicable`, `not_assessed`, `declined` e `needs_confirmation`, e proíbe defaults que pareçam fatos.
- O Adendo §5 exige, por fato: origem, estado, datas, visibilidade, autorização de uso, evidências e restrições.
- No 1.0.0, esses metadados aparecem só em parte dos registros e com seis nomes diferentes para "pode ir ao currículo".

## Decisão
- **Ausência por padrão:** campo omitido ou `null` = `not_provided`; `[]` = nenhum item fornecido; `""` é normalizado para `null`. Nenhum desses valores é usado como afirmação negativa pela IA nem pelo matching. Requisito sem evidência gera `missing`, nunca "o candidato não sabe".
- **Estados explícitos e esparsos:** `meta.field_states: { <campo>: not_applicable | not_assessed | declined | needs_confirmation }`. Isso evita envolver cada campo num objeto `{value, state}`, o que deixaria o YAML ilegível.
  - `declined` e `not_applicable` suprimem novas perguntas na UI.
  - `needs_confirmation` gera aviso e impede afirmar o valor.
  - Níveis de avaliação mantêm `not_assessed` como valor de enum.
- **`meta` uniforme em todo registro citável:** `status`, `visibility`, `resume_use`, `source`, `source_detail`, `source_excerpt`, `evidence_ids`, `field_states`, `private_notes`. O detalhe está em `docs/domain-model.md` §2.3.
- **Defaults aplicados pelo importador, nunca pelo schema:**
  - `status = needs_review` em toda importação. O valor declarado vai para `declared_status`, e a confirmação é uma ação explícita, que pode ser em lote e fica auditada.
  - `visibility = public` e `resume_use = allowed` para registros profissionais; `private` fixo para preferências, disponibilidade, notas, motivo de saída e pronomes.
  - Cadastro pelo formulário nativo: `source = form_entry`. Para o usuário, o formulário é uma declaração; a UI pergunta "confirmar agora?" no salvamento.
- **Consumo nas gerações:**
  - só fatos `confirmed` sustentam afirmações;
  - `needs_review` pode aparecer apenas como sugestão marcada;
  - `conflicting` usa somente `safe_statement_for_now` da pendência ligada;
  - `archived`, `private` e `resume_use: never` nunca entram;
  - `conditional` e `requires_approval` entram só com autorização registrada na versão do currículo.

## Alternativas
- **Wrapper por campo `{value, state, source}`:** máximo de expressividade, mas o YAML fica inviável para pessoas e o volume de dados triplica.
- **Sentinelas textuais ("Não informado"):** vazam para documentos e dependem do idioma.
- **Status padrão `confirmed` para dados digitados pelo usuário em arquivo:** contraria o plano §7.1.

## Consequências
- O validador de geração precisa do snapshot com `meta`, que já está previsto no ADR-0006.
- A UI precisa de controles de status e visibilidade por registro e de ações em lote.

## Verificação
- Fixtures com `field_states` de todos os tipos.
- Testes de que `declined` não gera pergunta, `needs_confirmation` bloqueia a afirmação e um `[]` de experiências não produz texto negativo ("sem experiência") no plano nem no currículo.
- O teste do template v2 importa zero registros.

## Emenda 2026-11-04 — `archived` na importação (contrato 2.1.0)

A regra "`status = needs_review` em toda importação" rebaixava itens que a pessoa já tinha arquivado, devolvendo ao fluxo de revisão (e, com `resume_use: allowed` no arquivo, potencialmente a currículos) conteúdo que ela havia retirado de uso. Decisão:

- Fato declarado `archived` **permanece `archived`** e recebe `resume_use: never` por garantia, mesmo que o arquivo diga `allowed`. Não gera `declared_status`; o importador registra o aviso informativo `ARCHIVED_STATUS_KEPT`.
- `conflicting` continua virando `needs_review`, com `declared_status: conflicting` preservado. `confirmed` também continua virando `needs_review`; a confirmação segue sendo ação explícita do usuário.
- `visibility` segue a regra geral (valor do arquivo ou default). `archived` nunca entra em geração, qualquer que seja a visibilidade (consumo nas gerações, acima).

Verificação: `profile-io/test/contract-2-1.test.ts` e o canário `CANARY-private-heavy-archived_item` (fixture `private-heavy`), que sai da importação com `status: archived` e `resume_use: never`.
