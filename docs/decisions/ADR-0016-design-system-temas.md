# ADR-0016 — Design system com tokens semânticos, marca índigo e temas claro e escuro

**Status:** Implementada · 2026-11-11

## Contexto

A web usava o Tailwind padrão, com 255 cores escritas direto nos componentes, quase preto e branco, sem tema escuro, com
poucos estados de interação (16 `hover:`, 1 `active:`, nenhuma transição) e o azul servindo ao mesmo tempo de ação e de
"informação". O produto quer um painel profissional, com cor de marca, tema escuro e a fluidez de um frontend moderno, e a
interface precisa deixar claro **o que a base da pessoa comprova** para cada vaga.

## Decisão

- **Tokens semânticos como variáveis CSS** em `apps/web/src/index.css`, expostos ao Tailwind 4 por `@theme inline`. Os
  componentes só usam tokens; um teste de arquitetura (`tests/architecture/design-tokens.test.ts`) reprova cores cruas.
- **Duas famílias de cor com papéis fixos:** índigo (`brand`) para interação e verde (`evid`) só para evidência,
  recomendação e aprovação; âmbar para atenção, vermelho para bloqueio. Informação é neutra.
- **Tema claro e escuro** com os mesmos significados, contraste WCAG conferido par a par (tabela no plano, §3.1).
  Escolha Claro/Escuro/Sistema em `localStorage`, aplicada antes da primeira pintura por `public/theme-init.js`.
- **A folha A4 e os arquivos exportados não recebem a identidade:** tokens `paper-*` fixos nos dois temas (ADR-0012).
- **Estados de interação centralizados** em `components/ui/styles.ts`; transições curtas, desligadas com movimento reduzido.
- **Fontes auto-hospedadas** (`@fontsource-variable/inter` e `@fontsource-variable/jetbrains-mono`, OFL-1.1), sem
  requisição externa.
- **Navegação em barra lateral** recolhível, busca de vagas por `Ctrl/Cmd+K`, rotas pesadas sob demanda.

## Consequências

- Mudar a marca ou ajustar um tema é editar um arquivo; telas novas herdam os dois temas se usarem tokens.
- A lista de vagas passa a receber um resumo da avaliação (`JobSummary.evaluation`) e a Base ganha a rota
  `POST /api/profile/reading` (o que o programa reconhece no texto, sem gravar nem chamar IA).
- O contraste real (axe com `color-contrast` em navegador) e as capturas nos dois temas ficam como verificação manual e no
  E2E; o jsdom não calcula cor.
- Alternativas descartadas: azul-petróleo (perto demais do verde de evidência), violeta (chamativo), manter o Tailwind padrão
  (sem tema escuro e sem coerência de significado).
