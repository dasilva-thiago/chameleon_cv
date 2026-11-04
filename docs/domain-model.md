# Modelo de domínio e contrato do perfil profissional

**Status:** proposta do solution-architect (2026-11-04). Nada descrito aqui está implementado: o repositório não tem código.
**Precedência:** Adendo (escopo universal/multiusuário) > especificação original do plano V3 > este documento. O perfil-piloto (Anexo A / `BASE_DE_DADOS_CURRICULO_THIAGO.md`) é apenas fixture.
**Decisões relacionadas:** ADR-0003 a ADR-0008, ADR-0011 e ADR-0014 em `docs/decisions/`.

---

## 1. Auditoria do contrato 1.0.0 (estado atual dos arquivos da raiz)

### 1.1 Método

- O YAML `MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.yaml` foi validado contra `PERFIL_PROFISSIONAL_SCHEMA.json` com Ajv 2020-12 (modo `strict` para compilar o schema e `allErrors` para validar). O script ficou no scratchpad da sessão e não faz parte do repositório.
- Foram usados 21 payloads de sonda para medir o quanto o schema é permissivo.
- Foi feito um diff automático das chaves do YAML contra as `properties` do schema, seção a seção.
- A comparação manual cobriu MD, YAML, Schema e o plano V3.

### 1.2 Resultado da validação

| Verificação | Resultado |
|---|---|
| Schema compila em modo estrito (draft 2020-12) | OK |
| YAML de referência válido contra o schema | **Válido**, porém só porque o schema aceita quase tudo |
| `{schema_version:"1.0.0", profile:{}}` | Aceito (correto: perfil parcial) |
| Chave desconhecida dentro de `profile` (ex.: `typo_experinces`) | **Aceita**. O dado é perdido em silêncio se o importador mapear só as chaves conhecidas |
| `employment_type: "banana"`, `acquisition_contexts: ["banana"]`, `reading: "super"` | **Aceitos**. Os enums existem só nos comentários do YAML (34 campos) |
| `start_date: "last summer"`, `url: "not a url"`, `professional_email: "x"` | **Aceitos**. Não há formato de data, URL nem e-mail |
| `technologies_used: [{usage_context: 123}]`, `location: {anything:true}` | **Aceitos**. Objetos opacos |
| IDs duplicados (`experiences[].id` repetido) e `evidence_ids` apontando para evidência inexistente | **Aceitos** (JSON Schema não expressa integridade referencial) |
| `salary_expectation.amount: -5` | Aceito |
| `start_date: null`, `courses[].completion_date: null`, `certifications[].issue_date: null` | **Rejeitados**. Isso contradiz o cabeçalho do YAML (linha 4: "Use null ou [] quando desconhecido") |
| `schema_version: "0.9.0"` | Rejeitado por `const`. Correto para o validador canônico, mas exige uma cadeia de migração antes da validação |

### 1.3 Divergências concretas

**Schema (`PERFIL_PROFISSIONAL_SCHEMA.json`)**

1. `additionalProperties: true` em `profile` e em todos os `$defs` (linhas 39, 56, 65, 81, 86, 90, 96, 110, 134, 145, 153, 161, 165, 172, 178, 183, 189, 196, 205, 214, 217, 225, 234, 240, 246, 253, 261, 268). Apenas a raiz é fechada (linha 270).
2. Objetos opacos, sem `properties`, embora o YAML defina as chaves:
   - `experiences[].location` (l. 99);
   - `internal_deliveries[]` (l. 105);
   - `technologies_used[]` (l. 106) — **justamente onde fica o contexto de uso da tecnologia**;
   - `projects[].collaborators[]` (l. 114), `technologies[]` (l. 124) e `metrics[]` (l. 126).
3. Só 6 enums são impostos: `factStatus`, `visibility`, `level`, `pendingItem.priority/status` e `review.processing_consent` (l. 43–45, 251–252, 266). Os demais 28 conjuntos de valores documentados no YAML viraram `{"type":"string"}`.
4. Datas como `string` livre. Não há padrão `AAAA | AAAA-MM | AAAA-MM-DD`, e a anulabilidade é inconsistente: `end_date` aceita `null`, mas `start_date` (l. 101), `courses.completion_date` (l. 148) e `issue_date` (l. 175) não.
5. Sem `id` em `languages`, `awards`, `publications_research_talks`, `volunteering_and_leadership`, `freelance_and_business`, `competency_examples`, `developing_knowledge`, `contact.links` e nos subitens (`responsibilities`, `achievements`, `internal_deliveries`). Sem IDs estáveis, um bullet não consegue citar o subitem que o sustenta (Adendo §5, plano §4.6 `sourceFactIds`).
6. `$id` é um placeholder (`https://example.invalid/...`, l. 3).

**YAML (`MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.yaml`)**

7. **Defaults com aparência de fato** (violam o Adendo §4, "Não criar defaults que pareçam fatos", e o plano §7.1, "Fatos importados não se tornam automaticamente confirmados"):
   - `fact_status: "confirmed"` (l. 120, 190, 214, 250);
   - `usage_context: "professional"` (l. 112) — promove por padrão qualquer tecnologia a experiência profissional;
   - `context: "project"` (l. 164);
   - `category: "personal"` (l. 127), `status: "in_progress"` (l. 128, 199), `status: "completed"` (l. 225), `status: "valid"` (l. 284), `type: "article"` (l. 299), `status: "published"` (l. 307), `participation_type: "volunteer"` (l. 313), `type: "repository"` (l. 402);
   - `visibility: "public"` + `include_by_default: true` (l. 29–30), `interest_in_adjacent_fields: "depends"` (l. 371), `reviewed_by: "self"` (l. 433).
8. **Registros fantasma.** Cada coleção repetível traz um item-modelo preenchido com `""`. Importado literalmente, o template cria cerca de 16 registros vazios, vários com `fact_status: confirmed`. O importador precisa descartar registros sem conteúdo, e o template precisa usar `[]`/`null`.
9. Placeholders `""` em vez de `null` (ex.: `start_date: ""` na l. 75 ao lado de `end_date: null` na l. 76). Com isso, "não informado" e "texto vazio" ficam indistinguíveis.
10. Duplicidades de campo:
    - `courses[].topics` × `courses[].main_topics`;
    - `positioning.preferred_job_titles` × `career_preferences.priority_job_titles`;
    - `positioning.industries_of_interest` × `career_preferences.preferred_industries`;
    - `positioning.industries_to_avoid` × `career_preferences.excluded_industries`;
    - `positioning.primary_fields` × `career_preferences.fields_of_interest`.
11. Trabalho autônomo pode ser registrado em três lugares: `experiences[]` (`employment_type: freelance|self_employed`), `projects[]` (`category: freelance|entrepreneurial`) e `freelance_and_business[]`. Não há regra de escolha.
12. Tecnologias aparecem em ao menos 8 lugares sem entidade canônica:
    - `skills[]`;
    - `experiences[].technologies_used[]`, `responsibilities[].tools` e `internal_deliveries[].technologies`;
    - `projects[].technologies[]` e os arrays `frontend/backend/databases/...` de `projects[]`;
    - `freelance_and_business[].tools_technologies`;
    - `certifications[].related_skills`.
13. `usage_rules.*` são listas de texto livre. Não dá para aplicá-las de forma determinística, porque não apontam para registros nem campos.
14. `pending_items[]` não referencia o registro ou campo pendente (`subject` é texto livre). Assim, não é possível bloquear automaticamente a afirmação de um fato pendente.
15. `evidence_registry[].supported_claims` é texto livre, não uma lista de IDs. O vínculo evidência → registro só existe na direção `evidence_ids`.
16. `review.processing_consent` dentro do arquivo: um arquivo importado não pode valer como registro de consentimento na aplicação (ver ADR-0014).

**Markdown (`MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.md`)**

17. A regra 1.1.7 (l. 21) manda usar `Não informado`. Essa sentinela textual localizada seria gravada como valor e poderia vazar para um currículo. Deve virar ausência (`null`).
18. Campos do MD sem chave no YAML ou no Schema:
    - "Temas técnicos ou profissionais de maior familiaridade" (l. 116);
    - "Gestor ou equipe" (l. 163) e "Jornada" (l. 168);
    - "Outras evidências" (l. 262);
    - as quatro perguntas de 16.2 (l. 563–566).
19. Respostas tristate no MD que viram boolean no YAML, com perda: "Projeto público? Sim/Não/Parcial" (l. 263 → `is_public`, YAML l. 184) e "Autorizada para compartilhamento com recrutadores? Sim/Não/Com restrição" (l. 621 → `approved_for_recruiter_sharing`, YAML l. 408).
20. Outras perdas:
    - Cursos: MD pede "Data de realização" (l. 362); o YAML tem início e conclusão.
    - Idiomas: a certificação do MD tem instituição e validade (l. 436); o YAML guarda só nome e nota.
    - Projetos: o MD não oferece como ligar um projeto a uma experiência ou formação.

**Vocabulário do contexto de competência (divergência crítica, item 9 do Adendo)**

| Fonte | Valores |
|---|---|
| Plano V3 §7.4 (l. 820–825) | `professional_experience, project_experience, coursework, self_declared_knowledge, conceptual_familiarity, unverified` |
| Plano V3 §12 `ProfileFact.contexto` | os mesmos, sem `unverified` |
| YAML `skills[].acquisition_contexts` (l. 240) | `employment, project, education, course, self_study, volunteer, other` |
| YAML `technologies_used[].usage_context` (l. 112) | `professional, internal_project, study, training, other` |
| YAML `projects[].technologies[].context` (l. 164) | `"project"` (sem enum) |
| MD §8.1 (l. 386) e §4.6 (l. 231) | dois vocabulários em português, diferentes entre si |
| Schema | nenhum (string livre ou objeto opaco) |

Nenhuma fonte estruturada consegue expressar `conceptual_familiarity` nem `unverified`.

**Plano V3 (inconsistências internas e acoplamentos ao piloto)**

21. Origem dos fatos: o plano §7.1 (l. 785–789) usa `candidate_confirmed, professional_knowledge_base ("presente no Anexo A"), project_record, manual_update, imported_resume`. O Adendo §5 cita declaração, documento, repositório, certificado, importação e entrevista. Nenhum dos dois aparece no YAML ou no Schema, e `professional_knowledge_base` é específico do piloto.
22. Tipos de projeto: o plano §12 (l. 1082) inclui `collaborative`, ausente no YAML (que usa o boolean `team_based`).
23. `PendingFact` no plano §12 (l. 1108–1111): motivo `missing|conflict|stale|unclear` e status `dismissed`. O YAML usa `ignored` e não tem motivo.
24. A classificação de área do plano §8.1 (l. 841–849) é uma lista fechada de áreas de TI. Isso contraria o Adendo §8.1 item 3 (l. 245, "sem limitar a uma lista fechada de profissões"). Prevalece o Adendo.
25. Trechos com o piloto embutido no produto:
    - nomes de arquivo `Thiago_da_Silva_Curriculo_...` (l. 704–706);
    - coluna "Origem: PROATI, Gestor Seller, ..." (l. 621);
    - E2E "Verificar correspondência com eduAssets" (l. 1602);
    - conjunto de vagas de teste só de TI (l. 1502).
    Devem ser generalizados (nome do arquivo derivado do perfil; fixtures sintéticas multiárea).
26. Restrições do ambiente: o plano §9 (l. 895) pressupõe Docker e o §4.8 (l. 710) LibreOffice, e nenhum dos dois está instalado (ADR-0002, ADR-0012).
27. Documento e referências:
    - O arquivo V3 se intitula "Plano ... V2" (l. 1).
    - O Adendo aplica-se a `..._THIAGO.md` (l. 20), e o §24 (l. 1673) cita o nome antigo.
    - A numeração de fases do Adendo §10 (l. 297–371) diverge da original §19 (l. 1443–1570). A fusão está em `docs/implementation-plan.md`.
28. Dados pessoais reais (telefone e e-mail) em `BASE_DE_DADOS_CURRICULO_THIAGO.md` (l. 71–72) **e** em `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md` (l. 1751–1752). Ver ADR-0014 e os bloqueios do usuário.

### 1.4 Cobertura dos 20 itens do Adendo §4

Legenda: ✔ coberto; ◐ parcial; ✖ ausente. A coluna "Ação v2" descreve a mudança aplicada no contrato 2.x (seção 2).

| # | Item | MD | YAML | Schema | Lacuna principal | Ação v2 |
|---|---|---|---|---|---|---|
| 1 | Identificação e contatos | ✔ | ◐ | ◐ | e-mail e telefone escalares: não há "diferentes versões de contato" | `contact_points[]` repetível com visibilidade |
| 2 | Posicionamento, resumo, narrativa, objetivos | ✔ | ✔ | ✔ | — | `positioning` mantido; textos citáveis viram `statements[]` |
| 3 | Cargos, áreas, setores, senioridade de interesse | ✔ | ◐ | ◐ | duplicado entre `positioning` e `career_preferences` | fonte única em `career_preferences` |
| 4 | Experiências repetíveis | ✔ | ✔ | ◐ | `technologies_used`/`internal_deliveries` opacos; sem agrupamento de vários cargos no mesmo empregador | subitens com id; `organization_group` |
| 5 | Projetos de todos os tipos | ✔ | ✔ | ◐ | `technologies`/`metrics`/`collaborators` opacos; sem vínculo com experiência ou formação | `related_experience_id`, `related_education_id`, subitens com id |
| 6 | Formação de todos os níveis | ✔ | ✔ | ◐ | enums não impostos; datas não anuláveis | enums + `PartialDate` anulável |
| 7 | Cursos | ✔ | ◐ | ◐ | sem `fact_status`; `topics` × `main_topics` | `meta` comum; campo único `topics` |
| 8 | Competências técnicas, domínio, comportamentais | ✔ | ✔ | ◐ | `category` sem enum | enum + `other` |
| 9 | Contexto de aquisição e uso de cada competência | ◐ | ◐ | ✖ | 3 vocabulários; nenhum imposto | entidade `skill_usages[]` com `UsageContext` canônico (ADR-0007) |
| 10 | Idiomas por habilidade | ✔ | ✔ | ◐ | níveis sem enum; sem id/status | enums CEFR + `native` + `self_described_level` (2.1.0) + `meta` |
| 11 | Certificações, licenças | ✔ | ✔ | ◐ | `status`/`category` sem enum | enums + `meta` |
| 12 | Prêmios | ✔ | ✔ | ◐ | sem id | id + `meta` |
| 13 | Pesquisa, publicações, palestras | ✔ | ✔ | ◐ | sem id | id + `meta` |
| 14 | Voluntariado, liderança, extracurriculares | ✔ | ✔ | ◐ | sem id | id + `meta` |
| 15 | Autônomo, freelance, empreendedorismo | ✔ | ◐ | ◐ | três lugares possíveis | consolidado em `experiences[]` (`employment_type` + `business`); entregas pontuais em `projects[]` |
| 16 | Disponibilidade e preferências de trabalho | ✔ | ✔ | ◐ | `privacy` é string livre | sempre privado (não configurável para salário) |
| 17 | Preferências de carreira e de apresentação | ✔ | ✔ | ◐ | perguntas de 16.2 do MD sem chave | campos adicionados |
| 18 | Evidências e referências | ✔ | ◐ | ◐ | `supported_claims` em texto; referências pessoais sem estrutura | `supports[]` por id; referências pessoais fora do MVP |
| 19 | Pendentes, incertos, conflitantes | ✔ | ◐ | ◐ | sem alvo (registro/campo) nem motivo | `target`, `reason`, `dismissed` |
| 20 | Privacidade e regras de uso | ✔ | ◐ | ◐ | regras em texto livre não aplicáveis | `restrictions[]` estruturadas + filtro por termo |

Conclusão: os três arquivos cobrem **nominalmente** os 20 itens. Os itens 9, 15, 18, 19 e 20 não são aplicáveis por máquina, e o schema não valida o que promete. A versão 1.0.0 é tratada como **legado** (ADR-0004).

---

## 2. Contrato canônico 2.1.0 (`ProfileDocument`)

Versão corrente: **2.1.0** (MINOR aditivo sobre o 2.0.0 congelado na S0.2; changelog na seção 2.5). Documentos 2.0.0 continuam aceitos pelo importador (migração trivial com aviso informativo).

Fonte única: schemas Zod 4 em `packages/contracts/src/profile/v2/` (ADR-0003). Artefatos gerados e verificados por teste:

- `packages/contracts/generated/profile-document.v2.schema.json`;
- `templates/profile/MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.yaml`;
- `templates/profile/MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.md`.

Os arquivos da raiz permanecem como especificação histórica 1.0.0 e são copiados como fixture legada em `packages/contracts/fixtures/legacy/v1.0.0/`.

### 2.1 Convenções

- **Formato de intercâmbio** (YAML/JSON): `snake_case`, igual ao 1.0.0, para reduzir atrito. O **modelo de domínio/API** usa `camelCase`. O mapeamento é feito por funções puras testadas, e nunca por renomeação ad hoc.
- **Objetos fechados:** `additionalProperties: false` (Zod `.strict()`) em tudo. Chaves desconhecidas geram erro com caminho. O importador oferece o modo `lenient`, que converte o erro em aviso e preserva o valor em `unmapped` no `ImportRecord` (nada é perdido em silêncio).
- **Datas:** `PartialDate` = string `^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$`. A precisão é inferida do comprimento e nunca é aumentada pelo sistema. `end` aceita `null` (não informado) e `"present"` (atual). O antigo `is_current` vira derivado.
- **Telefone:** o importador aceita formatos comuns (`(12) 91234-5678`, `+55 12 91234-5678`, `12 91234-5678`, `(415) 555-2671`, `+351 912 345 678`, `00351 ...`) e grava a **forma canônica**: `+` opcional seguido só de dígitos (7 a 15), ex.: `12912345678`, `+5512912345678`. O contrato aceita a forma canônica e, por tolerância, as formas de entrada; letras, ramais, `+` fora do início, parênteses desbalanceados e quantidade de dígitos fora de 7..15 são rejeitados, e a mensagem de erro nunca ecoa o valor. A formatação para exibição é responsabilidade de quem renderiza.
- **Ausência:** campo omitido ou `null` = `not_provided`; `[]` = nenhum item fornecido. `""` é normalizado para `null` na importação, com aviso. Estados explícitos ficam em `meta.field_states` (2.3).
- **IDs:** todo registro citável e todo subitem citável tem `id`. No arquivo, o `id` é opcional e livre (ex.: `EXP-001`). Na importação, cada id local é mapeado para um UUID v7, e o mapa `local → uuid` fica no `ImportRecord`. Na exportação, os UUIDs são emitidos, o que permite reimportar de forma idempotente.
- **Integridade referencial** (Zod `superRefine` e validação do importador, já que o JSON Schema não expressa isso): ids únicos; `evidence_ids`, `related_*_id`, `supports[]`, `pending_items[].target.record_id` e `skill_usages[].skill_id/source` devem existir no documento.

### 2.2 Estrutura de alto nível

```text
schema_version: "2.1.0"
locale: BCP-47 (ex.: pt-BR)
profile:
  identity            # nome, nome de uso, pronomes, residência, fuso; visibilidade por campo
  contact_points[]    # e-mail/telefone/URL repetíveis; kind, subtype, value, label, visibility, include_by_default
  positioning         # profissão/cargo atual, senioridade atual, headline (sem listas de interesse)
  statements[]        # citáveis: one_sentence_intro, short_summary, full_summary, career_narrative, differentiator, value
  competency_examples[]  # STAR, citáveis; related_skill_ids
  experiences[]       # cargo/vínculo (inclui freelance/autônomo via employment_type + business)
    items[]           # kind: responsibility | achievement | delivery (citáveis)
  projects[]
    items[]           # kind: feature | contribution | deliverable | outcome | metric | business_rule | workflow | decision | test | integration
  education[]
  courses[]
  skills[]            # catálogo canônico por perfil (nome, categoria, aliases, nível autoavaliado, descrição)
  skill_usages[]      # contexto de uso: skill_id + usage_context + fonte (ADR-0007)
  languages[]         # overall/reading/writing/listening/speaking (CEFR ou native) + self_described_level (texto livre da pessoa, 2.1.0)
  certifications[]
  awards[]
  publications[]
  volunteering[]
  evidence[]          # type, title, url_or_location, evidence_date, is_public, recruiter_sharing, supports[]
  pending_items[]     # target {record_id?, field?}, reason, known_variants, safe_statement_for_now, status
  availability_preferences  # sempre privado
  career_preferences        # fonte única de cargos/áreas/setores/senioridade de interesse
  resume_preferences
  additional_professional_context
  usage_rules
    restrictions[]    # {target:{record_id?|field?|term?}, rule: never_include|require_approval|private_guidance_only, reason?}
  review              # datas de revisão; consentimento NÃO é lido daqui (ADR-0014)
```

### 2.3 Metadados de governança (`meta`) em todo registro citável

```yaml
meta:
  status: needs_review        # confirmed | needs_review | conflicting | archived
  visibility: public          # public | private | conditional
  resume_use: allowed         # allowed | requires_approval | never
  source: user_declared       # user_declared | form_entry | profile_import | resume_import | document | repository | certificate | interview | api | ai_extraction | other
  source_detail: null         # texto curto, opcional (ex.: "currículo 2024.docx, p.1")
  source_excerpt: null        # trecho de origem quando extraído (resume_import / ai_extraction)
  evidence_ids: []
  field_states: {}            # { <campo ou caminho.aninhado>: not_provided | not_applicable | not_assessed | declined | needs_confirmation }
  private_notes: null         # nunca enviado à IA nem ao documento
```

Regras do bloco `meta`:

- O bloco é opcional no arquivo. Os defaults são aplicados pelo **importador**, não pelo schema. Na importação, `status` vira `needs_review`, e o `fact_status`/`meta.status` declarado é guardado como `declared_status`. **Exceção (2.1.0, ADR-0005 emenda):** item declarado `archived` permanece `archived` e recebe `resume_use: never`; `conflicting` continua virando `needs_review` com `declared_status: conflicting`. A tela de pré-visualização oferece "Confirmar como declarado por mim" (em lote ou por item), uma ação explícita e auditada. Isso cumpre o plano §7.1 sem impor revisão linha a linha.
- `field_states` aceita o nome de um campo do registro **ou um caminho aninhado dentro dele** (`end_date`, `metric.value`, `business.portfolio_url`; até 3 níveis), validado contra os campos reais do tipo de registro, o mesmo conjunto aceito por `pending_items[].target.field` e `restrictions[].target.field`. `declined`, `not_applicable`, `not_assessed` e `not_provided` exigem o campo vazio; `needs_confirmation` convive com valor preenchido.
- Os campos `include_by_default`, `resume_usage`, `include_in_resume`, `disclosure`, `public_disclosure`, `approved_for_recruiter_sharing` e `client_names_disclosure` do 1.0.0 convergem para `visibility` + `resume_use` (migração na seção 4).
- `availability_preferences`, `career_preferences`, `usage_rules`, `identity.pronouns`, `private_notes` e o motivo de saída são **privados por construção**: não têm `visibility` configurável e nunca entram no contexto de geração (ADR-0010). Expectativa salarial só entra mediante autorização explícita por geração.

### 2.4 Enums canônicos (impostos)

| Enum | Valores |
|---|---|
| `FactStatus` | confirmed, needs_review, conflicting, archived |
| `Visibility` | public, private, conditional |
| `ResumeUse` | allowed, requires_approval, never |
| `FieldState` | not_provided, not_applicable, not_assessed, declined, needs_confirmation |
| `UsageContext` | professional_experience, project_experience, volunteer_experience, coursework, certification, self_declared_knowledge, conceptual_familiarity, unverified |
| `EmploymentType` | employee, internship, apprenticeship, contractor, freelance, self_employed, business_owner, temporary, public_service, volunteer, other |
| `ProjectCategory` | personal, academic, open_source, freelance, professional, research, volunteer, entrepreneurial, other (+ `team_based` boolean) |
| `SelfAssessedLevel` | not_assessed, exposure, basic, intermediate, advanced, expert |
| `LanguageLevel` | A1, A2, B1, B2, C1, C2, native, not_assessed (o nível descritivo "avançado", "nível médio" vai em `languages[].self_described_level`, texto livre de até 200 caracteres, **nunca promovido a CEFR automaticamente**; os dois campos podem coexistir) |
| `Seniority` | student, entry, junior, mid, senior, specialist, lead, manager, executive, not_assessed |
| `PendingReason` / `PendingStatus` | missing, conflict, stale, unclear / open, resolved, dismissed |
| `EvidenceType` | repository, certificate, portfolio, document, publication, demo, reference, self_declaration, other |
| `RecruiterSharing` | allowed, restricted, not_allowed |

`UsageContext` estende o plano §7.4 com `volunteer_experience` e `certification`. Sem eles, voluntariado e licenças profissionais (Adendo §4, itens 11 e 14) seriam forçados para `professional_experience` ou `coursework`, o que é factualmente incorreto. A extensão é aditiva e não muda a semântica dos valores originais.

### 2.5 Changelog do contrato

| Versão | Mudança | Compatibilidade |
|---|---|---|
| 2.0.0 | Contrato inicial (S0.2): objetos fechados, `meta` uniforme, `contact_points[]`, `skill_usages[]`, `statements[]`, `field_states` por campo de primeiro nível. | Substitui o 1.0.0 (legado migrável). |
| 2.1.0 | (1) Telefone: contrato aceita formas comuns; importador grava forma canônica (`+` e dígitos). (2) `languages[].self_described_level` (opcional, texto curto, nunca vira CEFR). (3) `meta.field_states` e `field_states` de blocos aceitam caminhos aninhados (`metric.value`, `business.portfolio_url`), validados contra o tipo de registro. (4) Importação: `archived` permanece `archived` com `resume_use: never` (ADR-0005). (5) Relatório: códigos `SCHEMA_VERSION_UPGRADED`, `PHONE_NORMALIZED`, `LANGUAGE_LEVEL_SELF_DESCRIBED`, `ARCHIVED_STATUS_KEPT`, `IDS_MISSING_REIMPORT_RISK`. (6) `ImportPreview.label` passa a ser seguro (tipo + posição). | MINOR aditivo: todo documento 2.0.0 válido segue válido; o importador troca só `schema_version` e avisa (info). O Zod valida apenas a versão corrente. |

Taxonomias abertas por natureza (área profissional, setor, família de vaga) **não** são enums: são texto livre com normalização opcional. Isso segue o Adendo §8.1, item 3.

---

## 3. Modelo relacional (PostgreSQL via Prisma)

### 3.1 Princípios

1. **Todo dado privado tem `ownerId`** (hoje igual a `userId`; o nome genérico permite workspaces no futuro). Toda tabela própria do usuário tem `@@unique([id, ownerId])`, e **toda FK entre tabelas próprias é composta** `(xId, ownerId) → (id, ownerId)`. Com isso, a referência cruzada entre donos é impossível no banco (ADR-0008).
2. **Tudo o que pode ser citado é linha com UUID.** JSONB guarda apenas (a) atributos descritivos não citáveis e validados por Zod, (b) documentos de preferência, (c) cópias imutáveis (snapshots) e (d) mapas esparsos (`fieldStates`).
3. **Camada `ProfileFact`** (Adendo §6.2): uma linha de governança por registro citável. A tabela tipada compartilha a PK com o fato (`Experience.id = ProfileFact.id`). Status, visibilidade, uso no currículo, origem, estados de campo e timestamps ficam em um único lugar consultável. Evidências e pendências têm FK real para o fato (ADR-0006).
4. **Histórico referencia snapshots, não linhas vivas.** `RequirementMatch`, `ResumeVersion` e `sourceFactIds` apontam para ids dentro de um `ProfileRevision.snapshot` imutável. Editar ou excluir o perfil não altera currículos aprovados (Adendo §6.3).
5. **Datas parciais:** `startDate date` + `startPrecision (year|month|day)`, com normalização para o primeiro dia do período. A coluna é ordenável e a precisão evita fabricar dia ou mês.

### 3.2 Entidades

> Nota (contrato 2.1.0): `details` abaixo é só um agrupamento lógico de colunas/JSONB do **banco**; o contrato de arquivo (seção 2) é plano e não tem esse campo. Campos novos do 2.1.0 que o mapeamento relacional precisa cobrir: `LanguageProficiency.selfDescribedLevel` (texto até 200, opcional) e `fieldStates` com chaves aninhadas (`metric.value`); o telefone de `ContactPoint.value` é armazenado na forma canônica.

Abreviações: (R) colunas relacionais; (J) JSONB validado por Zod; FK* = FK composta com `ownerId`.

**Identidade e conta**

| Entidade | Conteúdo |
|---|---|
| `User` | id, email (citext único), displayName, status, createdAt, deletedAt |
| `Credential` | userId, kind (`password`; extensível para oauth), passwordHash (argon2id), updatedAt |
| `Session` | id, tokenHash (sha256, único), userId, createdAt, expiresAt, lastSeenAt, userAgent (truncado). Sem IP em claro |
| `Invite` | email, tokenHash, expiresAt, usedAt (cadastro por convite no MVP, ADR-0009) |
| `ConsentRecord` | userId, purpose (`profile_processing`, `ai_processing`, `ai_provider:<id>`), granted, policyVersion, recordedAt |
| `AuditEvent` | ownerId, action, entityType, entityId, at, correlationId, metadata (J, sem PII) |

**Agregado de perfil** (todas as tabelas com `ownerId`)

| Entidade | Relacional (R) | JSONB (J) |
|---|---|---|
| `ProfessionalProfile` | id, ownerId, isPrimary, locale, schemaVersion, currentRevisionId?, createdAt, updatedAt | `identity` (com visibilidade por campo), `availability` (privado), `careerPreferences`, `resumePreferences`, `additionalContext`, `usageRules`, `review` |
| `ProfileFact` | id, ownerId, profileId FK*, kind (`FactKind`), status, visibility, resumeUse, source, sourceDetail, declaredStatus?, confirmedAt?, archivedAt?, createdAt, updatedAt | `fieldStates`, `sourceExcerpt?`, `privateNotes?` |
| `ContactPoint` | id, ownerId, profileId FK*, kind, subtype, value, label, visibility, includeByDefault, isPrimary, sortOrder | — |
| `ProfileStatement` (fato) | id=factId, kind, text, locale | — |
| `CompetencyExample` (fato) | id=factId, competency | `star` (situation, action, outcome_or_learning) |
| `Experience` (fato) | id=factId, organizationName, organizationPublicName?, organizationGroupKey?, officialTitle, displayTitle?, employmentType, location (city/region/country), workMode, startDate/Precision, endDate/Precision, isCurrent, sortOrder | `details` (company_context, role_objective, products_services_users, operational_scope, team_interfaces, lessons_learned, transferable_skills, business{...} para autônomo) |
| `ExperienceItem` (fato) | id=factId, experienceId FK*, kind (responsibility/achievement/delivery), text, sortOrder | `details` (frequency, autonomy, metric_name/value/baseline/period/method, personal_contribution, collaborators, steps, verification) |
| `Project` (fato) | id=factId, name, category, teamBased, status, startDate/Precision, endDate/Precision, role, publicUrl, repositoryUrl, demoUrl, docsUrl, license, relatedExperienceId? FK*, relatedEducationId? FK*, sortOrder | `details` (problem, target_audience, need_addressed, proposed_solution, architecture, personal_contribution, contributions_by_others, decision_ownership, known_limitations, next_improvements, learning, feedback, one_line/short_description) |
| `ProjectItem` (fato) | id=factId, projectId FK*, kind, text, sortOrder | `details` (para metric: name, value, method) |
| `Education` (fato) | id=factId, institution, courseName, degreeType, fieldOfStudy, status, modality, start/completion/expected (date+precision), location, qualificationAwarded, relevantCoursework text[], honors text[] | `details` (thesis, supervisor, verification_url) |
| `Course` (fato) | id=factId, name, provider, status, start/completion, workloadHours?, certificateIssued?, topics text[] | `details` |
| `Skill` (fato) | id=factId, name, normalizedKey (único por perfil), category, selfAssessedLevel, aliases text[] | `details` (description, tasks_can_perform, limitations) |
| `SkillUsage` (fato) | id=factId, skillId FK*, usageContext, experienceId?, projectId?, educationId?, courseId?, certificationId?, volunteeringId? (todas FK*), facet? (frontend/backend/database/... para projetos), period start/end, levelInContext? | `details` (tasks, usage_period_text) |
| `LanguageProficiency` (fato) | id=factId, languageCode, languageLabel, overall, reading, writing, listening, speaking, certificationId? FK* | `details` (professional_usage) |
| `Certification` (fato) | id=factId, name, issuer, category, status, issueDate/Precision, expirationDate/Precision, publicIdentifier, verificationUrl | — |
| `Award`, `Publication`, `Volunteering` (fatos) | colunas de identificação e datas | `details` |
| `Evidence` | id, ownerId, profileId FK*, type, title, urlOrLocation, evidenceDate/Precision, isPublic, recruiterSharing, uploadedFileId? FK* | `details` (notes) |
| `EvidenceLink` | evidenceId FK*, factId FK*, ownerId; PK (evidenceId, factId) | — |
| `PendingItem` | id, ownerId, profileId FK*, targetFactId? FK*, targetField?, subject, reason, currentInformation, safeStatement, confirmationMethod, priority, status, resolvedAt | `knownVariants` |
| `UsageRestriction` | id, ownerId, profileId FK*, targetFactId? FK*, targetField?, term?, rule, reason? | — |
| `ProfileRevision` | id, ownerId, profileId FK*, revisionNumber (único por perfil), schemaVersion, contentHash (sha256 de JSON canônico RFC 8785), reason (manual_save/import/pre_generation/migration), createdAt | `snapshot` (ProfileDocument v2 completo, com ids e meta). **Imutável** |
| `ImportRecord` | id, ownerId, profileId FK*, sourceFormat, sourceSchemaVersion, targetSchemaVersion, status (preview/applied/discarded), uploadedFileId?, createdAt, appliedAt | `migrationSteps`, `warnings`, `idMap`, `unmapped` |

`FactKind` = statement, competency_example, experience, experience_item, project, project_item, education, course, skill, skill_usage, language, certification, award, publication, volunteering.

**Restrições SQL** (em migração SQL manual, porque o Prisma não gera CHECK nem trigger):

- `SkillUsage`: no máximo uma fonte (`num_nonnulls(experience_id, project_id, education_id, course_id, certification_id, volunteering_id) <= 1`).
- Coerência de contexto: `usage_context = 'professional_experience'` exige `experience_id`; `project_experience` exige `project_id`; `volunteer_experience` exige `volunteering_id` ou `experience_id` com `employment_type = 'volunteer'` (este caso é validado na aplicação); `coursework` exige `education_id` ou `course_id`; `certification` exige `certification_id`.
- `ProfileFact.kind` coerente com a tabela tipada: **implementado no banco (S1.1b)** por triggers (ver "Divergências da implementação" abaixo) e coberto por teste de integração.
- Triggers `BEFORE UPDATE OR DELETE` que bloqueiam mudanças em `ProfileRevision`, em `ResumeVersion` com `status in ('approved','exported')` e em `DocumentExport`. A exceção é a exclusão em cascata da conta: a função de exclusão define `SET LOCAL chameleon.allow_purge = 'on'`. Em `ProfileRevision` (S1.1b) o trigger `ProfileRevision_immutable` está ativo; `ResumeVersion` e `DocumentExport` entram na S3.0.

**Divergências da implementação do agregado de perfil (S1.1b; migrações `profile_init`, `profile_constraints`, `utc_timezone`)**

Fonte de verdade: `packages/db/prisma/schema/profile-*.prisma`; resumo e API em `packages/db/README.md`.

| Tema | Desenho acima | Implementado |
|---|---|---|
| Nomes | `ProfileStatement`, `LanguageProficiency`, `organizationGroupKey` | `ProfileStatement`, `LanguageProficiency`, `Experience.organizationGroup`; `Language.language` → `languageLabel` |
| `details` | JSONB com campos descritivos | `details` só nas tabelas com atributos extras; chaves do contrato (snake_case); campo sem spec cai em `details` (nunca se perde). Listas de texto (`aliases`, `topics`, `relevant_coursework`, `honors`) ficam em `details`, não em `text[]` (o `String[]` do Prisma não distingue `[]` de ausente, ADR-0005) |
| `ProfileFact` | status/visibilidade/uso/origem | Os 4 campos efetivos são sempre concretos (sem `meta`: `needs_review`, `private`, `requires_approval`, `other`); `metaPresent` + `metaKeys` reproduzem o `meta` declarado; `declaredStatus`, `sourceExcerpt`, `privateNotes`, `fieldStates` (CHECK de formato, chaves aninhadas); `sortOrder`; `confirmedAt`/`archivedAt` com CHECK (`archived` ⇔ `archivedAt`) |
| `ProfessionalProfile` | `currentRevisionId?`, `positioning` ausente da lista J | Sem `currentRevisionId` (a última revisão é `max(revisionNumber)`); `positioning` e demais blocos em JSONB; `emptyCollections text[]` para `[]` explícito de coleções de topo; índice parcial: um perfil primário por dono |
| Datas | `date` + precisão | `xDate` + `xPrecision` (`year`, `month` ou `day`) e `isCurrent` (= `present`); CHECKs de par e de coerência |
| Pendências/restrições | `targetFactId?` | `targetFactId`, `targetContactPointId` ou `targetEvidenceId` (no máximo um: contato e evidência não são fatos) + `targetField`/`term` |
| Evidências | `EvidenceLink` PK (evidenceId, factId) | `EvidenceLink` com `id` + `unique(evidenceId, factId)` (regra do `@@unique([id, ownerId])`); `supportsPosition`/`evidenceIdsPosition` registram de que lado o vínculo foi declarado; `Evidence.uploadedFileId` adiado (S2.x) |
| Exemplos de competência | `star` JSONB | `situation/action/outcome_or_learning` em `details`; `related_skill_ids` → `CompetencyExampleSkill` |
| Colaboradores | — | `ProjectCollaborator` (sub-registro com id, sem `meta`) |
| `Skill` | `normalizedKey` único por perfil | `profileId` + `unique(profileId, normalizedKey)`; `normalizedKey = normalizeTerm(name)` |
| Kind × tabela | aplicação + teste | Triggers: `<Tabela>_fact_kind` (kind e perfil coerentes), `ProfileFact_typed_row` (deferido: fato sem linha tipada falha no commit), `<Tabela>_fact_orphan`, `ProfileFact_kind_immutable` |
| `ImportRecord` | `uploadedFileId?` | Sem `uploadedFileId` (S2.x); `mode`, `errors`, `summary` (contagens da aplicação) e `revisionId` (revisão criada ao aplicar) |
| Telefone | forma canônica | CHECK `^\+?[0-9]{7,15}$` + o store normaliza ao gravar |
| Fuso | — | Todas as colunas de instante são `timestamptz(3)`; sessões forçadas a UTC (`-c timezone=UTC` + `ALTER DATABASE`) por causa do adapter-pg |

**Vagas, análise, matching e currículos**

| Entidade | Relacional (R) | JSONB (J) |
|---|---|---|
| `JobPosting` | id, ownerId, title?, company?, url?, outputLocale, userNotes?, rawText (privado), rawTextHash, status, createdAt | — |
| `JobAnalysis` | id, ownerId, jobPostingId FK*, generationRunId? FK*, status (draft/reviewed), primaryFamily (texto livre), seniority?, workMode?, location?, createdAt | `result` (saída validada: incertezas, keywords, família secundária) |
| `JobRequirement` | id, ownerId, jobAnalysisId FK*, kind (requirement/responsibility), category (technical/education/language/experience/behavioral/certification/other), priority (mandatory/desirable/unclear), text, normalizedTerms text[], sourceExcerpt, sourceStart?, sourceEnd?, extractionConfidence?, userEdited, sortOrder | `constraints` (ex.: years_required, level_required) |
| `MatchAnalysis` | id, ownerId, jobAnalysisId FK*, profileRevisionId FK*, algorithmVersion, createdAt | `coverage` (por categoria, com explicação do cálculo) |
| `RequirementMatch` | id, ownerId, matchAnalysisId FK*, jobRequirementId FK*, status (direct/transferable/partial/missing/needs_confirmation), recommendedAction (highlight/mention_carefully/omit/ask_candidate), decidedBy (rule/ai_suggestion/user), explanation, userOverride | — |
| `RequirementMatchEvidence` | requirementMatchId FK*, factId (UUID **do snapshot**, sem FK para linha viva), factKind, usageContext?, strengthContribution | — |
| `AdaptationPlan` | id, ownerId, matchAnalysisId FK*, version, status (draft/user_adjusted/accepted), createdAt | `plan` (título-alvo, eixos, seções, seleção de fatos, omissões, lacunas, pendências) |
| `ResumeDocument` | id, ownerId, jobPostingId? FK*, title, locale, currentVersionId?, createdAt | — |
| `ResumeVersion` | id, ownerId, resumeDocumentId FK*, versionNumber, parentVersionId? FK*, profileRevisionId FK*, jobAnalysisId FK*, matchAnalysisId FK*, adaptationPlanId FK*, generationRunId? FK*, status (draft/reviewed/approved/exported/archived), templateId, templateVersion, promptVersion?, approvedAt?, approvedContentHash? | `generatedContent`, `editedContent` (ResumeContent), `headerSelection` (ids de ContactPoint e campos de identidade), `validationReport` |
| `GenerationRun` | id, ownerId, correlationId, idempotencyKey (único por owner), task, status, provider, model, promptId, promptVersion, inputHash, outputHash, inputTokens, outputTokens, costEstimateMicros, latencyMs, errorCode?, createdAt, finishedAt | `steps` (estado por etapa, sem conteúdo pessoal) |
| `UploadedFile` | id, ownerId, purpose (profile_import/evidence), sanitizedName, mimeType, sizeBytes, sha256, storageKey (opaco), createdAt, retentionUntil | — |
| `DocumentExport` | id, ownerId, resumeVersionId FK*, format (docx/pdf), storageKey, sha256, byteSize, pageCount?, templateVersion, rendererVersion, createdAt | `inspection` (texto extraído resumido, páginas, verificações) |

### 3.3 Snapshots e versões

- `ProfileRevision` é criado em salvamento explícito, na aplicação de uma importação e **antes de cada geração**. Se o `contentHash` atual for igual ao da última revisão, ela é reutilizada.
- O `snapshot` é o `ProfileDocument v2` completo, com ids UUID e `meta`. Validadores e matching operam sobre o snapshot, nunca sobre linhas vivas.
- Uma `ResumeVersion` aprovada é imutável. Editar depois da aprovação cria uma nova versão com `parentVersionId`.
- Exclusão: excluir um fato no perfil o **arquiva** por padrão (`status = archived`, `archivedAt`). A exclusão definitiva é uma ação explícita, e o pedido LGPD de eliminação prevalece sobre a regra "não apagar evidência usada" (plano §12). Os snapshots são apagados junto com a conta ou a pedido.

---

## 4. Migração 1.0.0 → 2.1.0 (resumo do mapeamento)

O destino é o **contrato plano real** (`packages/contracts/src/profile/v2/records.ts`): não existe campo `details`, e cada atributo é um campo tipado do registro, no próprio documento.

| 1.0.0 | 2.0.0 |
|---|---|
| `""` em qualquer campo | `null` + aviso `EMPTY_STRING_NORMALIZED` |
| item de coleção sem nenhum campo de conteúdo preenchido | descartado + aviso `EMPTY_RECORD_DROPPED` |
| `fact_status` | `meta.declared_status`; `meta.status = needs_review` |
| `contact.professional_email`, `contact.phone`, `contact.links[]` | `contact_points[]` (`visibility`/`include_by_default` preservados) |
| `positioning.preferred_job_titles`, `excluded_job_titles`, `industries_*`, `primary_fields`, `secondary_fields` | união sem duplicatas em `career_preferences.*` |
| `positioning.one_sentence_intro`, `short_summary`, `full_summary`, `career_narrative`, `demonstrable_differentiators[]`, `professional_values[]` | `statements[]` com `kind` correspondente (`career_narrative` com `visibility: private` por padrão) |
| `experiences[].responsibilities[]`, `achievements[]`, `internal_deliveries[]` | `experiences[].items[]` com `kind` (responsibility/achievement/delivery) |
| `experiences[].technologies_used[]` (+ `responsibilities[].tools`, `internal_deliveries[].technologies`) | `skills[]` (dedupe por `normalizedKey`) + `skill_usages[]` ligados à experiência. `usage_context`: professional → professional_experience; internal_project → professional_experience; study → self_declared_knowledge; training → coursework sem fonte, convertido em `unverified` com pendência (porque o treinamento não está cadastrado); other → unverified |
| `achievements[].public_disclosure` / `projects[].disclosure` / `awards[].disclosure` / `volunteering[].disclosure` | approved → `resume_use: allowed`; restricted → `requires_approval`; not_approved → `never`; not_confirmed → `requires_approval` |
| `projects[].technologies[]` e `frontend/backend/databases/apis_and_integrations/infrastructure_deployment/testing_quality/security_privacy/observability/documentation/methods_and_version_control` | `skill_usages[]` com `usage_context: project_experience` e `facet` correspondente |
| `projects[].main_features`, `deliverables`, `outcomes`, `business_rules`, `workflows`, `constraints_and_decisions`, `tests_performed`, `metrics[]` | `projects[].items[]` com `kind` |
| `projects[].collaborators[]` | `projects[].collaborators[]` (sub-registros `{name_or_role, contribution}`) |
| `projects[].known_limitations`, `next_improvements`, `learning`, `feedback` | campos planos de `projects[]` (listas de texto) |
| `education[].academic_projects[]` (nomes) | `education[].academic_projects` (lista de texto); o vínculo estruturado é `projects[].related_education_id`, que a migração não infere |
| `courses[].topics` + `main_topics` | `topics` (união) |
| `skills[].acquisition_contexts[]` + `related_*_ids` | `skill_usages[]`: employment → professional_experience (exige `related_experience_id`; sem ele → unverified + pendência); project → project_experience; education/course → coursework; self_study → self_declared_knowledge; volunteer → volunteer_experience; other → unverified |
| `skills[].resume_usage`, `languages[].include_in_resume` | include → allowed; exclude → never; depending_on_job → requires_approval |
| `developing_knowledge[]` | `skills[]` + `skill_usages[]` com `usage_context: conceptual_familiarity` (ou `self_declared_knowledge` se houver `practical_project`) e `resume_use: requires_approval`; plano de estudo em `skills[].study_plan` |
| `freelance_and_business[]` | `experiences[]` com `employment_type: freelance` (ou `self_employed`) e o objeto plano `business`; `client_names_disclosure` **não existe** no 2.x: `not_approved` → restrição `never_include` e `not_confirmed` → `require_approval` sobre `organization_name`, com aviso `CLIENT_NAMES_RESTRICTION_ADDED`; a pessoa preenche `organization_public_name` |
| `evidence_registry[]` | `evidence[]`; `approved_for_recruiter_sharing` true → allowed, false → not_allowed; `supported_claims[]` (texto) → `evidence[].notes` ("Afirmações sustentadas: ...") + vínculos pelos `evidence_ids` dos registros |
| `pending_items[].status: ignored` | `dismissed`; `reason` inferido como `unclear` (editável) |
| `usage_rules.*[]` (texto livre) | `usage_rules.restrictions[]` com `target.term` = texto e `rule` conforme a lista de origem |
| `contact.phone` | `contact_points[]` com `kind: phone`, na forma canônica (aviso `PHONE_NORMALIZED` quando a formatação muda) |
| `languages[].overall_level` em CEFR/`native` | `overall_level` (enum) |
| `languages[].overall_level` em texto livre ("advanced", "avançado", "intermediate", "nível médio") | `self_described_level` com o texto original (aviso `LANGUAGE_LEVEL_SELF_DESCRIBED`); **nenhum CEFR é inventado**; `reading`/`writing`/`listening`/`speaking` fora do enum seguem para `meta.private_notes` |
| `review.processing_consent` | ignorado para fins de consentimento; registrado como aviso `CONSENT_IN_FILE_NOT_RECORDED` |

Pendências geradas pela migração são deduplicadas (mesmo registro-alvo e mesmo motivo geram uma só pendência). A cadeia de passos (`v1_0_0_to_v2_1_0` e `v2_0_0_to_v2_1_0`) é composta de funções puras em `packages/profile-io/src/migrate/`. Cada passo devolve `{document, warnings[], steps[]}`, e os testes usam fixtures de `packages/contracts/fixtures/legacy/`.

---

## 5. Contrato do currículo gerado (`ResumeContent`)

- O cabeçalho (nome, contatos, cidade) **não** faz parte da saída da IA. Ele é montado de forma determinística a partir de `headerSelection` (ADR-0010).
- `ResumeContent = { schema_version, locale, target_role: Claim, summary: Claim[], sections: Section[] (ordenadas), review_warnings[] }`.
- `Claim = { id, text, source_fact_ids: uuid[] (mín. 1), related_requirement_ids: uuid[], review_status: supported | needs_review | blocked, findings: ValidatorFinding[] }`.
- `ExperienceEntry = { experience_fact_id, display_title, organization_display, period, bullets: Claim[] }`. `display_title` e `organization_display` são conferidos contra a fonte (ADR-0011).
- Os ids citados devem pertencer ao **contexto enviado** naquela geração, um subconjunto do snapshot.
