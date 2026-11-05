# Registro de andamento e decisões do orquestrador

> **Direção atual (2026-11-05):** ferramenta pessoal e privada — ver [`REDEFINICAO_PRODUTO_PESSOAL.md`](REDEFINICAO_PRODUTO_PESSOAL.md) e o roadmap P0–P5 em [`implementation-plan.md`](implementation-plan.md). As fatias S0–S1 abaixo são históricas e válidas como base.

Atualizado pelo orquestrador a cada fatia. Só marca como concluído o que foi executado e observado.

## Estado do ambiente (verificado em 2026-11-04)

- Repositório com remoto `origin` no GitHub, branch `main`, commits em inglês feitos pelo usuário como único autor. `.gitignore` protege `BASE_DE_DADOS_CURRICULO_THIAGO.md`, `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md` (Anexo A com PII), `fixtures-private/`, `.data/`, `.env`.
- Node 24.14, pnpm 12.16, PostgreSQL 18 (cluster do projeto em `127.0.0.1:54329` via `pnpm db:local:*`; o serviço da 5432 não é usado).
- Sem Docker, sem LibreOffice/Word: PDF via Chromium do Playwright; DOCX sem verificação visual automática (ADR-0012).

## Estado verificado na retomada (2026-11-05)

Git: `main` em 5598ab3, nenhum outro branch/worktree/stash, nenhum agente ativo; todo o trabalho da Fase 2 está **não commitado** (preservado). `pnpm typecheck` verde em todos os pacotes.

| Fatia | Estado verificado |
|---|---|
| S2.1a API de perfil | Pronta. `tests/integration/profile-api`: 4 arquivos, 92 testes verdes (reexecutados). Os 1.318 + 555 testes informados não foram reexecutados |
| S2.2 editor/importação (web) | **Concluída em P0.1** (2026-11-05): lint corrigido, rotas `/perfil/*`, `ImportPage`, `EvidencePanel`, Home, `axe-core` como devDependency, `apps/web/test/profile-ui.test.tsx`. `pnpm check`: 60 arquivos / 1.565 testes; `pnpm test:integration`: 38 arquivos / 682 testes (uma execução teve 1 falha intermitente em `packages/db/test/harness.int.test.ts`, que passou isolada e em 2 reexecuções completas) |
| S2.3a (data-model-engineer) | Pronta: Markdown em `profile-io` (parse/serialize/relatório), migrações `import_source_markdown` e `account_deletion`, `packages/db/src/account` (export + purge). Unit verdes; `account-purge`/`account-export` integração: 24 testes verdes |
| S2.3b rotas de conta / importação MD na API | Não iniciada; rotas de conta reclassificadas como fora do escopo pessoal |

Correção feita: `pilot-no-leak.test.ts` falhava porque os novos documentos de redefinição citavam o nome completo do piloto; trocado por "Thiago" (controle de PII mantido).

### Verificação final da P0 (2026-11-05)

- `pnpm check`: 60 arquivos / 1.565 testes; `pnpm test:integration`: 38 arquivos / 682 testes.
- Ciclo exportar → reimportar com preview → restaurar, com o perfil privado local (`fixtures-private/`, 266 registros; só contagens foram observadas, nenhum conteúdo foi impresso nem versionado): reimportar o próprio export é idempotente (0 criados, 0 atualizados, 266 sem mudança); apagar um registro e reimportar o export com `merge` recria exatamente 1 registro e o export seguinte fica idêntico ao original; importar o export em **outra** conta falha com `409 ID_CONFLICT` e só aplica com `regenerateConflictingIds` (a UI oferece essa opção). Verificado por um teste temporário descartado, não versionado.
- Limitações não verificadas: não há testes E2E (sem `e2e/` nem `playwright.config`); o axe roda em jsdom, sem regras de contraste; o editor não foi exercitado em navegador real com o perfil privado; uma execução isolada de `packages/db/test/harness.int.test.ts` falhou uma vez e passou nas três reexecuções (causa não investigada).

### P1 — vagas salvas (2026-11-05)

Concluída. `pnpm check`: 62 arquivos / 1.585 testes; `pnpm test:integration`: 39 arquivos / 716 testes. Novo: `JobPosting` (migração `20261105100000_job_postings`), `packages/contracts/src/api/jobs.ts`, `apps/api/src/modules/jobs`, `apps/web/src/features/jobs`, `apps/api/test/jobs.int.test.ts`, `apps/web/test/jobs-ui.test.tsx`, caso de isolamento `jobs.api/cross-owner-behaves-like-not-found`. Achado corrigido durante o teste: `contains` do Prisma não escapa `%`/`_` (busca por "%" casava tudo); a busca agora escapa os curingas. Limite da descrição: 30.000 caracteres (cabe no limite JSON padrão de 100 KiB). Limitações: sem E2E em navegador; o campo de texto do navegador normaliza quebras de linha para LF.

### P2 — análise e correspondência (2026-11-05)

Concluída com motor determinístico (sem IA). Novo: `packages/domain/src/matching`, `packages/contracts/src/api/analysis.ts`, tabela `JobAnalysis` (migração `20261105110000_job_analysis`), rotas `/api/jobs/:id/analysis`, `apps/web/src/features/jobs/AnalysisSection.tsx`, código de erro `PROFILE_REQUIRED`. Testes: unitários do matcher, fixtures sintéticas (todas as vagas × todos os perfis v2, incluindo a vaga com injeção de prompt), integração da API (cache, desatualização, revisão, consentimento, isolamento A×B) e UI com axe. Verificação com o perfil privado local: só contagens por força foram observadas (nenhum conteúdo impresso). Limitações: requisitos sem termo técnico ("boa comunicação") saem como ausentes com aviso de avaliação manual; "transferível" usa uma tabela pequena de famílias de tecnologia (heurística); a extração depende de a vaga ter seções reconhecíveis (senão avisa e usa listas/frases); nível de idioma e anos de experiência por tecnologia não são calculados (viram cautelas).

### P3 e P4 — currículos e exportação; encerramento da primeira versão funcional (2026-11-05)

Concluídos. Novo: contrato `api/resumes.ts`; `packages/domain/src/resume`; tabelas `Resume`/`ResumeVersion` (migração `20261105120000_resumes`, trigger que recusa qualquer UPDATE de versão aprovada); módulo `apps/api/src/modules/resumes` (11 rotas); `packages/documents` (DOCX/PDF); UI em `apps/web/src/features/resumes` (feita pelo agente `frontend-implementer` e revisada por inteiro); suíte E2E (`e2e/`, `playwright.config.ts`).

Resultados dos gates no estado integrado final: `pnpm check` 69 arquivos / 1.698 testes; `pnpm test:integration` 42 arquivos / 766 testes; `pnpm test:e2e` 1 cenário passando (conta por convite → importar e confirmar perfil sintético → vaga → análise → gerar currículo → editar e salvar → aviso de termo sem fonte → pré-visualizar → aprovar → baixar DOCX e PDF e conferir o conteúdo); `pnpm build` ok (a API mantém `docx` e `playwright-core` externos; antes do ajuste o bundle falhava).

Perfil privado local (fluxo completo pela API; só contagens observadas, nada impresso nem versionado): perfil de 266 registros → 3 vagas sintéticas → análise → geração → aprovação → DOCX e PDF; cada vaga gerou um currículo diferente (seções e itens variam), 0 erros e 0 avisos de proveniência, todos os itens com fonte, PDF com 2 páginas. Esse teste achou um defeito real (listas longas de competências passavam do limite de itens por entrada e a geração falhava com 500); corrigido e coberto por teste.

Verificação visual: o HTML que alimenta o PDF foi renderizado e inspecionado com dados sintéticos (uma coluna, texto selecionável, datas alinhadas). **Não verificado:** a aparência do DOCX no Word/LibreOffice (ferramentas ausentes); o PDF do perfil real não foi visto (por privacidade); a UI não foi revisada visualmente em vários tamanhos de tela (só testes de componente e axe em jsdom, sem regra de contraste); o E2E cobre um navegador (Chromium) e dados sintéticos.

Limitações conhecidas: sem IA (análise e texto são determinísticos); requisitos sem termo técnico aparecem como ausentes com aviso; "transferível" usa uma tabela pequena de famílias de tecnologia; a vaga precisa ter seções reconhecíveis (senão a análise avisa); sem fonte Arimo embarcada no PDF (quebras de linha podem variar entre máquinas); um único template; a descrição da vaga passa pelo campo de texto do navegador (quebras de linha normalizadas em LF); `pnpm test:integration` teve uma falha intermitente do clone de banco sob carga (timeout do teste ampliado).

Próximo trabalho: uso real nas candidaturas e correção dos atritos observados (P5); depois, conforme a dor real, painel inicial, backup completo, verificação do DOCX, deploy privado e IA opcional. Nada de multiusuário, SaaS ou rotas de conta (S2.3b) sem necessidade funcional comprovada.

## Decisões da redefinição pessoal (2026-11-05)

- Escopo: ferramenta privada de uso pessoal; sem SaaS, multiusuário novo, billing ou plataforma universal. `ownerId`, auth, sessões e testes de isolamento permanecem.
- `docs/implementation-plan.md` reescrito (P0–P5); plano anterior em `docs/archive/implementation-plan-v3-saas.md`.
- `ADENDO_ESCOPO_ESCALABILIDADE_PERFIS.md`, `PROMPT_EXECUCAO_AUTONOMA_CLAUDE_CODE.md` e o plano V3 marcados como supersedidos para escopo/roadmap.
- Purge/exportação de conta: código mantido (pronto e testado), sem rotas nem expansão; manutenção secundária. Nenhuma ADR nova: nenhuma decisão técnica mudou.

## Fases (histórico S0–S1)

| Fatia | Agente (modelo declarado no frontmatter) | Estado |
|---|---|---|
| Auditoria + arquitetura (ADRs 0001–0014) | solution-architect (opus, xhigh) | Concluída; docs em `docs/` |
| S0.0 git, .gitignore, .gitattributes | orquestrador | Concluída |
| S0.1 scaffold | backend-implementer (sonnet, high) | Concluída; `pnpm check` verde verificado pelo orquestrador |
| S0.2 contrato v2.0.0 | data-model-engineer (sonnet, high) | Concluída (relatório do agente: `pnpm check` verde, 559 testes); verificação independente pendente |
| S0.3 fixtures sintéticas | qa-engineer (sonnet, high) | Entregue; as 12 fixtures v2 **falharam** na validação real contra o contrato (nomes inferidos divergiam) |
| S0.3b validar/corrigir fixtures | qa-engineer | Concluída (relatório: 382 testes no pacote; 12 fixtures + 13 bordas validam contra o contrato real) |
| S0.4 piloto → v2 | data-model-engineer | Concluída (fixture privado + teste de não vazamento; relatório: 13/13 no teste) |
| S0.2b contrato 2.1.0 (telefone BR, nível de idioma descritivo, field_states aninhado, archived na importação, aviso de reimportação sem ids, preview sem valores privados) | data-model-engineer | Concluída |
| S1.1a Prisma spike + identidade + harness + forOwner | data-model-engineer | Concluída |
| **Fase 0 (gate)** | orquestrador | **Verificada pelo orquestrador em 2026-11-04: `pnpm check` exit 0 (36 arquivos, 860 testes unit/web), `pnpm test:integration` 5 arquivos / 90 testes passando, `contracts:check` OK** |
| **Fase 1 (gate de segurança)** | security-reviewer (opus, xhigh) | **PASS em 95ebca5** (reverificação direcionada): F1, F2, F3, F4, F5, F6, F8, F9, F13 FIXED; nenhum achado novo. Diferidos: F7, F10 (CI pinada por SHA), F11 (role de banco não-superusuário), F12 (e-mail de autor dos commits) |
| S1.1b agregado de perfil no banco | data-model-engineer | Concluída |
| S1.2 auth, sessões, CSRF, rate limit, DTOs | backend-implementer | Concluída |
| S1.3 shell web + login | frontend-implementer | Concluída |
| S1.4 suíte de isolamento | qa-engineer | Concluída (achou o furo de relação em forOwner, corrigido) |

Nota: o modelo efetivo de cada subagente é o declarado no frontmatter de `.claude/agents/*.md`; a execução com esse modelo não é verificável a partir daqui.

## Decisões do orquestrador

- 2026-11-04: `tests/architecture/deps-lib.ts` passa a permitir `test-fixtures -> profile-io` (somente testes; `profile-io` não pode depender de `test-fixtures`). Motivo: validar as fixtures com o importador real. Atualizado em `docs/architecture.md`.
- `@hookform/resolvers` fixado em 6.0.2 (7.0.2 bloqueada pela idade mínima de release do pnpm 12). Demais divergências em `docs/dependencies.md`.

- 2026-11-04: client Prisma gerado (`packages/db/src/generated/`) fora do git; gerado no `postinstall` da raiz.
- 2026-11-04 (S0.2b): `archived` permanece `archived` na importação (com `resume_use: never`); `conflicting` vira `needs_review` com `declared_status`. Emenda ao ADR-0005.
- Divergência de docs a resolver: `ConsentRecord.purpose` (`ai_provider:<id>` no domain-model vs `ai_processing:<provider>` no ADR-0014); o CHECK aceita ambos por ora.
- Conhecido: `prisma migrate reset` bloqueia execução por agente (exige consentimento do usuário); `pnpm db:reset` precisa ser rodado pelo usuário (`! pnpm db:reset`).
- Gap do banco documentado: `ProfileFact.kind` incoerente com a tabela tipada não é barrado pelo banco (cobrir na S1.1b com trigger/teste).

## Pendências que dependem do usuário

1. Provedor de IA real, chave, orçamento e transferência internacional de dados (bloqueia só a avaliação com IA real e o adaptador do provedor; F0–F6 usam `deterministic`/`scripted`).
2. PII real: o Anexo A de `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md` contém telefone e e-mail. O arquivo está no `.gitignore` e nunca foi commitado; decidir se será redigido de forma definitiva. Observação (gate de segurança F12): o e-mail de autor dos commits é o mesmo e-mail de contato do piloto; para commits futuros o usuário pode preferir o endereço noreply do GitHub.
3. Remoto GitHub para o CI (`ci.yml` escrito, nunca executado).
4. Revisão visual manual do DOCX (Word/Google Docs/LibreOffice).
5. Retenção, política de privacidade e textos de consentimento.
6. Confirmar pendências do piloto (data de início do PROATI, espanhol, estado da migração do portfólio).

## Condições herdadas pela Fase 2 (gate de segurança da Fase 1)

1. Toda rota que processa dados de perfil deve checar `hasGrantedConsent(req.auth.db, req.auth.ownerId, 'profile_processing')`, com teste de que consentimento ausente ou retirado é recusado.
2. O `ProfileStore` deve ficar vinculado ao dono autenticado (construído a partir de `req.auth`) ou haver regra de lint/teste garantindo que o `ownerId` venha só de `req.auth.ownerId`. Toda rota com `:param` precisa do caso cruzado A/B em `coverage.ts`.
3. Antes de qualquer deploy acessível a terceiros: contrato de proxy (`TRUST_PROXY` = nº real de hops; proxy sobrescreve X-Forwarded-For), CSP na SPA, role de banco não-superusuário.
4. S2.3: a rotina de exclusão de conta deve usar `SET LOCAL`/`set_config(..., true)` dentro da transação para a flag `chameleon.allow_purge`.
