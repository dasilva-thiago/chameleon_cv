# Plano de identidade visual, UI/UX e layouts — Chameleon CV

**Status:** planejado, não aplicado. Nenhum código muda até a aprovação.
**Data:** 10/11/2026
**Escopo:** todo o `apps/web`. Fontes de verdade: `docs/REDEFINICAO_PRODUTO_PESSOAL.md` e a skill `personal-resume-workbench`.
**Leitores:** Thiago (aprova) e os agentes da seção 8 (executam).

---

## 1. Diagnóstico do estado atual

Medido no código em 10/11/2026.

| Achado | Dado | Consequência |
|---|---|---|
| Não há identidade definida | `index.css` tem só `@import 'tailwindcss'`; sem logo, favicon ou fonte própria | Aparência padrão do Tailwind |
| Cores escritas direto nos componentes | 409 usos de `slate-*`, `blue-*`, `red-*` e afins em `.tsx`, nenhum token | Mudar a marca exige editar arquivo por arquivo |
| Azul com dois significados | `blue` é ação principal e também "informação" e foco | A cor não orienta |
| Hierarquia de texto estreita | 118 `text-sm`, 52 `text-base`, 3 `text-xl` | Títulos e corpo parecem iguais |
| Estilos duplicados | 7 arquivos redefinem `primaryLinkClass`/`secondaryLinkClass`; 15 `<details>` e 7 `summary` estilizados à mão; `Collapsible` preso em `AnalysisSection` | Divergência visual a cada tela nova |
| Uma só forma de página | `max-w-3xl` ou `max-w-6xl`, sempre uma coluna empilhada | Vaga, editor e lista têm o mesmo esqueleto, embora o trabalho seja diferente |
| Editor sem visão simultânea | Alterna entre "Editar" e "Pré-visualizar" | Cada conferência custa dois cliques e perde o contexto |
| Sem verificação visual real | `color-contrast` desligado no axe (jsdom não calcula cor); PostgreSQL local ausente, E2E não roda nesta máquina | Nenhuma tela foi conferida visualmente até agora |

**Textos defasados a corrigir na fase 4** (a regra mudou em `match-4`):
- `STRENGTH_HELP.direct` diz "experiência profissional", mas agora projeto também conta como direta.
- Justificativas com concordância errada ("registro do perfil confirmada") e plurais como "item(ns)".

---

## 2. Conceito: "Cor é evidência"

O produto existe para responder a uma pergunta: **o que eu realmente consigo comprovar para esta vaga?** A identidade traduz isso de forma literal, e o nome ajuda: o camaleão ganha cor conforme o contexto.

> A interface é grafite e neutra. **A cor verde só aparece onde há sustentação confirmada.** Quanto mais o perfil comprova, mais cor a tela tem.

Regras que derivam do conceito:

1. **Verde significa confirmado/sustentado/aprovado, e nada mais.** Nunca é decoração nem cor de botão.
2. **Ação principal é tinta (grafite escuro sólido).** A hierarquia vem do valor (escuro → contorno → texto), o que resolve "botões todos iguais".
3. **Três matizes no sistema inteiro:** verde (comprovado), âmbar (precisa de você), vermelho (erro ou destruição). "Informação" passa a ser neutra; o azul sai.
4. **Nunca só cor:** todo estado tem texto ou padrão.

**Personalidade:** bancada de trabalho. Precisa, calma, densa sem ser apertada. Sem gradientes, ilustrações, textos de boas-vindas ou métricas decorativas.

### Elementos de assinatura

| Elemento | O que é | Onde aparece |
|---|---|---|
| **Trilho de evidência** | Barra segmentada com a composição dos requisitos da vaga, sempre com legenda numérica | Lista de vagas (mini), cabeçalho da vaga, resumo da análise, Início |
| **Linha do fluxo** | Vaga → Análise → Currículo → Aprovado, com o passo atual | Painel lateral da vaga, importação (3 passos) |
| **Próxima ação** | Um único botão que muda conforme o estado: Analisar → Gerar → Abrir → Aprovar → Baixar | Painel da vaga, linhas do Início |
| **Marca** | Espiral da cauda do camaleão em traço único; wordmark "Chameleon" + "CV" em mono | Barra superior, login, favicon |

**Atenção ao Trilho:** na última análise real, 19 de 22 requisitos saíram como diretos, então uma barra só com a força atual ficaria quase cheia em toda vaga e não ajudaria a comparar. Por isso o Trilho separa **sustentado** (direta sem lacuna) de **com lacuna** (direta com `gap` preenchido ou parcial). O dado já existe em `match.gap`.

---

## 3. Fundamentos visuais

### 3.1 Cor (tokens em `@theme`, `apps/web/src/index.css`)

Contrastes WCAG calculados; todos os valores estão dentro do gamut sRGB.

| Token | OKLCH | Hex | Uso | Contraste |
|---|---|---|---|---|
| `canvas` | 0.975 0.004 165 | `#f4f8f6` | Fundo da página | — |
| `surface` | 1 0 0 | `#ffffff` | Painéis, campos | — |
| `sunken` | 0.955 0.006 165 | `#edf1ef` | Blocos internos, hover | — |
| `line` | 0.89 0.008 170 | `#d6dcda` | Divisórias | decorativo |
| `line-strong` | 0.62 0.015 175 | `#7d8985` | Borda de campos e controles | 3,61 sobre surface |
| `ink-1` | 0.24 0.025 180 | `#112320` | Texto principal, botão primário | 16,31 |
| `ink-2` | 0.40 0.02 180 | `#3c4b48` | Texto secundário | 9,11 |
| `ink-3` | 0.50 0.018 180 | `#596763` | Metadados | 5,94 (5,54 sobre canvas) |
| `rail` | 0.21 0.03 180 | `#061d19` | Barra superior | — |
| `on-rail-2` | 0.80 0.015 175 | `#b4c1bd` | Texto inativo na barra | 9,46 sobre rail |
| `evid-4` | 0.47 0.095 168 | `#016b50` | Sustentado | 6,49 |
| `evid-3` | 0.63 0.115 168 | `#2a9f7c` | Com lacuna | 3,31 |
| `evid-2` | 0.86 0.06 168 | `#abdec9` | Transferível | 1,49: **exige contorno `evid-4`** |
| `evid-soft` | 0.955 0.03 168 | `#def7ec` | Fundo do selo positivo | — |
| `evid-text` | 0.40 0.08 168 | `#02553f` | Texto do selo positivo | 7,83 sobre evid-soft |
| `evid-on-rail` | 0.82 0.14 168 | `#51e1b3` | Marca e indicador na barra | 10,66 sobre rail |
| `attn` | 0.66 0.135 72 | `#c48218` | Pendente (com hachura) | 3,19 |
| `attn-soft` / `attn-text` | 0.96 0.04 85 / 0.42 0.09 65 | `#fef0d4` / `#6e4108` | Selo de atenção | 7,71 |
| `risk` | 0.52 0.18 27 | `#ba2b28` | Botão destrutivo | 6,04 (branco) |
| `risk-soft` / `risk-text` | 0.96 0.015 25 / 0.45 0.16 27 | `#fceeed` / `#9b1f1d` | Erro | 7,16 |

**Foco:** contorno de 2px `ink-1` com deslocamento de 2px; `evid-on-rail` dentro da barra superior.

### 3.2 Escala de estados

| Estado | Token | Forma | Texto |
|---|---|---|---|
| Sustentado | `evid-4` | sólido | Sustentado |
| Com lacuna | `evid-3` | sólido | Com lacuna |
| Transferível | `evid-2` | sólido + contorno | Transferível |
| Pendente | `attn` | hachura | A confirmar |
| Sem evidência | — | só contorno `line-strong` | Sem evidência |
| Aprovado / Confirmado | selo `evid-soft` | ícone de check | Aprovada / Confirmado |
| Rascunho / Aguardando | selo `attn-soft` | — | Rascunho / A confirmar |
| Arquivado / Neutro | selo `sunken` | — | Arquivada |

### 3.3 Tipografia

- **IBM Plex Sans** (variável, 400/500/600): leitura técnica, boa cobertura de pt-BR.
- **IBM Plex Mono** (400/500): só em contagens, versões, datas e IDs, com numerais alinhados.
- Auto-hospedadas via `@fontsource-variable`, só subset latin, sem requisição externa (ferramenta privada; `font-src 'self'`). Registrar em `docs/dependencies.md`, respeitando a idade mínima de release do pnpm.

| Token | Tamanho/peso | Uso |
|---|---|---|
| `text-title` | 26px / 600 | h1 |
| `text-section` | 18px / 600 | h2 |
| `text-item` | 15px / 600 | Título de card/linha |
| `text-body` | 15px / 400 | Corpo |
| `text-meta` | 13px / 400 | Metadados, ajuda |
| `text-overline` | 12px / 600, maiúsculas | Grupos do menu |
| Campos de formulário | 16px | Evita zoom no iOS |

### 3.4 Espaço, forma e movimento

- Base de 4px. Ritmo: 32px entre seções, 16px dentro de seção, 8px dentro de item.
- Raio: 6px em controles, 8px em painéis, total só em selos.
- Sombra só em sobreposição (menus). Painéis usam borda `line`.
- Controles com 40px em ponteiro fino e 44px em ponteiro grosso (`pointer-coarse:`).
- Movimento: 120 ms em hover/abertura; desligado com `prefers-reduced-motion`.
- Ícones: manter `icons.tsx` (grade 20px, traço 1,75), sem biblioteca nova. Ampliar para cerca de 14 ícones.

### 3.5 Larguras de página

| Token | Largura | Uso |
|---|---|---|
| `--w-read` | 44rem | Formulários, Conta, Login |
| `--w-work` | 76rem | Listas, Vaga, Perfil, Revisar |
| `--w-full` | 100rem | Editor de currículo |

### 3.6 Regras de escrita

Frases curtas, verbo no botão ("Gerar currículo"), maiúscula só na primeira palavra. Máximo de uma linha de apoio por seção; o resto vai para bloco recolhido. Plurais corretos (sem "item(ns)"): exportar para `lib/` o helper `plural`, hoje privado em `sections.ts`. Nada de texto que descreve o óbvio.

---

## 4. Layouts por página

Cada tipo de trabalho tem o seu esqueleto. Valores de largura referem-se à seção 3.5.

### Estrutura global
Barra superior `rail` de 52px, fixa: marca, navegação na ordem do fluxo (**Início, Vagas, Perfil**), botão **+ Vaga** sempre disponível e menu do usuário (Conta, Sair). Sai o nome + botão "Sair" soltos e "Conta" deixa de ocupar a navegação principal.

### Início — "Fila de trabalho" (`--w-work`)
Coluna principal: vagas agrupadas por **próxima ação** ("Analisar", "Gerar currículo", "Revisar e aprovar", "Candidatura enviada"), cada linha com Trilho mini e botão de ação direta. Coluna estreita: currículos recentes e o que precisa de atenção no perfil, só se houver.

### Vagas — "Lista densa" (`--w-work`)
Linhas de 72px em vez de cards altos: título + contexto à esquerda, Trilho mini ao centro, situação e próxima ação à direita. Busca + filtro segmentado com contagem (Em andamento, Todas, Arquivadas) e demais situações em menu. Meta: pelo menos 8 vagas visíveis em 1366×768.

### Vaga — "Mesa de trabalho" (`--w-work`, 2 colunas)
- **Painel fixo à direita (20rem):** Próxima ação, Linha do fluxo, Trilho com legenda, seletor de situação, link da vaga original e menu ⋯ (Editar, Arquivar, Excluir).
- **Coluna principal:** matriz de análise, currículos, texto original recolhido.
- Em telas estreitas o painel vira um bloco compacto no topo.

### Análise — "Matriz" (dentro da Vaga)
Linhas `requisito | estado | principal evidência`, agrupadas por importância; clicar expande evidências, lacuna, aviso de experiência e anotação. Filtro rápido "só com lacuna". O plano de adaptação fica recolhido, com contagem.

### Editor de currículo — "Dividido" (`--w-full`)
Formulário à esquerda e **folha A4 em tempo real à direita** a partir de 1280px, com rolagem independente; abaixo disso mantém a alternância atual. Barra fixa no topo: nome, versão, situação, verificação de fontes (contagem clicável que leva ao item), **Salvar** e **Aprovar**. `Ctrl/Cmd+S` salva. Fontes e avisos ficam junto de cada item, recolhidos.

### Perfil — "Mestre-detalhe" (`--w-work`, menu lateral fixo)
Menu de seções já enxuto, com rolagem própria. Registros em lista de linhas (título, subtítulo, selo, Editar, ⋯), com detalhes expandidos na própria linha.

### Revisar — "Caixa de entrada" (`--w-work`)
Abas mantidas. Fila com seleção por grupo e **barra de ações fixa** ao selecionar. Ao confirmar, o item sai da fila com aviso discreto.

### Importar — "Passos" (`--w-read`)
Linha do fluxo com 3 passos: Arquivo → Prévia → Aplicado. Área de soltar arquivo como entrada principal; colar texto como alternativa.

### Conta e Login (`--w-read`)
Conta: formulário simples, sem ornamento. Login e aceite de convite: fundo `rail`, marca e um único painel central. É a única tela com presença forte de marca.

### O que não recebe a identidade
**PDF, DOCX, HTML exportados e a folha de pré-visualização** continuam neutros e compatíveis com ATS (ADR-0012). A folha precisa corresponder ao arquivo exportado. Nenhum token da aplicação entra nos modelos de currículo.

---

## 5. Componentes (biblioteca em `components/ui`)

| Componente | Ação | Substitui |
|---|---|---|
| `Button`, `LinkButton` | Variantes `primary` (tinta), `secondary` (contorno), `ghost`, `danger` | 7 cópias de `*LinkClass` |
| `StatusBadge` | Só por estado semântico (seção 3.2) | `Badge` com `tone` livre e prefixos |
| `EvidenceRail` | Trilho nos tamanhos `mini` e `full` | Novo |
| `FlowSteps` | Linha do fluxo | Novo |
| `Disclosure` | Bloco recolhível único | 15 `<details>` e `Collapsible` local |
| `Tabs`, `Segmented` | Abas e filtro com contagem | `tabClass` local; `SelectField` nos filtros |
| `Panel`, `RowList`, `EmptyState` | Superfícies e estados vazios | 8 blocos `border-dashed`, cards repetidos |
| `Alert` | Tons `error`, `attention`, `success`, `neutral` | Tom `info` azul |
| `MenuButton` | Posicionamento que não sai da tela em telas estreitas | Âncora fixa à direita |
| `Field*` | Estados e tamanhos tokenizados, mesma API | Sem mudança de uso |
| `Mark` | Marca em SVG + `favicon.svg` | Texto solto `APP_NAME` |

---

## 6. Critérios de aceite globais

1. Nenhuma cor crua do Tailwind (`slate-`, `blue-` etc.) em `apps/web/src`, garantido por teste de arquitetura em `tests/architecture`.
2. Uma ação `primary` por área visual.
3. Verde aparece só em estados comprovados (revisão visual).
4. Próxima ação da vaga visível sem rolar em 1366×768.
5. Contraste real aprovado: axe com `color-contrast` ligado, em Chromium, em todas as páginas.
6. Sem rolagem horizontal em 360px; navegação completa por teclado; foco visível.
7. `pnpm check` verde. E2E verde se houver PostgreSQL disponível; caso contrário, registrar explicitamente que não rodou.
8. Conteúdo e modelos dos arquivos exportados inalterados: nenhum teste de exportação modificado.

---

## 7. Fases

Cada fase termina com `pnpm check` verde e commit próprio. Commits em inglês, **somente com a identidade de Thiago, sem linha de coautoria**, sem force push, e apenas quando ele pedir.

| # | Fase | Entrega | Depende de | Agente |
|---|---|---|---|---|
| 0 | Base de comparação | Harness Playwright com `page.route` e **dados sintéticos** (sem banco e sem tocar na Neon); capturas "antes" em 360/768/1366/1920; contagem de cliques do fluxo principal | Decisões da seção 9 | `visual-qa-reviewer` |
| 1 | Fundamentos | Tokens, fontes, `Mark`, favicon, biblioteca da seção 5, `docs/design-system.md`, ADR-0015 | 0 | `design-system-lead` |
| 2 | Estrutura global | Barra superior, menu do usuário, larguras | 1 | `design-system-lead` |
| 3 | Dados de apoio | Resumo do Trilho em `JobSummary`; `GET /api/resumes` recentes; ambos com isolamento por dono e testes | 0 | `backend-implementer` |
| 4 | Fluxo de vagas | Início, Vagas, Vaga, Matriz, seção de currículos, formulário de vaga, correção dos textos defasados | 2, 3 | `workflow-ui-implementer` |
| 5 | Editor | Layout dividido, barra fixa, `Ctrl+S`, navegação até o problema | 2 | `resume-editor-implementer` |
| 6 | Perfil e demais | Perfil, Revisar, Importar, Conta, Login, Convite, 404 | 2 | `profile-ui-implementer` |
| 7 | Varredura | Migração das cores restantes, remoção de código morto, teste de arquitetura | 4, 5, 6 | `ui-migration-sweeper` |
| 8 | Portão final | Capturas "depois", axe real, critérios da seção 6, revisão de coerência | 7 | `visual-qa-reviewer` → `final-architect-reviewer` |

**Paralelismo:** 3 pode correr junto com 1–2. 4, 5 e 6 correm em paralelo em worktrees separadas, pois tocam pastas distintas; o orquestrador integra um por vez. O restante é sequencial.

**Pausas para Thiago conferir no navegador:** ao fim das fases 2, 4, 5 e 6.

---

## 8. Agentes

O documento de produto (§8.2) pede para não acionar subagentes por padrão. Este plano os usa porque Thiago pediu explicitamente, o que tem precedência (§13). Só há delegação onde o trabalho é independente, e nada é duplicado.

### 8.1 Definições e modelos

| Agente | Situação | Modelo | Effort | Isolamento | Por quê |
|---|---|---|---|---|---|
| Orquestrador (sessão principal) | existente | Opus 5.5 (`claude-opus-5-5`) | high | — | Integra, decide conflitos e mantém a coerência |
| `design-system-lead` | **novo** | Opus 5.5 | high | branch principal | Decisões transversais: um erro aqui se multiplica em todas as telas |
| `workflow-ui-implementer` | **novo** | Sonnet 5.5 (`claude-sonnet-5-5`) | high | worktree | Telas mais complexas, sobre fundação pronta |
| `resume-editor-implementer` | **novo** | Sonnet 5.5 | high | worktree | Layout dividido e estado de edição delicado |
| `profile-ui-implementer` | **novo** | Sonnet 5.5 | medium | worktree | Aplicação repetitiva de padrões já definidos |
| `ui-migration-sweeper` | **novo** | Haiku 5.5 (`claude-haiku-5-5`) | medium | branch principal | Trabalho mecânico com verificação por teste |
| `visual-qa-reviewer` | **novo** | Sonnet 5.5 | high | branch principal | Harness, capturas e axe real; não altera telas |
| `backend-implementer` | existente | Sonnet 5.5 | high | worktree | Duas extensões pequenas de API |
| `final-architect-reviewer` | existente | Opus 5.5 | xhigh | somente leitura | Portão final único, sem auditorias repetidas |

Não acionar: `security-reviewer` (a fase 3 reutiliza o isolamento já testado; acionar só se aparecer rota fora do padrão por dono), `solution-architect` e `data-model-engineer` (sem mudança de modelo de dados).

### 8.2 Modelo de arquivo (`.claude/agents/<nome>.md`)

```yaml
---
name: workflow-ui-implementer
description: Implementa as telas de vagas, análise e currículos do Chameleon CV seguindo docs/PLANO_IDENTIDADE_VISUAL.md.
model: sonnet
effort: high
---
```

Corpo comum a todos: ler só as seções indicadas deste plano e `docs/design-system.md`; aplicar a skill `personal-resume-workbench`; usar apenas tokens e componentes da biblioteca; **não criar variantes novas**, pedindo ao orquestrador quando faltar algo; preservar nomes acessíveis usados nos testes; não fazer commit nem push; relatar o que foi feito e o que não foi verificado.

### 8.3 Briefing por agente

- **`design-system-lead`** — Seções 2, 3, 5 e estrutura global da 4. Único autorizado a criar tokens e componentes. Também escreve `design-system.md` e o ADR-0015. Não migra páginas além do necessário para validar os componentes.
- **`workflow-ui-implementer`** — Layouts Início, Vagas, Vaga e Matriz. Arquivos: `features/home/HomePage`, `features/jobs/*`, `features/resumes/ResumesSection`, `DownloadMenu`, `features/ai/*`. Corrige os textos da seção 1.
- **`resume-editor-implementer`** — Layout Editor. Arquivos: `ResumeEditorPage`, `ResumeForm`, `SourceList`. `ResumePreview` só muda de moldura: o conteúdo continua igual ao exportado.
- **`profile-ui-implementer`** — Layouts Perfil, Revisar, Importar, Conta, autenticação e 404. Arquivos: `features/profile/**`, `features/home/AccountPage`, `NotFoundPage`, `features/auth/*`. Sem alterar regras de validação, consentimento ou sessão.
- **`ui-migration-sweeper`** — Substituir cores cruas restantes pela tabela de equivalência da fase 1; apagar constantes de estilo sem uso; escrever o teste de arquitetura. Sem decisão de design: caso ambíguo vai para o orquestrador.
- **`visual-qa-reviewer`** — Fase 0 e fase 8. Dados sempre sintéticos: **nunca capturar o perfil real, nunca usar a Neon, nunca versionar capturas com dados pessoais**. Reporta achados, não corrige.
- **`backend-implementer`** — Fase 3. Contratos opcionais (não invalidam dados salvos), escopo por `ownerId`, teste cruzado A/B, sem enviar texto da vaga. Precisa de PostgreSQL para os testes de integração.
- **`final-architect-reviewer`** — Avaliar contra este plano e o documento de produto; **ignorar o plano V3 citado na própria definição do agente**.

---

## 9. Decisões pendentes (Thiago)

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Aprovar o conceito "Cor é evidência" e a paleta | Aprovar. A paleta muda rápido depois da fase 1, o conceito não |
| D2 | Base do trabalho: a branch `feat/analysis-and-home-ux` ainda não foi integrada à `main` | Integrar antes e abrir `feat/visual-identity` a partir da `main` |
| D3 | Fase 3 (backend para Trilho na lista e currículos recentes) | Fazer. Sem ela, o Trilho só aparece dentro da vaga e o Início não mostra currículos |
| D4 | Instalar PostgreSQL 16+ local | Instalar. Sem ele, integração e E2E não rodam e a fase 3 fica sem teste real |
| D5 | Nova dependência: fontes IBM Plex auto-hospedadas | Aceitar. Alternativa: fonte do sistema, com perda de identidade |

**Fora do escopo:** tema escuro, paleta de comandos, atalhos de uma tecla, animações decorativas e qualquer mudança nos arquivos exportados.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Testes quebrarem em massa | Preservar nomes acessíveis; os seletores usam papel e nome |
| Agentes divergirem visualmente | Só `design-system-lead` cria tokens e componentes; teste de arquitetura |
| Conflito na integração das worktrees | Pastas separadas; biblioteca congelada após a fase 2 |
| Painel fixo apertar em telas médias | Vira bloco no topo abaixo de 1024px; validado na fase 8 |
| Prévia dividida ficar lenta | Atualizar com valor adiado (`useDeferredValue`); sem salvar a cada tecla |
| Peso das fontes | Só subset latin; medir o bundle antes e depois |
