# Arquitetura — Chameleon CV (plataforma universal de adaptação de currículos)

> **Atualização de escopo (2026-11-05):** o produto é uma ferramenta pessoal e privada (`REDEFINICAO_PRODUTO_PESSOAL.md`). Este documento descreve a arquitetura base, que permanece válida (monólito modular, `ownerId`, auth/sessão). Referências a multiusuário, tenants, convites, planos e escala são históricas e não orientam trabalho novo. Implementado até agora: scaffold, contratos, `profile-io`, banco com isolamento, auth/sessão, API de perfil (`apps/api/src/modules/profiles`), shell web e parte do editor de perfil; módulos `jobs`, `matching`, `resumes` e `exports` ainda **não existem**. Módulos `account`/purge existem apenas no pacote `db` (sem rotas). Módulo `jobs` (vagas salvas, P1) implementado em `apps/api/src/modules/jobs` e `apps/web/src/features/jobs`.

**Status:** proposta do solution-architect (2026-11-04). O repositório é greenfield: tem apenas documentação, `.claude/` e `scripts/iniciar-claude-code.ps1`. Não há código, `package.json`, git, testes nem CI. Tudo o que está abaixo é decisão de desenho, **não** implementação existente.
**Fontes:** `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md` (o Adendo prevalece), `ADENDO_ESCOPO_ESCALABILIDADE_PERFIS.md` e os três arquivos do modelo universal.
**Ver também:** `docs/domain-model.md`, `docs/implementation-plan.md` e `docs/decisions/`.

---

## 1. Restrições reais do ambiente (verificadas em 2026-11-04)

| Recurso | Estado | Consequência |
|---|---|---|
| Node 24.14.0, pnpm 12.16.1, git 2.52, Python 3.14.3 | Instalados | Stack Node/TS viável |
| PostgreSQL 18.6 (serviço na porta 5432) | Rodando, **credenciais desconhecidas** | Não será usado diretamente (ADR-0002) |
| Binários do PG18 (`initdb`, `pg_ctl`, `postgres`, `psql`) em `C:\Program Files\PostgreSQL\18\bin` | Presentes | **Verificado:** `initdb --auth=trust` cria, como usuário comum, um cluster local do projeto na porta 54329, com `CREATE DATABASE ... TEMPLATE` e `FORCE ROW LEVEL SECURITY` funcionando |
| Docker | Ausente | Não há testcontainers nem docker-compose local |
| LibreOffice, Microsoft Word, pandoc | Ausentes | Não há conversão DOCX→PDF nem renderização visual do DOCX localmente (ADR-0012) |
| Chromium do Playwright (`%LOCALAPPDATA%\ms-playwright\chromium-1248`), Chrome 157, Edge 143 | Presentes | **Verificado:** o Playwright 1.64.1 exige exatamente a revisão 1248, então o PDF via Chromium funciona offline |
| Repositório git | Inexistente | `isolation: worktree` não está disponível para subagentes até um `git init` (seção 9) |
| Versões npm consultadas | prisma 7.10.1 (a tag `latest` aponta para 8.0.0-rc.30), zod 4.6.7, express 5.3.0, react 19.3.1, vite 8.3.5, tailwindcss 4.3.4, vitest 5.1.0, @playwright/test 1.64.1, docx 9.15.2, typescript 7.0.2 (o typescript-eslint aceita apenas `<6.1.0`), eslint 10.14.0 (o eslint-plugin-jsx-a11y aceita apenas `^9`) | Versões fixadas no ADR-0001 |

---

## 2. Visão geral

**Monólito modular** em monorepo pnpm (Adendo §6.1): uma API Express 5 e uma SPA React, com a lógica de domínio em pacotes puros e testáveis. Não há microserviços, filas, RAG nem vetorização (Adendo §10, Fase 7).

```text
            ┌──────────────────────────── apps/web (React 19 + Vite + Tailwind) ────────────────────────────┐
            │ features: auth · profile editor · imports · jobs · matching matrix · resume editor · history │
            └───────────────▲──────────────────────────────────────────────────────────────────────────────┘
                            │ HTTPS JSON (DTOs de @chameleon/contracts) · cookie de sessão HttpOnly · cabeçalho CSRF
┌───────────────────────────┴────────────────── apps/api (Express 5) ─────────────────────────────────────────────┐
│ http: request-id · logs redigidos · body limits · auth-context · CSRF/Origin · rate limit · erro estruturado    │
│ modules: auth · account(privacy) · profiles · imports · evidence · files · jobs · matching · resumes · exports  │
│          cada módulo = routes → service → repository (escopado por owner)                                      │
└──────┬──────────────┬───────────────┬───────────────┬────────────────┬──────────────────┬───────────────────────┘
       │              │               │               │                │                  │
 @chameleon/db   @chameleon/domain  @chameleon/ai   @chameleon/documents  @chameleon/profile-io  StorageProvider
 Prisma 7 +      puro: normalização, gateway +       render model,        YAML/JSON/MD parse,     (local privado
 adapter-pg,     matching, validadores, provedores,  DOCX (docx),         migração v1→v2,         por owner)
 forOwner()      contexto, snapshot    prompts       HTML→PDF (Playwright) preview de importação
       │
 PostgreSQL ≥16 (local: cluster do projeto PG18 :54329 · CI: service container)
```

Todos os pacotes dependem de `@chameleon/contracts` (Zod 4, sem dependências de IO).

### 2.1 Regras de dependência (impostas por ESLint `no-restricted-imports` e por um teste de grafo)

| Pacote | Pode importar | Não pode importar |
|---|---|---|
| `contracts` | `zod` | qualquer pacote interno, IO |
| `domain` | `contracts` | `db`, `ai`, `express`, `@prisma/*`, `node:fs`, rede |
| `profile-io` | `contracts`, `domain`, `yaml` | `db`, `ai`, `express` |
| `ai` | `contracts`, `domain` (contexto), SDKs de provedores | `db`, `express` |
| `documents` | `contracts`, `domain`, `docx`, `playwright-core`, `pdfjs-dist`/`unpdf`, `mammoth` | `db`, `ai`, `express` |
| `db` | `contracts`, `@prisma/client`, `@prisma/adapter-pg`, `pg` | `ai`, `express`, `documents` |
| `apps/api` | todos acima | `@prisma/client` diretamente (somente via `@chameleon/db`) |
| `apps/web` | `contracts` | `db`, `ai`, `documents`, `domain` (mantém o bundle livre de regra de servidor) |
| `test-fixtures` | `contracts`, `profile-io` | importável **apenas** por arquivos de teste. `profile-io` nunca pode declarar `test-fixtures` como dependência (evita ciclo). Decisão da S0.3b: as fixtures são validadas pelo contrato e pelo importador reais |

---

## 3. Fluxo principal (Adendo §2: modelo → perfil → vaga → matriz → plano → currículo → revisão → DOCX/PDF)

1. **Perfil:** formulário por seções, ou importação YAML/JSON com pré-visualização (dry-run), avisos, mapa de ids e confirmação explícita. Os fatos ficam em tabelas tipadas com governança em `ProfileFact` (`docs/domain-model.md`).
2. **Vaga:** o texto colado é armazenado bruto (privado). Uma `GenerationRun(task=job_analysis)` produz uma `JobAnalysis` validada e `JobRequirement[]` com trecho e offsets de origem. O usuário pode corrigir requisitos.
3. **Revisão do perfil:** antes do matching cria-se, ou reutiliza-se pelo hash, um `ProfileRevision` imutável.
4. **Matching determinístico** (`domain/matching`): requisitos normalizados × `SkillUsage`/itens do snapshot, com força baseada no `UsageContext` e no status. A IA pode apenas **sugerir** candidatos semânticos (ex.: responsabilidades e comportamentais); a regra decide e limita a força.
5. **Plano de adaptação:** proposto por regra, opcionalmente refinado pela IA e editável pelo usuário.
6. **Geração:** o contexto mínimo é filtrado por privacidade e vai para `AIProvider.generateStructured(ResumeContent)`. Em seguida, validadores determinísticos marcam cada `Claim` como `supported`, `needs_review` ou `blocked`.
7. **Revisão humana:** editor com painel de evidência por claim. A aprovação exige zero `blocked`, zero `needs_review` não resolvidos e ação explícita.
8. **Exportação:** `ResumeVersion` aprovada → render model → DOCX (`docx`) + PDF (HTML/Chromium) → inspeção (texto extraído, páginas, links) → `DocumentExport`. O download passa por rota autorizada.

---

## 4. Camada de IA (ADR-0010)

- `AIProvider` (adaptador por fornecedor) e `AIGateway` (política comum). O domínio só conhece o gateway.

  ```ts
  interface AIProvider {
    readonly id: string;               // 'deterministic' | 'anthropic' | 'openai' | ...
    generateStructured(req: ProviderRequest): Promise<ProviderResponse>; // devolve JSON desconhecido + uso
  }
  // AIGateway.run<T>(task, input, schema: ZodType<T>): valida com Zod, faz 1 retry de reparo,
  // aplica timeout/abort, idempotência, contabiliza tokens/custo e registra GenerationRun sem conteúdo pessoal.
  ```

- **Provedores:**
  - `deterministic`: real, sem rede e rotulado na UI como "modo sem IA". Usa heurísticas de seção e o dicionário de aliases para extrair requisitos, e compõe bullets copiando o texto dos fatos.
  - `scripted`: exportado só para testes. Devolve respostas fixas por tarefa ou hash e serve para simular falhas, JSON inválido e injeção.
  - Adaptadores reais: implementados atrás de variável de ambiente, ativados **somente com chave** (bloqueio do usuário).
- **Chaves** apenas no backend (`.env` fora do git, ou gerenciador de segredos). O frontend recebe só `{provider, model, configured: boolean}`.
- **Prompts versionados** em `packages/ai/src/prompts/<task>/vN.ts` (id, versão, hash), documentados em `docs/prompts.md` (a criar na Fase 3). Há um prompt por tarefa, não um prompt monolítico (plano §19, F4).
- **Prompt injection:**
  - Vaga, perfil, arquivos e respostas da IA são **dados não confiáveis**. Entram apenas como conteúdo de usuário, serializados em JSON delimitado; nunca entram no prompt de sistema.
  - Não há ferramentas com efeito colateral.
  - A saída é sempre validada por schema e por regras.
  - A UI renderiza texto escapado (sem `dangerouslySetInnerHTML`).
- **Minimização:** nome, e-mail, telefone, links, cidade, preferências, disponibilidade, salário e notas privadas **nunca** são enviados ao provedor. O cabeçalho é montado de forma determinística. Organizações confidenciais são enviadas pelo `organizationPublicName`. Fatos `private` ou `resume_use: never` são excluídos; os `conditional` entram somente com autorização da geração corrente.

---

## 5. Segurança e isolamento (ADR-0008, ADR-0009, ADR-0014)

- **Defesa em camadas contra acesso cruzado:**
  1. `ownerId` em toda tabela privada e FKs compostas `(id, ownerId)`;
  2. `forOwner(ownerId)` em `@chameleon/db`, uma extensão do Prisma Client que injeta `ownerId` em `where` e `data` e lança erro em modelo próprio sem escopo;
  3. ESLint proíbe importar `@prisma/client` fora de `packages/db`;
  4. suíte cruzada com usuários A/B e **canários**: strings únicas do usuário B que não podem aparecer em nenhuma resposta, exportação, contexto de IA ou log do usuário A;
  5. gate de cobertura de rotas: toda rota com parâmetro de recurso precisa de caso cruzado no manifesto de testes;
  6. RLS do Postgres como endurecimento opcional na Fase 7.
- **Sessões no servidor:** token aleatório de 32 bytes, armazenado apenas como hash. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` e prefixo `__Host-` em produção. Para CSRF: cabeçalho `X-CSRF-Token` (double-submit) + verificação de `Origin`. Senha com argon2id (`@node-rs/argon2`). Rate limit por IP e por e-mail no login. Cadastro por convite no MVP.
  - **Implementado na S1.2** (detalhes e desvios em `apps/api/README.md`): rotas de negócio sob `/api` (`/health` também na raiz); fora de `https` o cookie vira `cc_session` sem `Secure` e sem prefixo, só em loopback e fora de produção (a config recusa o resto); `requireAuth` injeta `req.auth = { ownerId, db: forOwner(ownerId), ... }`; `unsafeRaw` restrito ao lookup de sessão por hash; as rotas são declaradas por `RouteRegistry` e `getRouteManifest(app)` entrega o manifesto real do Express ao gate de isolamento (S1.4); o correlation id é `req.correlationId` (não `req.id`, que o pino-http tipa diferente).
  - **Hardening S1.5b** (details in `apps/api/README.md`): (a) domain modules receive no `Db`; only the auth module gets the unrestricted handle (`AuthModuleDeps.authDb`), modules use `req.auth.db` or an injected store, and ESLint restricts `db.global`, `db.unsafeRaw` and raw SQL (`$queryRaw*`, `$executeRaw*`, `$queryRawTyped`, `$runCommandRaw`, including computed access and destructuring) to `packages/db` and `apps/api/src/auth`, proven by a lint probe test; (b) `auth: 'session'` is structural: `RouteRegistry` attaches the session guard itself and public routes never see `req.auth`; (c) invite acceptance requires `profile_processing` consent under a server-configured policy version (`PROFILE_POLICY_VERSIONS`), `ai_processing:*` cannot be asserted at signup, and `hasGrantedConsent` (latest record wins) gates Phase 2 routes; (d) production refuses `TRUST_PROXY=0` without `TRUST_PROXY_ACK_DIRECT=true`, and login adds a per-account progressive delay (ceiling, never a block) independent of the IP; (e) login does the same DB work on every path; (f) the correlation id is always generated by the server (the client `X-Request-Id` is logged separately as `clientRequestId`) and access logs record the route template, never the raw path.
  - **Profile module (S2.1a)** (`apps/api/src/modules/profiles/`, DTOs in `packages/contracts/src/api/profile.ts`, route table in `apps/api/README.md`): (a) all `/api/profile/**` routes are declared through one gated group: session guard (registry), then the `profile_processing` consent gate (latest record wins; `403 CONSENT_REQUIRED_FOR_PROFILE`), then a per-request **owner-bound scope**; handlers never receive `ProfileStore` or an `ownerId` (a source scan test enforces it); (b) edits are read-modify-write over the whole document, serialized per owner, validated by the contract (`profileDocumentSchema` integrity) and saved through `saveProfileDocument` (`keep` by default for document/section saves, `archive` over the complete document for per-record edits, `delete` only for the explicit record DELETE); (c) records are created server-side (the client never chooses ids; unknown ids are a plain `400`, so edits expose no `ID_CONFLICT` oracle); (d) import = `preview` (untrusted text, size/type/parse limits, fixed error texts, `ImportRecord` in `preview`, processed document kept in memory for 30 min because `ImportRecord` does not persist it) then explicit `apply` (`merge`, or `replace` with `confirmReplace`), with a revision of the previous state first; imported records are `needs_review` (`archived` stays `archived`, `resume_use: never`) except records the file leaves unchanged, which keep their stored governance; (e) export is the canonical v2.1.0 document and round-trips with import (re-import creates and updates nothing); (f) one A x B cross-owner case covers every route (`tests/integration/isolation`), and the log-canary sweep covers the whole flow.
- **Logs:** `pino` com `redact` (cookies, authorization, e-mail, telefone, `rawText`, `snapshot`, `content`). Corpos de requisição nunca são logados. Toda geração tem `correlationId`. Um teste captura os logs e procura canários e padrões de e-mail/telefone.
- **Arquivos:** storage local fora do webroot, com chave opaca `<ownerId>/<purpose>/<uuid>`. O caminho resolvido é verificado contra a raiz. Tamanho e MIME são validados por assinatura (`file-type`). O nome exibido é sanitizado e o download é autorizado.

---

## 6. Exportação (ADR-0012)

- `ResumeContent` aprovado → `RenderModel` (blocos ordenados, sem layout), que alimenta dois renderizadores:
  - **DOCX:** biblioteca `docx` (MIT), uma coluna, estilos nativos de título e parágrafo, links reais, fonte Arial, sem tabelas de layout nem conteúdo em cabeçalho/rodapé.
  - **PDF:** template HTML/CSS versionado (o mesmo da pré-visualização na web) → Playwright Chromium `page.pdf()`. Fonte Arimo embarcada (Apache-2.0, métrica compatível com Arial), texto selecionável e links clicáveis.
- **Inspeção automática:**
  - PDF: texto e contagem de páginas com `pdfjs-dist`/`unpdf`.
  - DOCX: texto com `mammoth` e verificação estrutural do OOXML.
  - Teste de **equivalência textual** DOCX × PDF × `RenderModel`, com sequência normalizada de textos.
  - Verificação de links e de ausência de dados proibidos.
- **Limitação:** sem Word ou LibreOffice no ambiente, a contagem de páginas e a revisão visual do DOCX não são automatizáveis. A paginação real é a do PDF, e o DOCX é estimado. A revisão visual do DOCX fica como verificação manual registrada (bloqueio do usuário) ou como conversão LibreOffice opcional, se instalada no futuro.

---

## 7. Dados e migrações

- Prisma 7.10.1 com `@prisma/adapter-pg`, schema multi-arquivo em `packages/db/prisma/schema/`, migrações em `packages/db/prisma/migrations/` (dono único: data-model-engineer). CHECKs e triggers ficam em migração SQL manual. Os detalhes estão em `docs/domain-model.md` §3.
- Versionamento duplo:
  1. migrações do **banco** (Prisma Migrate, apenas aditivas por padrão; mudanças destrutivas em duas etapas, expandir e depois contrair);
  2. versões do **documento de perfil** (`schema_version` semver, com cadeia de migração pura em `profile-io`). Os snapshots guardam `schemaVersion` e são migrados na leitura quando antigos.

---

## 8. Ambiente de desenvolvimento e testes (ADR-0002)

- **Banco local sem credenciais:** `pnpm db:local:init` executa `initdb` dos binários instalados (o caminho é detectado via `PG_BIN`, `PATH` ou `C:\Program Files\PostgreSQL\<v>\bin`) em `.data/pg`, com auth `trust` restrito a `127.0.0.1:54329`. `db:local:start/stop/status` usam `pg_ctl`. `DATABASE_URL` é configurável, e qualquer PostgreSQL ≥ 16 serve.
- **Testes de integração:**
  1. o `globalSetup` cria um banco-template migrado (`prisma migrate deploy`);
  2. cada worker do Vitest clona seu próprio banco (`CREATE DATABASE ... TEMPLATE`);
  3. o `teardown` remove esses bancos.
  O isolamento multiusuário é testado em Postgres real, localmente e no CI.
- **CI** (`.github/workflows/ci.yml`, a criar): Ubuntu com `services: postgres:18`, `pnpm check`, `pnpm test:integration` e `pnpm test:e2e` (Chromium). Só roda depois que existir um remoto GitHub (bloqueio do usuário).
- **Docker** fica opcional para deploy futuro; não é exigido em desenvolvimento.

---

## 9. Pré-requisitos de processo

1. `git init` + `.gitignore` **antes** de qualquer código. Devem ser ignorados: `.data/`, `.env*` (exceto `.env.example`), `node_modules/`, `fixtures-private/` e `BASE_DE_DADOS_CURRICULO_THIAGO.md`. O plano V3 contém o Anexo A com telefone e e-mail reais: a decisão de redigir ou manter fora de repositório público é do usuário (ADR-0014).
2. O git habilita `isolation: worktree` para agentes paralelos. Sem git, o paralelismo depende só da divisão de arquivos em `docs/implementation-plan.md`.
3. Commits somente quando o usuário pedir.

---

## 10. Observabilidade e confiabilidade

- `GenerationRun` persiste o estado por etapa, permitindo retomar ou diagnosticar.
- `idempotencyKey` por clique evita duplicatas em retry (plano §18).
- Timeout e limite de tentativas por chamada de IA, com erros do provedor mapeados para códigos acionáveis.
- Um currículo nunca fica "aprovado" se a validação ou a exportação falhar: a aprovação e a exportação são transacionais em relação ao status.
- A versão do template, do prompt e do renderizador fica registrada em cada `ResumeVersion` e `DocumentExport`.
