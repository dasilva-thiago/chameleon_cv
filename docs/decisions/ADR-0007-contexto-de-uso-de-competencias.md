# ADR-0007 — Contexto de uso de competências (SkillUsage)

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O plano §7.2 e o §7.4 exigem guardar o contexto junto da tecnologia e nunca perder a distinção entre experiência profissional, projeto, estudo, conhecimento declarado e familiaridade. No 1.0.0 há três vocabulários incompatíveis, nenhum imposto, e tecnologias espalhadas em 8 lugares (`docs/domain-model.md` §1.3, item 12 e tabela de vocabulário).

## Decisão
- **`Skill`:** catálogo por perfil, com `normalizedKey` único, categoria, aliases e nível autoavaliado opcional.
- **`SkillUsage`:** um fato por par (competência, contexto, fonte).
  - `usageContext` ∈ `professional_experience | project_experience | volunteer_experience | coursework | certification | self_declared_knowledge | conceptual_familiarity | unverified`. É o plano §7.4, estendido com `volunteer_experience` e `certification` para cobrir os itens 11 e 14 do Adendo.
  - Tem no máximo uma fonte tipada: `experienceId | projectId | educationId | courseId | certificationId | volunteeringId`.
  - Para projetos, guarda `facet` (frontend, backend, database, ...) e período.
- **O contexto é estrutural e verificado no banco.** CHECK SQL: `professional_experience` exige `experienceId`; `project_experience` exige `projectId`; `coursework` exige `educationId` ou `courseId`; `certification` exige `certificationId`. Ter só "estudo" nunca produz uma linha `professional_experience`.
- **Todos os lugares de tecnologia do 1.0.0 convergem para `SkillUsage` na migração.** O formulário v2 registra o uso dentro da experiência ou do projeto, e o catálogo `Skill` é deduplicado automaticamente.
- **Força de evidência no matching (ADR-0011):**
  - `professional_experience` → pode ser `direct`;
  - `project_experience`/`volunteer_experience` → `direct` se o requisito não exigir vínculo profissional, senão `transferable`;
  - `coursework`/`certification`/`self_declared_knowledge` → no máximo `partial`;
  - `conceptual_familiarity`/`unverified` → `partial` com ação `mention_carefully` ou `ask_candidate`.
- **A UI pode agrupar** competências no currículo, mas o `ResumeContent` mantém `source_fact_ids` apontando para `SkillUsage`, e o validador verifica que a seção onde a competência aparece é compatível com o contexto.

## Alternativas
- **Array `skills: string[]`:** proibido pelo plano §7.2.
- **Contexto como atributo de `Skill`** (um contexto por competência): uma mesma tecnologia tem contextos múltiplos (ex.: SQL declarado + PostgreSQL em projeto + MySQL em emprego).
- **Vocabulário do YAML 1.0.0** (`employment/project/...`): não expressa `conceptual_familiarity` nem `unverified`.

## Consequências
Os formulários precisam de uma UX boa para "onde você usou isso?". A importação de arrays de tecnologia sem fonte gera `unverified` + pendência, em vez de assumir contexto.

## Verificação
- Testes de banco: inserir `professional_experience` sem `experienceId` falha.
- Testes de migração para cada vocabulário legado.
- Caso negativo do plano §20: "vaga exige 5 anos de backend profissional; o candidato só tem projetos" → status ≠ `direct` e nenhuma conversão em anos de emprego.
