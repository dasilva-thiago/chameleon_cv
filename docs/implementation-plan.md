# Plano de implementação — ferramenta pessoal (P0–P5)

**Fonte de verdade de escopo:** [`REDEFINICAO_PRODUTO_PESSOAL.md`](REDEFINICAO_PRODUTO_PESSOAL.md) (2026-11-05).
**Plano anterior (SaaS/universal, Fases 0–7):** arquivado em [`archive/implementation-plan-v3-saas.md`](archive/implementation-plan-v3-saas.md), somente como histórico técnico (estrutura do monorepo, scripts, ownership).
**Estado real:** [`progress.md`](progress.md).

Regras de trabalho: um fluxo coordenado por vez; subagentes só para caminhos comprovadamente disjuntos; testes direcionados por fatia e `pnpm check` + `pnpm test:integration` nos gates; commits em inglês por etapa lógica, sem coautoria, só quando autorizado.

## Base já existente (preservar)

Monorepo (`apps/api`, `apps/web`, `packages/*`), contrato de perfil v2.1.0, Prisma/PostgreSQL com `ownerId` e isolamento, autenticação/sessão/CSRF/rate limit, API de perfil (S2.1a, 26 rotas, importação com preview, exportação YAML/JSON), `profile-io` com Markdown, suíte de isolamento. Não se expande nada multiusuário; também não se remove.

## P0 — Consolidação da Fase 2 (em andamento)

| Item | Classe | Estado |
|---|---|---|
| S2.1a API de perfil + importação/exportação | essencial | feita e verificada (92 testes de `tests/integration/profile-api`) |
| S2.2 editor de perfil / importação / pendências (web) | essencial | **feita (P0.1)**: rotas `/perfil/*`, importação com preview/aplicar/descartar, painel de evidências, Home com atalhos, lint limpo, 13 testes de componente + axe |
| S2.3a relatório de importação em Markdown, parser/serializador MD (`profile-io`) | útil, quase pronta | feita; testes unit verdes |
| S2.3a purge e exportação completa de conta (`packages/db/src/account`) | fora do escopo pessoal, já pronta | mantida sem expansão; 24 testes de integração verdes; manutenção secundária |
| S2.3b rotas de conta (exportar/excluir conta) na API | fora do escopo pessoal | **não iniciar**; reavaliar só se um reset seguro for necessário |
| S2.3b rota de importação Markdown na API | útil | pequena; fazer junto da UI de importação se o fluxo precisar |
| Backup/restauração do próprio perfil pela UI | essencial | exportação YAML/JSON existe na API (`ExportCard` na UI); validar restauração via importação com preview |
| Atualização documental | essencial | feita nesta retomada |

**P0.1 (S2.2 finalização) — concluída em 2026-11-05 (sem commit):**
1. Registrar rotas `/perfil/*` em `apps/web/src/app/App.tsx` sob `RequireAuth`, com link no layout e atalho na Home.
2. Página de importação: colar/enviar YAML/JSON (e MD se a rota existir) → preview com avisos/conflitos → aplicar ou descartar; nunca sobrescrever silenciosamente.
3. Testes de componente (editor de uma seção, pendências, importação com preview, consentimento ausente) e verificação a11y (axe) das telas novas.

**Aceite P0:** Thiago mantém o perfil pela interface, importa com preview e exporta/restaura backup sem tocar no banco. `pnpm check` e `pnpm test:integration` verdes.

## P1 — Vagas salvas
CRUD de vagas (texto original, empresa/cargo/URL/local/modalidade/data opcionais, status simples), listagem com busca/filtro, detalhe, editar/arquivar/excluir. Módulo `jobs` na API, contratos, tabela com `ownerId`, UI. **Aceite:** vaga colada é salva, localizada, editada e reaberta sem perder o texto.

## P2 — Análise e correspondência
Extração de requisitos (determinística primeiro; IA apenas para semântica), matriz requisito → evidência → força → fonte → lacuna, plano de adaptação revisável, cache por hash (vaga + revisão relevante do perfil + prompt + modelo). Somente fatos selecionados vão ao provedor; sem contatos/privados; consentimento exigido. **Aceite:** a análise mostra o que é comprovado, transferível e ausente, com justificativa.

## P3 — Geração e edição de currículo
Geração por vaga com cada afirmação ligada a fatos, validadores de factualidade, editor + preview, aprovação explícita, versões imutáveis. **Aceite:** gerar, editar, salvar, fechar e reabrir sem perda de conteúdo ou proveniência.

## P4 — Exportação e histórico
DOCX e PDF (ADR-0012), histórico por vaga, duplicar/recuperar versão, backup dos dados próprios. **Aceite:** o arquivo corresponde ao documento aprovado e é reproduzível.

## P5 — Uso real
Usar em candidaturas reais; corrigir atritos; adicionar só o que resolver dificuldade real. Antes de qualquer exposição pública: proxy (`TRUST_PROXY`), CSP, role de banco não-superusuário (condições da Fase 1).

## Pendências que dependem de Thiago
Provedor/chave/orçamento de IA (bloqueia só avaliação com IA real); decisão de ambiente de execução privado; revisão visual manual do DOCX; confirmar pendências do perfil piloto; remoto GitHub/CI.
