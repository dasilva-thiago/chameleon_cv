# Arquitetura — Chameleon CV

Monólito modular em monorepo pnpm (ADR-0001): API Express 5, SPA React 19, PostgreSQL via Prisma 7. Decisão central do
fluxo atual: [ADR-0015](decisions/ADR-0015-fluxo-career-ops-base-markdown.md).

## 1. Pacotes e dependências

```
apps/web ──> contracts
apps/api ──> contracts, domain, ai, db, documents
ai, documents ──> contracts, domain
db ──> contracts            (único que importa @prisma/*)
domain ──> contracts        (puro: sem IO)
```

Imposto por ESLint (`no-restricted-imports`) e por `tests/architecture/deps.test.ts`.

| Pacote               | Responsabilidade                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `contracts`          | Esquemas Zod das rotas: base, vagas, avaliação, currículos, IA, auth, erros                          |
| `domain`             | Leitor do CV em Markdown, montagem do currículo, checagens do career-ops, regras da avaliação, hash   |
| `ai`                 | Roteador de provedores (OpenAI-compatível, limites, pausas) e os prompts de avaliação e adaptação   |
| `db`                 | Prisma, `forOwner` (escopo por dono), exportação e exclusão de conta, harness de testes              |
| `documents`          | DOCX (`docx`), HTML e PDF (Chromium via `playwright-core`) do mesmo modelo de renderização           |

## 2. Dados

| Tabela                       | Conteúdo                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `User`, `Credential`, `Session`, `Invite`, `ConsentRecord`, `AuditEvent`, `AccountDeletion` | Identidade, sessões, convites, consentimentos, auditoria sem conteúdo |
| `ProfileBase`                | A base atual do dono: `cvMarkdown`, `profileMarkdown`, hash, revisão atual                  |
| `ProfileBaseRevision`        | Fotos imutáveis da base (trigger); currículos apontam para a revisão em que foram gerados   |
| `JobPosting`                 | Vaga: texto original e hash, metadados, situação                                            |
| `JobAnalysis`                | Avaliação (JSON `analysisResultSchema`), chave de cache (vaga, hash do texto, hash da base, versão dos prompts) |
| `Resume`, `ResumeVersion`    | Currículo por vaga e versões (`resumeContentSchema` v2); versão aprovada é imutável (trigger) |

Toda tabela privada tem `ownerId` imutável (trigger), `@@unique([id, ownerId])` e FKs compostas `(xId, ownerId)`.

## 3. Fluxo da avaliação (`POST /api/jobs/:jobId/analysis`)

1. Reaproveita a avaliação guardada se a chave de cache bate (sem chamada de IA).
2. Etapa 1 (só a vaga) → `parseExtraction` → `verifyExtraction`: citação `stated` precisa existir na vaga; `inferred` nunca
   é `critical`/`high`; salário sem citação é descartado. Reaproveitada quando só a base mudou.
3. Etapa 2 (vaga + base sem contatos) → `parseEvaluation` → `finalizeAnalysis`: evidência de `strong` precisa existir na
   base; regra que barra precisa de citação literal; ordem de exibição; recomendação pela nota.

## 4. Fluxo do currículo (`POST /api/jobs/:jobId/resumes`)

1. Avalia (ou reaproveita) a vaga.
2. Uma chamada de IA (`tailorResume`) devolve o plano: título, resumo, competências, bullets por empresa, projetos, grupos
   de habilidades. Sem resposta: currículo da base, sem adaptação.
3. `buildResume` monta o `ResumeContent` com cargo/empresa/datas/local/links da base, todas as experiências na ordem da base.
4. `validateResume` (erros: número fora da base, cargo diferente, senioridade, expressão a evitar; avisos: termo fora da base,
   ordem, empresa desconhecida) e `keywordCoverage`. Aprovar exige zero erros contra a base atual; uma versão aprovada é
   conferida contra a revisão em que foi aprovada.

## 5. IA (ADR-0010, atualizada)

Provedores OpenAI-compatíveis, um por chave no `.env`, tentados em ordem; pausa automática em limite, cota ou erro; teto
diário total e por provedor, contado na auditoria (sem conteúdo). Consentimento por provedor. Respostas lidas com
tolerância (`packages/ai/src/lenient.ts`) e sempre validadas pelo programa. Telefone e e-mail são removidos de todo prompt
(`redactContacts`); a vaga é cercada como dado.

## 6. Segurança

Sessão por cookie `__Host-` + CSRF, rate limit de login (ADR-0009); consentimento `profile_processing` exigido em toda rota
que lê a base; 404 idêntico para recurso alheio, inexistente ou malformado; suíte `tests/integration/isolation` com o gate
de rotas (toda rota com sessão precisa de um caso cruzado A × B). Exportação e exclusão de conta (ADR-0014).

## 7. Testes

`pnpm check` (unitários e de componentes), `pnpm test:integration` (Postgres local real, um banco por worker),
`pnpm test:e2e` (Playwright com provedor de IA roteirizado). Testes de integração e e2e recusam bancos que não sejam locais.
