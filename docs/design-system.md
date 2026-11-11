# Design system — Chameleon CV

Referência curta para quem escreve telas em `apps/web`. O porquê de cada escolha está em
[PLANO_IDENTIDADE_VISUAL.md](PLANO_IDENTIDADE_VISUAL.md) e na [ADR-0016](decisions/ADR-0016-design-system-temas.md).

## Regras

1. **Só tokens.** Nenhuma cor do Tailwind (`slate-*`, `blue-*`…) nem hex nos componentes. O teste
   `tests/architecture/design-tokens.test.ts` reprova o build. Os valores vivem em `apps/web/src/index.css`.
2. **Índigo (`brand`) é interação** — botão principal, link, foco, item selecionado, navegação ativa.
3. **Verde (`evid`) é evidência** — comprovado na base, recomendado, aprovado. Nunca em botão nem enfeite.
4. **Âmbar (`attn`) pede atenção; vermelho (`risk`) bloqueia ou destrói.** Informação é neutra (`sunken` + ícone).
5. **Uma ação `primary` por área.** As outras são `secondary` ou `ghost`.
6. **Nunca só cor:** todo estado tem texto, ícone ou forma.
7. **Use os componentes de `components/ui`.** Falta uma variante? Crie no componente, não na tela.

## Tokens

| Grupo | Tokens (classe = `bg-*`, `text-*`, `border-*`…) |
|---|---|
| Superfícies | `canvas` (página), `surface` (painéis, campos), `sunken` (blocos internos, hover), `raised` (menus, diálogos), `scrim` (fundo de modal) |
| Linhas | `line` (divisórias), `line-strong` (borda de controles) |
| Texto | `ink-1` (principal), `ink-2` (secundário), `ink-3` (metadados) |
| Marca | `brand`, `brand-hover`, `brand-active`, `brand-soft` (fundo de selecionado), `brand-text` (texto sobre soft), `on-brand` |
| Evidência | `evid`, `evid-partial`, `evid-soft`, `evid-text` |
| Atenção | `attn`, `attn-soft`, `attn-text` |
| Risco | `risk`, `risk-hover`, `risk-soft`, `risk-text`, `on-risk` |
| Papel A4 | `paper`, `paper-ink`, `paper-muted`, `paper-line`, `paper-chip` — iguais nos dois temas (é o arquivo exportado) |

Tipografia: `text-score` (nota), `text-title` (h1), `text-section` (h2), `text-item`, `text-body`, `text-meta`,
`text-overline`. Fontes `font-sans` (Inter) e `font-mono` (JetBrains Mono: nota, números, versões, editores Markdown).
Raios `rounded-control` (6px) e `rounded-panel` (10px). Sombras `shadow-xs`, `shadow-md`, `shadow-lg` (no escuro o nível
vem da superfície).

## Tema

- `data-theme="light" | "dark"` no `<html>`; `public/theme-init.js` aplica antes da primeira pintura (sem piscar).
- `lib/theme.ts`: `useTheme()`, `setThemeChoice('light' | 'dark' | 'system')`, `cycleTheme()`. Escolha salva em
  `localStorage` (`chameleon.theme`); "Sistema" segue `prefers-color-scheme` e acompanha mudanças.
- Seletor: `ThemeToggle` (barra lateral, login, Conta). Atalho `Ctrl/Cmd+Shift+L`.
- Variante `dark:` existe para exceções raras; prefira um token.

## Estados de interação

As receitas ficam em `components/ui/styles.ts` (`buttonClasses`, `linkClass`, `fieldClass`, `focusRing`,
`focusRingInset`, `transition`). Todo controle tem: repouso, hover, pressionado (`active:`), foco por teclado
(`focus-visible:`, anel `brand` 2px + 2px), desabilitado (50%, sem hover), carregando (`Button loading`: spinner,
`aria-busy`, mesma largura) e selecionado (`brand-soft` + `brand-text`, ou `aria-pressed`/`aria-current`).
Transições de 150 ms só em cor, fundo, borda, sombra e opacidade; tudo desligado com `prefers-reduced-motion`.
Em ponteiro grosso (`pointer-coarse:`) os controles crescem para 40-44px.

## Componentes (`components/ui`)

| Componente | Para quê |
|---|---|
| `Button`, `LinkButton`, `ExternalLinkButton`, `IconButton` | Ações e navegação com cara de botão (`primary`/`secondary`/`ghost`/`danger`, `sm`/`md`, `loading`, `icon`) |
| `Badge` | Selo: `good` (comprovado), `warn`, `bad`, `info` (destaque de marca), `neutral` (situação sem juízo) |
| `Score`, `RecommendationBadge`, `EvidenceRail` (`Evaluation.tsx`) | Nota 1-5, recomendação e Trilho de evidência (`mini`/`full`) |
| `FlowSteps` | Linha do fluxo Base → Vaga → Avaliação → Currículo → Aprovado |
| `Alert` | `error`, `attention`, `success`, `info` (neutro) |
| `Toast` (`useToast`) | Avisos não bloqueantes (4 s; erro 7 s), com ação opcional |
| `Dialog` | Modal com foco preso, `Esc`, clique fora e devolução do foco |
| `MenuButton` | Menu de ações com teclado (↑ ↓ Home End Esc) |
| `Disclosure` | O único bloco recolhível (`panel` ou `inline`) |
| `Skeleton`, `SkeletonBlock`, `Spinner`, `LoadingStatus` | Carregamento com a forma do conteúdo |
| `TextField`, `TextAreaField`, `SelectField`, `CheckboxField` | Campos com rótulo, ajuda, erro e todos os estados |
| `ThemeToggle`, `Mark`, `icons.tsx` | Tema, marca e ícones (grade 20px, traço 1,75) |

Layout (`components/layout`): `ShellFrame` (larguras `read` 44rem, `work` 80rem, `full` 110rem), `AuthenticatedLayout`
(barra lateral recolhível, gaveta abaixo de 1024px, busca `Ctrl/Cmd+K`), `PublicLayout`, `PageHeader`, `Section`.

## Verificação visual

`e2e/visual-themes.spec.ts` abre as telas principais (Início, Vagas, Vaga, Editor, Base, Conta) nos temas claro e escuro
em 1366×768, roda o axe **com contraste real** no Chromium, confere que não há rolagem horizontal em 390px e salva capturas
em `e2e/.tmp/screens` (nunca versionadas; só dados sintéticos). Roda com `pnpm test:e2e`.

## Fluidez

- `staleTime` padrão de 15 s: voltar a uma tela já vista não mostra carregamento.
- `usePrefetchJob()` no hover/foco dos links de vaga; listas com `placeholderData: keepPreviousData`.
- Base e Editor carregam sob demanda (`React.lazy`). Bundle inicial medido: 165 KB gzip (meta ≤ 180 KB).
- Esqueletos (`Skeleton`) em vez de "Carregando…"; transição de rota com `viewTransition` na navegação lateral.
- Atalhos: `Ctrl/Cmd+K` buscar vaga, `Ctrl/Cmd+S` salvar (Base e Editor), `Ctrl/Cmd+Shift+L` tema, `Esc` fecha.
