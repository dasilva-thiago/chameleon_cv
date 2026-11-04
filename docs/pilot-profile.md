# S0.4 — Perfil-piloto no contrato 2.1.0

**Status:** implementado (2026-11-04). Sem dados pessoais neste documento. Decisão relacionada: ADR-0014.

O perfil-piloto é **apenas uma fixture**: o produto não tem campo, regra nem texto específicos dele.
Os dados reais ficam em arquivos ignorados pelo git e nunca são copiados para código, testes ou docs.

## 1. Arquivos

| Arquivo                                                | Versionado | Conteúdo                                                  |
| ------------------------------------------------------ | ---------- | --------------------------------------------------------- |
| `BASE_DE_DADOS_CURRICULO_<NOME>.md` (raiz)             | não        | Fonte original (Markdown livre) com PII real.             |
| `fixtures-private/pilot.profile.v2.yaml`               | não        | Conversão para o contrato 2.1.0 (canônica, strict).       |
| `fixtures-private/README.md`                           | não        | Explica a conversão e as pendências.                      |
| `packages/profile-io/test/pilot-no-leak.test.ts`       | sim        | Aceitação do fixture e varredura "sem vazamento".         |

`git check-ignore -v fixtures-private/pilot.profile.v2.yaml` aponta a regra `fixtures-private/` do `.gitignore`.

## 2. Decisões de mapeamento

- **Origem e status.** Todo fato tem `meta.source = user_declared` e `meta.source_detail` com a seção da
  base de origem. `confirmed` só onde o documento afirma "confirmado"/"concluído"; o resto é
  `needs_review`. A importação rebaixa tudo para `needs_review` e guarda o status em `declared_status`.
- **Contexto de uso de competências (ADR-0007)**, conforme a seção 7 da base:
  `project_experience` (stack ligada a um projeto), `professional_experience` (suporte e MySQL no
  contexto de suporte), `coursework` (disciplinas e cursos), `self_declared_knowledge` (declarado:
  Python, FastAPI, Pandas, NumPy, Scikit-learn, SQL), `conceptual_familiarity` (LLMs, RAG,
  embeddings, bancos vetoriais) e `unverified` (listado sem contexto). Nenhum nível
  (`self_assessed_level`) foi atribuído.
- **Cargo.** O "título de suporte" preferido é `display_title`. O cargo oficial e o tipo de vínculo das
  duas experiências de suporte **não foram inventados**: ficam ausentes, com `field_states:
  needs_confirmation` e uma pendência com `safe_statement_for_now`.
- **Experiências no mesmo empregador** (aprendizagem → laboratório) viram dois registros com o mesmo
  `organization_group`, preservando as datas de cada função.
- **Projetos não são empregos.** Portfólio, desktop e web pessoais são `projects[]`; os trabalhos
  freelance viram um projeto `category: freelance` (`needs_review`, `requires_approval`), sem
  clientes, datas ou resultados.
- **Projeto colaborativo.** `team_based: true`, colaborador registrado, `personal_contribution`
  ausente com `needs_confirmation` e pendência (`reason: unclear`) com a formulação segura.
- **Formação.** Curso técnico `completed` (sem data de conclusão, com pendência); graduação
  `in_progress` com previsão de conclusão. Disciplinas ficam em `relevant_coursework`, não em experiência.
- **Idiomas e cursos.** Sem datas, cargas horárias ou certificados inventados (`field_states: not_provided`).
  O nível dos idiomas usa `languages[].self_described_level` (contrato 2.1.0), com as palavras da
  própria pessoa ("avançado", "nível médio"); `overall_level` (CEFR) fica ausente com
  `needs_confirmation`, e a equivalência CEFR **não** é inferida.
- **Telefone.** Escrito no formato de uso comum, com parênteses; o importador o normaliza para a
  forma canônica (aviso informativo `PHONE_NORMALIZED`).
- **Usage rules.** Regras de privacidade e de "não alegar" viram `usage_rules.restrictions` com
  `target.term`: `never_include` para remuneração/benefícios atuais, endereço, documentos,
  condições pessoais e motivo de saída; `require_approval` para pretensão salarial, rótulo de
  estagiário e tecnologias explicitamente não confirmadas. **Valores financeiros não foram copiados.**
- **Evidências.** Sites e repositórios públicos (`supports` + `meta.evidence_ids`) e uma
  `self_declaration` privada que sustenta os conhecimentos declarados.
- **Pendências.** 18 `pending_items` (`target`, `reason`, `safe_statement_for_now`).
  O conflito de data de início usa `reason: conflict` e `known_variants`, mas o registro fica
  `needs_review` (não `conflicting`) porque, em ADR-0011 (V3), `conflicting` bloquearia a experiência
  inteira, e só a data é incerta.

## 3. O que o contrato não representa (documentado, contrato inalterado)

Resolvidas no contrato 2.1.0 (não são mais limitações): nível de idioma textual
(`self_described_level`) e telefone com parênteses (formatos comuns aceitos e normalizados).

1. **Conflito por campo.** `meta.status` é por registro; não existe `conflicting` por campo. Para
   incerteza em um campo, `field_states: needs_confirmation` (agora também em caminhos aninhados, como
   `metric.value`) e a pendência com `target.field` cobrem; o estado `conflicting` continua sendo do registro.
2. **Restrição por registro e valor.** "Não usar o rótulo X como título nestas duas experiências" não
   cabe em `restrictions` (alvo é registro/campo/termo, não valor); virou termo global `require_approval`.
3. **Remuneração atual** não tem campo (corretamente) e foi omitida; só a regra de não uso existe.
4. **Orientações de adaptação por família de vaga** (backend, suporte, dados...) não têm estrutura;
   foram resumidas em `resume_preferences.additional_style_notes`.
5. `evidence.supports` e `meta.evidence_ids` são a mesma relação em duas direções; o contrato não
   exige consistência, então o arquivo mantém as duas à mão.

## 4. Pendências do piloto que dependem do usuário

Data de início da experiência atual (2026-05-25 × 2026-03); cargo oficial e vínculo das duas
experiências de suporte; mês/ano de conclusão do técnico; espanhol (ainda vale incluir?);
equivalência CEFR do inglês; matriz de proficiência por tecnologia; estado da migração do
portfólio; stack atual e contribuição individual no projeto colaborativo; freelances (clientes,
datas, entregas); outros projetos web; evidência de Python/FastAPI/IA; onde React foi usado;
métricas reais. Detalhe em `pending_items` do fixture.

## 5. Teste "sem vazamento" (ADR-0014)

`packages/profile-io/test/pilot-no-leak.test.ts`:

- **Fixture presente:** `loadProfile` e `importProfile` em `strict` aceitam o arquivo (sem erros, sem avisos de nível `warning` e sem chaves não mapeadas; apenas o aviso informativo `PHONE_NORMALIZED`), todo fato vira `needs_review`, a reimportação com o mapa de ids é
  idempotente e o round-trip YAML/JSON é estável. **Ausente:** esses testes aparecem como `skipped`
  com o motivo no nome.
- **Varredura:** lista os arquivos com `git ls-files --cached --others --exclude-standard` (ou
  percorre a árvore se o git faltar) e procura:
  - PII (nome, e-mail, telefone, links, colaboradores) **derivada em tempo de execução** do fixture, em
    todos os arquivos versionáveis;
  - organizações, projetos e URLs do piloto no código de produção (`apps/*/src`, `packages/*/src`,
    sem testes), como exige a ADR-0014;
  - detectores genéricos sempre ativos (e-mail fora de domínios reservados, celular/fixo brasileiros,
    perfil do LinkedIn), com tolerância a dados claramente fictícios.
  As falhas mostram arquivo, linha e categoria, nunca o valor.
- **Exceções explícitas** (`PII_EXCEPTIONS`, só caminhos exatos na raiz, com justificativa):
  `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md`, cujo Anexo A reproduz os dados de contato reais.
  Ela é alvo da decisão do usuário (redigir, manter o repositório privado ou mover o Anexo A para um
  arquivo ignorado); quando decidir, remova a entrada. Verificado à mão: sem a exceção, a varredura
  acusa o arquivo. Os demais documentos de especificação da raiz e `docs/` passaram na varredura e
  **não** são isentos. A base original (`BASE_DE_DADOS_*`) é ignorada pelo git e o teste falha se ela
  aparecer na lista de arquivos versionáveis.
- Limitação: nomes de organizações e projetos só são procurados no código de produção; em docs e
  testes eles podem aparecer (as fixtures do QA e os documentos de domínio já os citam).
