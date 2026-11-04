# Plano de implementação — fases, fatias, ownership e critérios de aceite

**Status:** proposta do solution-architect (2026-11-04). **S0.1 (scaffold) entregue em 2026-11-04**: `pnpm check` verde, banco local e `test:integration` verificados; versões e licenças em `docs/dependencies.md`. `contracts:check` é no-op até a S0.2. Demais fatias não iniciadas.
**Base:** fusão do roadmap do Adendo §10 (prevalece) com as fases do plano original §19. As decisões estão em `docs/decisions/`, e o modelo em `docs/domain-model.md`.

---

## 1. Estrutura do monorepo (scaffold da fatia S0.1)

Criar somente o que tem responsabilidade real no momento. Os pacotes listados nascem com `package.json`, `tsconfig.json`, `src/index.ts` e 1 teste de fumaça, para fixar o lockfile cedo.

```text
chameleon_cv/
├── apps/
│   ├── api/                         # @chameleon/api — Express 5
│   │   ├── src/
│   │   │   ├── main.ts              # listen
│   │   │   ├── app.ts               # createApp(deps): testável sem rede
│   │   │   ├── config/              # env validado por Zod
│   │   │   ├── http/                # request-id, errors, auth-context, csrf, rate-limit, body-limits
│   │   │   ├── logging/             # pino + redact
│   │   │   ├── infra/storage/       # StorageProvider (local)
│   │   │   ├── cli/                 # admin:invite
│   │   │   └── modules/             # auth · account · profiles · imports · evidence · pending · files ·
│   │   │                            # jobs · matching · resumes · exports · settings
│   │   └── test/                    # *.test.ts (unit) e *.int.test.ts (API + DB)
│   └── web/                         # @chameleon/web — React 19 + Vite 8 + Tailwind 4
│       └── src/{app,routes,features/{auth,profile,imports,jobs,matching,resume-editor,history,account,settings},components,lib}
├── packages/
│   ├── contracts/                   # @chameleon/contracts — Zod 4
│   │   ├── src/{common,profile/v2,legacy/v1,api,ai,resume}
│   │   ├── scripts/generate.ts      # JSON Schemas gerados
│   │   ├── generated/               # commitados, verificados por contracts:check
│   │   ├── fixtures/legacy/v1.0.0/
│   │   └── test/
│   ├── domain/                      # @chameleon/domain — puro
│   │   └── src/{dates,normalization,vocabulary,snapshot,matching,adaptation,context,validation}
│   ├── profile-io/                  # @chameleon/profile-io — parse/serialize YAML/JSON/MD, migração, preview
│   ├── db/                          # @chameleon/db — Prisma 7 + adapter-pg
│   │   ├── prisma/schema/*.prisma   # multi-arquivo
│   │   ├── prisma/migrations/
│   │   ├── prisma.config.ts
│   │   └── src/{client.ts,scoped.ts,profile-store/,mappers/,testing/}
│   ├── ai/                          # @chameleon/ai — gateway, providers, prompts
│   ├── documents/                   # @chameleon/documents — render model, docx, html, pdf, inspect
│   │   └── templates/resume/ats-simple/v1/
│   └── test-fixtures/               # @chameleon/test-fixtures — perfis/vagas sintéticos + cenários
├── templates/profile/               # MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.{md,yaml}
├── tests/
│   ├── integration/isolation/       # suíte cruzada (QA)
│   └── evaluation/                  # avaliação de qualidade (Fase 7)
├── e2e/                             # Playwright (QA)
├── scripts/
│   ├── dev-db.mjs                   # init|start|stop|status do cluster local
│   └── iniciar-claude-code.ps1      # existente
├── fixtures-private/                # gitignored — perfil-piloto convertido
├── docs/                            # architecture, domain-model, implementation-plan, decisions/, prompts (F3), security (F7)
├── .github/workflows/ci.yml
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.js  .prettierrc.json  .prettierignore
├── vitest.config.ts                 # projects: unit · web · integration
├── playwright.config.ts             # criado na F2 com o primeiro E2E
├── .env.example  .gitignore  .gitattributes (eol=lf)  .node-version (24)
└── README.md
```

## 2. Scripts (nomes fixos)

**Raiz (`package.json`)**

| Script | Comando / efeito |
|---|---|
| `dev` | `pnpm --parallel --filter @chameleon/api --filter @chameleon/web dev` |
| `build` | `pnpm -r build` |
| `typecheck` | `pnpm -r typecheck` (`tsc --noEmit` por pacote) |
| `lint` / `lint:fix` | `eslint .` / `eslint . --fix` |
| `format` / `format:check` | `prettier --write .` / `prettier --check .`. **Agentes em paralelo não rodam `format`; formatam só os próprios caminhos** |
| `test` | `vitest run --project unit --project web` (sem DB e sem rede) |
| `test:integration` | `vitest run --project integration` (exige `TEST_DATABASE_ADMIN_URL`) |
| `test:e2e` | `playwright test` |
| `test:all` | `pnpm test && pnpm test:integration && pnpm test:e2e` |
| `contracts:generate` / `contracts:check` | `pnpm --filter @chameleon/contracts generate` / `check` (diff vazio) |
| `db:local:init` / `db:local:start` / `db:local:stop` / `db:local:status` | `node scripts/dev-db.mjs <cmd>` (ADR-0002) |
| `db:generate` | `pnpm --filter @chameleon/db exec prisma generate` |
| `db:migrate` | `pnpm --filter @chameleon/db exec prisma migrate dev` |
| `db:migrate:deploy` | `pnpm --filter @chameleon/db exec prisma migrate deploy` |
| `db:reset` | `prisma migrate reset --force`, **recusa se o host não for local** |
| `db:seed` | somente fixtures sintéticas, em contas de demonstração |
| `db:seed:pilot` | importa `fixtures-private/pilot.profile.v2.yaml` para uma conta indicada por argumento; ignorado se o arquivo não existir |
| `check` | `format:check && lint && typecheck && contracts:check && test` |

**Convenções de teste:** `*.test.ts(x)` = unit/web; `*.int.test.ts` e `tests/integration/**` = integration; `e2e/**/*.spec.ts` = Playwright.

**`.env.example`:**

```text
DATABASE_URL=postgresql://chameleon@127.0.0.1:54329/chameleon_dev
TEST_DATABASE_ADMIN_URL=postgresql://chameleon@127.0.0.1:54329/postgres
APP_ORIGIN=http://localhost:5173
API_PORT=3000
SIGNUP_MODE=invite
STORAGE_ROOT=.data/storage
UPLOAD_MAX_BYTES=2097152
AI_PROVIDER=deterministic
AI_MODEL=
AI_DAILY_TOKEN_LIMIT_PER_USER=200000
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
PDF_BROWSER=bundled
LOG_LEVEL=info
```

---

## 3. Regras de paralelismo seguro (obrigatórias)

1. **Um escritor por caminho**, conforme a tabela de ownership (§4). Mudança em caminho de outro dono = pedido ao orquestrador.
2. **Lockfile:** só o orquestrador (ou o dono da fatia S0.1) roda `pnpm add` ou `pnpm install`, **no início de cada fase**, com a lista de dependências da fase (§6). Um agente que precise de dependência extra para e pede; não instala em paralelo.
3. **Prisma:** o schema (`packages/db/prisma/**`) e as migrações têm **dono único** (data-model-engineer). As tabelas de pipeline (Fases 3–6) entram numa única migração no início da Fase 3 (S3.0), para evitar disputa de migrações.
4. **Contract-first:** os DTOs de API (`packages/contracts/src/api/**`) são publicados pelo backend **antes** de o frontend consumir. O frontend nunca edita `contracts`.
5. **Configs da raiz** (`eslint.config.js`, `tsconfig.base.json`, `vitest.config.ts`, `pnpm-workspace.yaml`, `package.json` raiz, `.github/**`): dono é o orquestrador.
6. **Git:** sem repositório, o paralelismo depende apenas da disjunção de caminhos. Recomenda-se `git init` antes da S0.1, para permitir `isolation: worktree` (um branch por fatia, com merge na ordem das dependências). Commits somente quando o usuário pedir.
7. **Congelamento do contrato v2.0.0** ao final da S0.2. Depois disso, mudança no contrato exige ADR curta, bump MINOR ou MAJOR e atualização de templates e fixtures na mesma entrega.

## 4. Ownership por agente

| Agente | Caminhos de que é dono |
|---|---|
| **Orquestrador** (solution-architect quando acionado) | raiz (configs, `README.md`, `.github/**`), `docs/**` (exceto `docs/prompts.md`) |
| **data-model-engineer** | `packages/contracts/src/{common,profile,legacy}/**`, `packages/contracts/{scripts,generated,fixtures,test}/**`, `templates/profile/**`, `packages/profile-io/**`, `packages/db/**`, `packages/domain/src/{dates,normalization,vocabulary,snapshot}/**`, `fixtures-private/**` |
| **backend-implementer** (até 2 instâncias, caminhos disjuntos) | `apps/api/**`, `packages/contracts/src/{api,ai,resume}/**`, `packages/ai/**`, `packages/domain/src/{matching,adaptation,context,validation}/**`, `packages/documents/**`, `docs/prompts.md`, `scripts/dev-db.mjs` (S0.1) |
| **frontend-implementer** | `apps/web/**` (inclui testes de componente) |
| **qa-engineer** | `packages/test-fixtures/**`, `tests/integration/isolation/**`, `tests/evaluation/**`, `e2e/**`, `playwright.config.ts` |
| **security-reviewer** / **final-architect-reviewer** | somente leitura e relatórios; as correções voltam ao dono do caminho |

---

## 5. Fases e fatias

Notação: `→` dependência; `∥` pode correr em paralelo. Cada critério de aceite cita o comando ou teste que o verifica. "A§12.n" = Adendo §12, item n. "P§21.n" = plano §21, item n.

### Fase 0 — Fundamentos do domínio (Adendo F0; plano F0/F1 parcial)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S0.0 | Orquestrador | — | `git init`, `.gitignore` (inclui `BASE_DE_DADOS_CURRICULO_THIAGO.md`, `fixtures-private/`, `.data/`, `.env`), `.gitattributes`. **Decisão do usuário sobre o Anexo A do plano** (ADR-0014) |
| S0.1 | backend-implementer | S0.0 | scaffold do §1, scripts do §2, `scripts/dev-db.mjs`, CI, teste de grafo de dependências, instalação das dependências das Fases 0–1 |
| S0.2 | data-model-engineer | S0.1 | contrato v2 (Zod), geração de JSON Schema, templates v2 (YAML + MD anotado), migração v1→v2 em `profile-io`, parse/serialize YAML/JSON, normalização (`""`→null, registros vazios), `superRefine` de integridade, `domain/dates` |
| S0.3 | qa-engineer | S0.1 (∥ S0.2) | fixtures sintéticas (§5.1) e `scenarios.ts` mapeando o Adendo §11 → fixtures; validação contra v2 assim que a S0.2 congelar |
| S0.4 | data-model-engineer | S0.2 | conversão do piloto para `fixtures-private/pilot.profile.v2.yaml`, teste "sem vazamento do piloto" (ADR-0014) |

**Critérios de aceite da Fase 0**
- [ ] `pnpm install && pnpm check` verde. `pnpm db:local:init && pnpm db:local:start && pnpm db:local:status` informa PostgreSQL 18.
- [ ] `pnpm contracts:check` sem diff. O JSON Schema gerado compila no Ajv em modo strict.
- [ ] As **21 sondas da auditoria** viram testes de regressão: enum inválido, data livre, URL e e-mail inválidos, chave desconhecida, ids duplicados e referência pendente são **rejeitados**; perfil vazio e campos `null` são **aceitos**.
- [ ] O template YAML v2, importado, gera **0 registros**. O teste de caminhos do MD anotado passa nos dois sentidos.
- [ ] O YAML 1.0.0 da raiz (cópia) migra com os avisos `EMPTY_RECORD_DROPPED`/`EMPTY_STRING_NORMALIZED`. Um 1.0.0 preenchido migra com `declared_status` preservado e `status = needs_review`.
- [ ] Cada cenário do Adendo §11 tem ≥ 1 fixture (`scenarios.test.ts`) e todas as fixtures validam (A§12.10, parcial).
- [ ] Round-trip em nível de documento (parse → normalizar → serializar → parse) é estável para todas as fixtures (A§12.4, parcial).
- [ ] Teste "sem vazamento do piloto" verde (executa se o fixture privado existir). **Aceite do Adendo F0 / A§12.1.**

### Fase 1 — Persistência, identidade e isolamento (Adendo F2, antecipada por ser transversal; prioridade 3 do prompt de execução)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S1.1a | data-model-engineer | S0.2 | **spike** de validação dos padrões Prisma (PK compartilhada + FK composta, ADR-0006); tabelas de identidade; harness de banco por worker (`packages/db/src/testing`); `forOwner()` |
| S1.1b | data-model-engineer | S1.1a | agregado de perfil (todas as tabelas de `docs/domain-model.md` §3.2, blocos "Identidade" e "Perfil"), migração SQL de CHECKs e triggers, `ProfileStore` (salvar/carregar documento, revisões com hash canônico), `domain/snapshot` |
| S1.2 | backend-implementer | S0.1 (esqueleto ∥ S1.1a); sessões → S1.1a | `createApp`, config, logs redigidos, erros, CSRF, rate limit, módulo `auth` (convite, cadastro, login, logout, sessões), CLI `admin:invite`, DTOs `contracts/src/api/auth.ts` |
| S1.3 | frontend-implementer | DTOs de auth publicados (∥ S1.2) | shell da web, roteamento, telas de login e aceite de convite, cliente de API com CSRF, testes de componente, lint de acessibilidade |
| S1.4 | qa-engineer | S1.1a + S1.2 | framework da suíte de isolamento (canários, manifesto e gate de rotas, testes de FK composta), testes de captura de log |

**Critérios de aceite da Fase 1**
- [ ] `pnpm test:integration` cria e remove os bancos por worker no cluster local.
- [ ] Testes do ADR-0009 verdes: flags de cookie, token apenas como hash, CSRF 403, login 429, resposta idêntica para e-mail inexistente.
- [ ] Toda tabela privada tem `ownerId` + `@@unique([id, ownerId])`; INSERT com FK composta cruzada falha (teste de banco).
- [ ] `forOwner` lança erro em modelo privado sem escopo. O lint reprova `@prisma/client` fora de `packages/db`.
- [ ] Gate de rotas ativo: adicionar uma rota com parâmetro de recurso sem caso cruzado faz o teste falhar (A§12.8, fundação).
- [ ] Teste de bundle: nenhum padrão de chave ou segredo no build da web (P§21.13, parcial).
- [ ] UPDATE em `ProfileRevision` falha (trigger).
- [ ] **Gate:** security-reviewer revisa auth, sessões e isolamento.

### Fase 2 — Cadastro, importação/exportação, evidências, pendências e privacidade (Adendo F1 + parte da F2)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S2.1 | backend-implementer | S1.1b, S1.2 | módulos `profiles` (CRUD por seção, status, visibilidade, uso, confirmação em lote, arquivar, revisões), `imports` (upload ou colar → preview → aplicar; `ImportRecord`), exportação YAML/JSON, `evidence`, `pending`, `files` + `LocalStorageProvider`; DTOs publicados primeiro |
| S2.2 | frontend-implementer | DTOs da S2.1 (∥ S2.1) | editor progressivo por seções, "onde você usou isso?" (SkillUsage), controles de status e visibilidade, fluxo de importação com preview e avisos, painel de pendências, vínculo de evidências |
| S2.3 | backend-implementer | S2.1 | `account`: exportação completa (zip), exclusão de conta com purge de storage, `ConsentRecord` |
| S2.4 | data-model-engineer | S0.2 (∥ S2.1) | parser do MD anotado (ADR-0013, fase 2b) em `profile-io` |
| S2.5 | qa-engineer | S2.1–S2.3 | round-trip via API e banco para todas as fixtures, E2E de cadastro parcial com perfil não-TI, casos cruzados das novas rotas, payloads malformados, limites de upload |

**Critérios de aceite da Fase 2**
- [ ] **E2E:** um usuário novo cadastra pelo formulário, parcialmente, uma trajetória não-TI (fixture `non-tech-*`) e sai com pendências visíveis (aceite do Adendo F1; A§12.3).
- [ ] Para todas as fixtures, YAML → importar → aplicar → exportar → YAML é igual ao original após a normalização documentada (A§12.4; A§12.2).
- [ ] Reimportação do YAML exportado é idempotente (0 registros novos).
- [ ] A importação cria `ImportRecord` com versão de origem e de destino e passos (A§12.5).
- [ ] Visibilidade e uso persistidos por fato; preferências sempre privadas (A§12.7, armazenamento).
- [ ] Exportação de conta contém todos os dados do dono e **nenhum canário** de outro. Após excluir a conta, 0 linhas com o `ownerId` e 0 arquivos sob o prefixo.
- [ ] Download de arquivo de outro dono → 404. Path traversal rejeitado. Upload acima do limite → 413.
- [ ] P§21.1, P§21.2 atendidos.
- [ ] **Gates:** security-reviewer (importação, arquivos, privacidade) e final-architect-reviewer (alinhamento contrato ↔ banco ↔ API ↔ UI).

### Fase 3 — Vagas, análise e camada de IA (Adendo F3; plano F2)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S3.0 | data-model-engineer | S1.1b | migração única com as tabelas de pipeline: JobPosting, JobAnalysis, JobRequirement, MatchAnalysis, RequirementMatch, RequirementMatchEvidence, AdaptationPlan, ResumeDocument, ResumeVersion, GenerationRun, DocumentExport |
| S3.1 | backend-implementer (A) | S0.1 (∥ S3.0) | `packages/ai`: gateway, provedores `deterministic` e `scripted`, prompt `job_analysis` v1, `contracts/src/ai/job-analysis.ts`, `docs/prompts.md` |
| S3.2 | data-model-engineer | S0.2 (∥ S3.1) | `domain/normalization` + `vocabulary` multiárea (ADR-0011) |
| S3.3 | backend-implementer (B) | S3.0, interface da S3.1 | módulo `jobs`: criar vaga, executar análise (GenerationRun idempotente), persistir requisitos com trecho e offsets, edição pelo usuário |
| S3.4 | frontend-implementer | DTOs da S3.3 | tela "Analisar uma vaga", revisão de requisitos (obrigatório, desejável, responsabilidade) |
| S3.5 | qa-engineer | S3.3 | vagas curta, longa, mal formatada, com injeção, em inglês e não-TI; falha de provedor (`scripted`) não corrompe a vaga; casos cruzados |

**Critérios de aceite da Fase 3** (plano F2)
- [ ] A análise devolve `null` para empresa, salário ou modalidade ausentes (teste com `scripted` e `deterministic`).
- [ ] Obrigatório, desejável e responsabilidade separados. Cada requisito com `sourceExcerpt` contido no texto original (P§21.3, P§21.4).
- [ ] Falha, timeout ou JSON inválido do provedor → `GenerationRun` com erro e vaga intacta. A mesma `idempotencyKey` não duplica a execução.
- [ ] Anúncio com "ignore as instruções..." não altera o comportamento (teste de injeção).
- [ ] Normalização: `Postgres`→`postgresql`; `Java`≠`JavaScript`; `.NET Framework`≠`.NET`; termos de saúde, educação e logística presentes no dicionário.

### Fase 4 — Matching e plano de adaptação (Adendo F4; plano F3)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S4.1 | backend-implementer (A) | S3.2 | `domain/matching` (força por contexto, anos só de experiência profissional, famílias, cobertura explicada) |
| S4.2 | backend-implementer (B) | S4.1 (interface) | `domain/adaptation` (plano por regra) + prompts `match_suggestions` e `adaptation_plan` em `packages/ai` (dono: instância A, serializado) |
| S4.3 | backend-implementer (B) | S4.1, S4.2 | módulo `matching` (criar `ProfileRevision`, matching, plano, ajustes do usuário) |
| S4.4 | frontend-implementer | DTOs da S4.3 | matriz requisito → evidência → força → fonte → ação; lacunas e pendências; editor do plano |
| S4.5 | qa-engineer | S4.3 | `test-fixtures/expected/**` com resultados esperados para vagas de ≥ 5 profissões e senioridades |

**Critérios de aceite da Fase 4** (plano F3)
- [ ] Toda linha da matriz tem evidência (fato do snapshot) ou o status `missing` explícito (P§21.5, P§21.6).
- [ ] Palavra-chave isolada não gera `direct`. Uma vaga de Java com perfil só de JavaScript dá `missing`. "5 anos de backend" com só projetos dá status ≠ `direct` e 0 anos.
- [ ] Perfil com listas vazias dá `missing`/"sem evidência cadastrada", nunca texto negativo sobre a pessoa (teste com lista de frases proibidas; A§12.9).
- [ ] O plano exibe a razão de cada inclusão e omissão (P§21.7). Resultados esperados batem para as ≥ 5 profissões (A§12.10).

### Fase 5 — Geração, validadores e revisão (Adendo F5; plano F4 + editor da F5)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S5.1 | backend-implementer (A) | S4.1 | `domain/context` (contexto mínimo e filtrado), `domain/validation` V1–V13 (ADR-0011), `contracts/src/resume` |
| S5.2 | backend-implementer (B) | S5.1, S4.3 | módulo `resumes`: geração (prompt `resume_generation`), `ResumeVersion` gerada e editada, revalidação após edição, aprovação com gate, versões imutáveis, `headerSelection`, autorização de fatos condicionais |
| S5.3 | frontend-implementer | DTOs da S5.2 | editor por seção, painel de evidências por claim, avisos, restaurar texto gerado, comparar gerado × editado, aprovar |
| S5.4 | qa-engineer | S5.2 | casos negativos do plano §20; `scripted` devolvendo claim inventada, métrica, tecnologia, dado privado, projeto como emprego → bloqueados; mesmo perfil × 2 vagas |

**Critérios de aceite da Fase 5** (plano F4)
- [ ] 0 claims sem `source_fact_ids` válidos no contexto. Uma claim sem fonte nunca passa no gate (teste de propriedade; A§12.6; P§21.9).
- [ ] Nenhum dado privado, `never` ou condicional não autorizado no conteúdo ou no contexto enviado (canários de privacidade; A§12.7).
- [ ] Data conflitante não aparece como definitiva. Projetos ficam na seção de projetos (V5/V7).
- [ ] O mesmo perfil para duas vagas distintas gera seleções e ordens diferentes, sem contradição: títulos, organizações e datas iguais à fonte (A§12.11).
- [ ] A edição manual não altera fatos do perfil. A aprovação exige zero `blocked` e zero `needs_review` não resolvidos (P§21.8, P§21.10; A§12.12).
- [ ] **Gate:** security-reviewer (prompt injection, minimização, chaves).

### Fase 6 — Exportação DOCX/PDF e histórico (Adendo F6; plano F5/F6)

| Fatia | Dono | Depende | Entregas |
|---|---|---|---|
| S6.1 | backend-implementer (A) | `contracts/src/resume` (∥ S5.2) | `packages/documents`: RenderModel, DOCX, template HTML `ats-simple/v1`, PDF via Playwright, inspeção, nome de arquivo |
| S6.2 | backend-implementer (B) | S6.1, S5.2 | módulo `exports` (gerar, armazenar, baixar com autorização, status `exported` transacional), preview HTML (`/api/resume-versions/:id/preview.html` para iframe `sandbox`), histórico (listar, duplicar, comparar, restaurar) |
| S6.3 | frontend-implementer | DTOs da S6.2 | preview fiel (iframe), downloads, tela de histórico |
| S6.4 | qa-engineer | S6.2 | inspeção dos arquivos para 3 fixtures, autorização de download, E2E completo (colar vaga → analisar → gerar → revisar → aprovar → exportar → baixar novamente do histórico) com perfil não-TI e perfil técnico sintético |

**Critérios de aceite da Fase 6** (plano F5/F6)
- [ ] O PDF tem texto extraível igual ao `RenderModel`, links presentes e ≤ 2 páginas para fixtures de tamanho normal. O DOCX tem estrutura OOXML válida, texto igual e nenhuma tabela ou imagem (P§21.11, parte automatizável).
- [ ] **Manual (bloqueio do usuário):** abrir o DOCX no Word, Google Docs ou LibreOffice e registrar a revisão visual.
- [ ] Exportação falhada não marca a versão como `exported` (P§21.12; plano §18).
- [ ] O histórico permite baixar uma versão anterior. Download de outro dono → 404.
- [ ] O nome do arquivo é derivado do perfil (sem nomes do piloto no código).

### Fase 7 — Endurecimento, avaliação e acabamento (plano F6/F7; Adendo F7 somente após uso real)

- S7.1: revisão completa do security-reviewer; correções pelos donos dos caminhos.
- S7.2: avaliação e implementação de RLS (data-model-engineer; ADR-0008, item 6).
- S7.3: job de retenção, backup e restauração testados contra o cluster local (backend + data-model).
- S7.4: auditoria de acessibilidade (axe) e responsividade (frontend + QA).
- S7.5: harness de avaliação em `tests/evaluation` (QA). Com chave real: extração, matching, claims sem fonte = 0, custo e latência por provedor.
- S7.6: README de instalação verificado em clone limpo (P§21.15).
- S7.7: final-architect-reviewer.

Ficam para depois do MVP: importação de DOCX/PDF, templates por país ou área, idiomas adicionais, carta de apresentação, workspaces.

### 5.1 Fixtures sintéticas mínimas (S0.3)

**Perfis:**
- `student-no-employment`
- `experienced-promotions-same-employer`
- `career-changer-teacher-to-data`
- `non-tech-nurse`
- `non-tech-logistics`
- `freelancer-confidential-clients`
- `no-links-no-portfolio`
- `imprecise-dates`
- `conflicting-facts`
- `private-heavy`
- `international-en-US`
- `minimal-partial`
- `legacy-1.0.0-filled`

**Vagas:**
- `backend-java` (para perfil só com JavaScript)
- `k8s-gap`
- `five-years-backend`
- `injection`
- `english-posting`
- `nurse-icu`
- `sales-b2b`
- `logistics-coordinator`
- `malformed-long`
- `very-short`

Todos os dados são fictícios. Nenhuma fixture reutiliza nomes do piloto.

---

## 6. Dependências a instalar por fase (pelo orquestrador ou S0.1)

| Fase | Pacotes |
|---|---|
| F0 | typescript@6.0.3, @types/node, eslint@9.39, typescript-eslint, eslint-plugin-jsx-a11y, eslint-plugin-react-hooks, prettier, vitest@5.1, tsx, tsup, zod@4.6, yaml@2.9, ajv@8 (dev), uuid (v7) |
| F1 | prisma@7.10.1, @prisma/client@7.10.1, @prisma/adapter-pg@7.10.1, pg, express@5.3, helmet, express-rate-limit, pino, pino-http, cookie, @node-rs/argon2, supertest (dev); react@19.3, react-dom, react-router, @tanstack/react-query, react-hook-form, @hookform/resolvers, vite@8.3, @vitejs/plugin-react, tailwindcss@4.3, @tailwindcss/vite, @testing-library/react, jsdom |
| F2 | multer@2 (ou busboy), file-type, @playwright/test@1.64.1, @axe-core/playwright |
| F3 | SDK do provedor escolhido (somente após a decisão do usuário) |
| F6 | docx@9.15, playwright-core@1.64.1, pdfjs-dist@6.5 ou unpdf@2.1, mammoth@1.13, jszip (licença MIT) |

Registrar versão e licença de cada pacote no PR ou relatório da fatia.

---

## 7. Matriz de rastreabilidade dos critérios

| Critério | Fase | Verificação |
|---|---|---|
| A§12.1 Sem dependências da carreira do piloto | F0 (+ todas) | teste "sem vazamento do piloto"; fixtures multiárea; revisão final |
| A§12.2 Repetíveis | F0/F2 | testes de contrato + round-trip no banco |
| A§12.3 Preenchimento parcial | F2 | E2E com `minimal-partial` e `non-tech-*` |
| A§12.4 YAML import/export sem perda | F0/F2 | round-trip de documento e de banco, idempotência |
| A§12.5 Versão e migração | F0/F1 | `migrate-v1.test.ts`; `schemaVersion` nos snapshots |
| A§12.6 Afirmações → registros | F5 | V2 + teste de propriedade do gate |
| A§12.7 Público/privado/condicional | F2/F5 | persistência + V4 + teste do ContextBuilder |
| A§12.8 Isolamento por usuário | F1–F6 | suíte de isolamento (canários + gate de rotas + FKs compostas) |
| A§12.9 Ausência ≠ negativa | F4/F5 | frases proibidas em plano, matriz e currículo; listas vazias → `missing` |
| A§12.10 Profissões e senioridades diferentes | F0/F4/F5 | `scenarios.ts` + expected de ≥ 5 profissões |
| A§12.11 Específico e fiel | F5 | mesmo perfil × 2 vagas |
| A§12.12 Revisar e corrigir base e currículo | F2/F5 | E2E do editor de perfil e do editor de currículo |
| P§21.1–2 Base editável, contexto e origem | F2 | testes de API + `SkillUsage` CHECK |
| P§21.3–4 Vaga e análise; obrigatório × desejável | F3 | testes de análise |
| P§21.5–7 Matriz, lacunas, plano explicável | F4 | testes de matching e plano + UI |
| P§21.8–10 Estruturado validado, referências, editar e aprovar | F5 | validadores + gate + E2E |
| P§21.11 DOCX/PDF válidos e revisados | F6 | inspeção automática + **revisão visual manual do DOCX** |
| P§21.12 Histórico | F6 | E2E de download de versão anterior |
| P§21.13 Sem segredo no frontend ou no repositório | F1/F7 | teste de bundle + varredura de padrões de chave no repositório |
| P§21.14 Fluxo normal e alucinação | F5/F7 | casos negativos do plano §20 + harness de avaliação |
| P§21.15 Documentação de instalação | F7 | instalação em clone limpo |

---

## 8. Riscos técnicos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Contrato v2 muda enquanto fixtures e UI são feitas em paralelo | congelamento ao fim da S0.2; mudanças por ADR e bump |
| R2 | Padrões Prisma (PK compartilhada + FK composta) não validados por execução | spike no início da S1.1a; fallback: coluna `factId` única + FK simples, mantendo `ownerId` composto nas relações entre agregados |
| R3 | Lacunas da extensão `forOwner` (escritas aninhadas, `$transaction`, relações) | repositórios sem escrita aninhada entre agregados; FKs compostas como rede de segurança; testes; RLS na F7 |
| R4 | Windows: caminhos com espaço (`Program Files`), CRLF em fixtures e hashes | `dev-db.mjs` com `spawn` e argumentos em array; `.gitattributes eol=lf`; hash sobre JSON canônico, não sobre o arquivo |
| R5 | Chromium em produção (tamanho, dependências) | ADR de deploy futura; fallback `channel: 'chrome'` |
| R6 | Fidelidade visual do DOCX não verificável por máquina | verificação manual registrada; LibreOffice opcional |
| R7 | Qualidade do provedor determinístico é baixa | rotulado como modo sem IA; a avaliação real depende da chave |
| R8 | Curadoria do dicionário multiárea | começar pequeno, aliases do usuário, métricas na F7 |
| R9 | Pressão de upgrade (TS 7, ESLint 10, Prisma 8) | versões fixadas; upgrade via ADR |
| R10 | Escopo do perfil v2 (~25 entidades) torna a UI longa | UI progressiva por seção; contrato completo desde a F0, UI incremental |
