# ADR-0011 — Matching determinístico e validadores de factualidade

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O plano §13 (etapas 3, 4 e 7) e o §20 pedem:
- que regras determinísticas decidam se há evidência e qual é sua força;
- normalização com aliases (Postgres = PostgreSQL; Java ≠ JavaScript);
- validação pós-geração (ids válidos, projeto ≠ emprego, pendências não afirmadas, nada privado);
- a métrica prioritária "afirmações sem evidência = 0".

## Decisão

**Normalização** (`packages/domain/src/normalization`, `vocabulary/*.json`):
- Dicionário **multiárea** (tecnologia, saúde, educação, indústria, administração, idiomas e certificações comuns) com `canonical`, `aliases[]`, `family` (ex.: bancos relacionais) e `notEquivalentTo[]` explícito (ex.: `java` × `javascript`, `.net framework` × `.net`, `react` × `react native`).
- A correspondência é por **token inteiro** e canônico; nunca por substring.
- Os aliases declarados pelo usuário em `Skill.aliases` complementam o dicionário apenas no escopo do próprio perfil.
- O dicionário é dado versionado (`vocabularyVersion` gravado em `MatchAnalysis`) e nunca contém termos do piloto por necessidade dele.

**Matching** (`packages/domain/src/matching`, função pura sobre o snapshot):

| Situação da evidência | Status |
|---|---|
| Canônico igual em `SkillUsage`/item com contexto compatível, fato `confirmed` | `direct`, observando os limites do ADR-0007 |
| Mesma `family` (ex.: MySQL para um requisito de PostgreSQL) | `transferable` |
| Apenas `coursework`, `certification`, `self_declared_knowledge` ou `conceptual_familiarity` | `partial` |
| Só fatos `needs_review` ou `conflicting` | `needs_confirmation` |
| Nenhum fato | `missing`, sem inferir negativa |

- **Requisitos de anos de experiência:** calculados apenas sobre períodos de `professional_experience`, respeitando a precisão das datas. Períodos imprecisos geram intervalo mínimo e máximo. Projetos nunca somam anos de emprego.
- **Requisitos semânticos** (responsabilidades, comportamentais): a IA pode sugerir `factIds` candidatos. A regra confere existência, status e contexto e limita a força a `transferable`, com `decidedBy = ai_suggestion` para o usuário confirmar.
- **Cobertura** é exibida por categoria, com explicação do cálculo. Não há score único de "chance" (plano §4.4 e §8.3).

**Validadores** (`packages/domain/src/validation`; cada um devolve findings `blocked | needs_review | info` por claim):

| # | Validador |
|---|---|
| V1 | Schema `ResumeContent` (Zod) |
| V2 | Toda claim tem ≥ 1 `source_fact_ids`, e todos existem **no contexto enviado** da geração (subconjunto do snapshot) |
| V3 | Status dos fatos citados: `confirmed` ok; `needs_review` → needs_review; `conflicting` → blocked, salvo se o texto for exatamente o `safe_statement_for_now`; `archived` → blocked |
| V4 | Visibilidade e uso: `private`/`never` → blocked; `conditional`/`requires_approval` sem autorização na versão → blocked |
| V5 | Integridade de seção: a seção de experiência só aceita fatos de `Experience`/`ExperienceItem` (projeto, curso e formação → blocked); competência com contexto `self_declared`/`conceptual`/`coursework` citada como prática profissional → blocked |
| V6 | Cabeçalhos de entrada: organização, cargo e período iguais à fonte. `display_title` só se cadastrado (`displayTitle`) |
| V7 | Datas nunca mais precisas que a fonte; data em pendência aberta → usa o valor seguro |
| V8 | Termos do dicionário mencionados no texto precisam de `SkillUsage`/fato citado que os contenha (pega "Java" quando só há "JavaScript") |
| V9 | Todo número ou percentual do texto precisa aparecer nos fatos citados (pega métricas inventadas) |
| V10 | Dados proibidos: padrões de e-mail, telefone e documentos (CPF/RG/passaporte) no corpo; termos de `UsageRestriction`; valores de campos privados (busca normalizada) |
| V11 | Pendências: o texto não afirma nenhum valor listado em `known_variants` de pendências abertas |
| V12 | Estilo e extensão: repetição de palavra-chave acima do limite → info; estimativa de páginas → info |
| V13 | Inferência negativa: frases que afirmam ausência sobre a pessoa (lista por locale, ex.: "sem experiência em", "não possui", "no experience with") → blocked no currículo. No plano e na matriz, o texto padrão é "sem evidência cadastrada" (Adendo §12, "a IA não trata ausência de informação como resposta negativa") |

- **Gate de exportação:** zero `blocked`, zero `needs_review` não resolvidos (o usuário resolve editando ou marcando "conferido", ação registrada), e aprovação explícita.
- Os validadores rodam também sobre o conteúdo **editado** pelo usuário antes da aprovação. A edição manual não altera fatos.

## Alternativas
- **Matching por embeddings ou LLM decidindo a força:** não determinístico, difícil de testar e vetado como infraestrutura antecipada (Adendo §10).
- **Validação apenas por prompt:** o plano §15 afirma que o prompt não substitui a validação no backend.

## Consequências
- O dicionário multiárea exige curadoria contínua.
- Haverá falsos `missing` quando o sinônimo não estiver cadastrado. Isso é aceitável, porque um falso positivo seria pior que um falso negativo; o usuário pode adicionar aliases.

## Verificação
- Testes de unidade por validador, com casos positivos e negativos.
- Casos obrigatórios do plano §20: Java×JavaScript, Kubernetes ausente, 5 anos, injeção, data conflitante, vaga em inglês, projeto colaborativo, migração não confirmada (generalizado como "status de projeto não confirmado").
- Teste de propriedade: claims sem fonte nunca passam no gate.
- Avaliação da Fase 7 com a métrica "afirmações sem evidência = 0".
