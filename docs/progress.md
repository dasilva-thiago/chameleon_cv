# Registro de andamento e decisões do orquestrador

Atualizado pelo orquestrador a cada fatia. Só marca como concluído o que foi executado e observado.

## Estado do ambiente (verificado em 2026-11-04)

- Repositório com remoto `origin` no GitHub, branch `main`, commits em inglês feitos pelo usuário como único autor. `.gitignore` protege `BASE_DE_DADOS_CURRICULO_THIAGO.md`, `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md` (Anexo A com PII), `fixtures-private/`, `.data/`, `.env`.
- Node 24.14, pnpm 12.16, PostgreSQL 18 (cluster do projeto em `127.0.0.1:54329` via `pnpm db:local:*`; o serviço da 5432 não é usado).
- Sem Docker, sem LibreOffice/Word: PDF via Chromium do Playwright; DOCX sem verificação visual automática (ADR-0012).

## Fases

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
| S1.1b agregado de perfil no banco | data-model-engineer | Em andamento |
| S1.2 auth, sessões, CSRF, rate limit, DTOs | backend-implementer | Em andamento |
| S1.3 shell web + login | frontend-implementer | Aguarda DTOs da S1.2 |
| S1.4 suíte de isolamento | qa-engineer | Aguarda S1.1b e S1.2 |

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
