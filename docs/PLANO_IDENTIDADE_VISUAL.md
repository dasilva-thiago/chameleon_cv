# Plano de identidade visual, UI/UX e layouts — Chameleon CV

**Status:** em implementação desde 11/11/2026 (branch `feat/visual-identity`). Referência de uso: [design-system.md](design-system.md) e [ADR-0016](decisions/ADR-0016-design-system-temas.md).
**Data:** 10/11/2026 (revisão 3: cor de marca, tema claro e escuro, estados de interação e fluidez; versões anteriores no
histórico do git).
**Escopo:** todo o `apps/web`. Fontes de verdade: `docs/REDEFINICAO_PRODUTO_PESSOAL.md`, a
[ADR-0015](decisions/ADR-0015-fluxo-career-ops-base-markdown.md) e a skill `personal-resume-workbench`.
**Leitores:** Thiago (aprova) e os agentes da seção 8 (executam).

**Objetivo:** um painel profissional, com cores de produto profissional (não preto e branco), rápido e fluido, com tema claro
e escuro e todos os estados de interação que se espera de um frontend profissional (hover, pressionado, foco, desabilitado,
carregando, selecionado, erro).

---

## 1. Diagnóstico do estado atual

Medido no código em 10/11/2026, depois do refactor (`main` em `db3bc4f`).

| Achado | Dado | Consequência |
|---|---|---|
| Não há identidade definida | `index.css` tem só `@import 'tailwindcss'`; sem logo, favicon ou fonte própria; `APP_NAME` em texto solto | Aparência padrão do Tailwind, quase preto e branco |
| Cores escritas direto nos componentes | 255 usos de `slate-*`, `blue-*`, `red-*`, `green-*`, `amber-*` em `.ts/.tsx`, nenhum token | Mudar a marca ou ter tema escuro exige editar arquivo por arquivo |
| Sem tema escuro | 0 usos de `dark:` e nenhuma variável de tema | Só tema claro |
| Estados de interação incompletos | 64 `focus-visible:`, mas só 16 `hover:`, 1 `active:`, 10 `disabled:`, 0 `aria-busy`, 0 `transition` | Botões e linhas não respondem ao toque nem ao mouse; nada indica "carregando" além de texto |
| Azul com dois significados | `blue` é ação principal e também "informação" (`Alert`/`Badge` `info`) e foco | A cor não orienta |
| Cores de estado sem regra | `Badge` com `good/warn/bad/info/neutral` escolhido tela a tela (veredito, match, situação da vaga, versão) | O mesmo verde significa "forte", "aprovada" e "salva" |
| Hierarquia de texto estreita | 66 `text-sm`, 25 `text-base`, 5 `text-xl` ou maiores | Títulos e corpo parecem iguais |
| Estilos duplicados | 5 arquivos redefinem `*LinkClass`; 6 `<details>`/`<summary>` estilizados à mão | Divergência visual a cada tela nova |
| Sem otimizações de fluidez | 0 rotas carregadas sob demanda, 0 pré-carregamentos; carregamentos mostram só "Carregando…" | Troca de tela mais lenta do que precisa; o layout pula quando os dados chegam |
| Avaliação longa e sem âncora | `AnalysisSection` empilha veredito, notas, requisitos, lacunas, salário, palavras-chave e plano numa coluna | A nota e a recomendação somem ao rolar; difícil comparar requisito × evidência |
| Base como dois `textarea` simples | `ProfilePage` sem retorno de como o programa leu o CV | A pessoa não vê se cargos e empresas foram reconhecidos, e as checagens dependem disso |
| Editor sem visão simultânea | Alterna entre "Editar" e "Pré-visualizar"; cobertura e checagens só no topo | Cada conferência custa dois cliques e perde o contexto |
| Sem verificação visual real | `color-contrast` desligado no axe (jsdom não calcula cor) | Nenhuma tela foi conferida visualmente. PostgreSQL local e E2E já rodam nesta máquina |

**Textos a revisar na fase 4:** rótulos de importância e evidência (`Crítico (dito na vaga)`, `inferido`) precisam de ajuda
curta; "Só com um bom motivo" (recomendação 3.5-3.9) é vago; mensagens das checagens aparecem duas vezes quando o termo é
palavra-chave e tem forma de ferramenta.

---

## 2. Conceito: "Cor é evidência", num painel com marca

O produto responde a uma pergunta: **o que eu consigo comprovar para esta vaga, e vale me candidatar?** O nome ajuda: o
camaleão ganha cor conforme o contexto.

A interface tem **duas famílias de cor com papéis que nunca se misturam**:

- **Cor de marca (índigo)** = interação: botão principal, links, foco, item selecionado, navegação ativa, barras de
  progresso. É ela que tira o produto do preto e branco e dá cara de painel profissional.
- **Cores de evidência** = significado: verde (comprovado na sua base, recomendado, aprovado), âmbar (precisa da sua
  atenção), vermelho (bloqueia ou destrói).

> Neutros frios e calmos, índigo onde se age, verde onde a sua base comprova. Quanto mais a base sustenta a vaga, mais verde a
> tela tem.

Regras:

1. **Verde nunca é botão nem decoração**, só evidência, recomendação ou aprovação. Por isso a marca é índigo e não verde: o
   olho separa "clique aqui" de "isto está comprovado".
2. **Uma ação principal (índigo sólido) por área**; as demais são contorno ou texto.
3. **"Informação" é neutra**: alertas informativos usam neutro com ícone, não azul nem índigo.
4. **Nunca só cor**: todo estado tem texto, ícone ou forma.
5. **Os dois temas têm o mesmo significado de cor**; só os valores mudam.

**Personalidade:** painel de trabalho. Preciso, calmo, denso sem ser apertado, com resposta imediata ao toque. Sem gradientes
decorativos, ilustrações, textos de boas-vindas ou métricas de enfeite.

### Elementos de assinatura

| Elemento | O que é | Onde aparece |
|---|---|---|
| **Nota** | A nota 1-5 em mono, grande, com a recomendação ao lado (Candidatar / Só com motivo / Não recomendado) | Cabeçalho da vaga, lista de vagas, Início |
| **Trilho de evidência** | Barra segmentada com a composição dos requisitos: forte, parcial, faltando, não se aplica, sempre com legenda numérica | Lista de vagas (mini), painel da vaga, topo da avaliação |
| **Linha do fluxo** | Base → Vaga → Avaliação → Currículo → Aprovado, com o passo atual em índigo | Painel da vaga, Início quando a base está vazia |
| **Próxima ação** | Um único botão índigo que muda conforme o estado: Preencher base → Avaliar → Gerar currículo → Abrir → Aprovar → Baixar | Painel da vaga, linhas do Início e de Vagas |
| **Marca** | Espiral da cauda do camaleão em traço único, índigo com ponto verde; wordmark "Chameleon" + "CV" em mono | Barra lateral, login, favicon (claro e escuro) |

**Trilho e a evidência conferida:** um match `strong` cuja evidência o programa não achou na base cai para `partial`. O Trilho
usa o resultado já conferido, nunca o que a IA disse; uma marca discreta indica quando houve rebaixamento.

---

## 3. Fundamentos visuais

### 3.1 Cor: tokens semânticos com tema claro e escuro

Tokens como variáveis CSS em `apps/web/src/index.css`, expostos ao Tailwind 4 por `@theme inline` (ex.: `bg-surface`,
`text-ink-2`, `border-line`, `bg-brand`). Os componentes **só** usam tokens; o tema troca os valores das variáveis. Contraste
WCAG calculado para cada par abaixo (texto normal exige 4,5; componentes e texto grande, 3).

**Superfícies e texto**

| Token | Claro | Escuro | Uso | Contraste (claro / escuro) |
|---|---|---|---|---|
| `canvas` | `#f6f7f9` | `#0b0f19` | Fundo da página | — |
| `surface` | `#ffffff` | `#111827` | Painéis, cards, campos | — |
| `sunken` | `#eef1f5` | `#0d1320` | Blocos internos, fundo de tabela | — |
| `raised` | `#ffffff` + sombra | `#1a2234` | Menus, popovers, diálogos | ink-1: 17,85 / 13,18 |
| `line` | `#e1e5eb` | `#253047` | Divisórias | decorativo |
| `line-strong` | `#848d9c` | `#64708a` | Borda de campos e controles | 3,35 / 3,57 |
| `ink-1` | `#0f172a` | `#e7eaf0` | Texto principal | 17,85 / 14,72 |
| `ink-2` | `#3c4657` | `#b3bccb` | Texto secundário | 9,52 / 9,27 |
| `ink-3` | `#5d6677` | `#8c96a8` | Metadados | 5,78 / 5,95 |

**Marca (interação)**

| Token | Claro | Escuro | Uso | Contraste |
|---|---|---|---|---|
| `brand` | `#4f46e5` | `#818cf8` | Botão principal, link, foco, seleção | texto no botão: 6,29 (branco) / 6,42 (`#0b0f19`); link sobre surface: 6,29 / 5,95 |
| `brand-hover` | `#4338ca` | `#a5b4fc` | Hover do botão principal | 7,90 / 9,61 |
| `brand-active` | `#3730a3` | `#6366f1` | Pressionado | — |
| `brand-soft` | `#eef0ff` | `#1e1f4a` | Item selecionado, navegação ativa | — |
| `brand-text` | `#3730a3` | `#a5b4fc` | Texto sobre brand-soft | 8,77 / 7,80 |
| `on-brand` | `#ffffff` | `#0b0f19` | Texto sobre `brand` | ver `brand` |

**Evidência e estados**

| Token | Claro | Escuro | Uso | Contraste |
|---|---|---|---|---|
| `evid` | `#047857` | `#34d399` | Forte, recomendado, aprovado (preenchimento e texto) | 5,48 / 9,23 sobre surface |
| `evid-partial` | `#0d9467` | `#059669` | Parcial (preenchimento do Trilho) | 3,85 / 4,71 |
| `evid-soft` / `evid-text` | `#e6f6ee` / `#065f46` | `#0d2a21` / `#6ee7b7` | Selo positivo | 6,87 / 10,05 |
| `attn` | `#d97706` | `#f59e0b` | Aviso (ícone, hachura) | 3,19 / 8,26 |
| `attn-soft` / `attn-text` | `#fef3c7` / `#92400e` | `#2b2110` / `#fcd34d` | Selo e alerta de atenção | 6,37 / 10,97 |
| `risk` | `#dc2626` | `#dc2626` | Botão destrutivo (texto branco) | 4,83 nos dois |
| `risk-hover` | `#b91c1c` | `#b91c1c` | Hover do destrutivo | — |
| `risk-soft` / `risk-text` | `#fef2f2` / `#991b1b` | `#2c1416` / `#fca5a5` | Erro, regra que barra, não recomendado | 7,60 / 9,08 |

**Foco:** anel de 2px `brand` com 2px de deslocamento (`outline-offset`), sobre qualquer fundo (5,87 no claro, 6,42 no escuro).

### 3.2 Escala de estados

| Estado | Token | Forma | Texto |
|---|---|---|---|
| Match forte | `evid` | sólido | Forte |
| Match parcial | `evid-partial` | sólido | Parcial |
| Faltando | — | só contorno `line-strong` | Faltando |
| Não se aplica | `sunken` | sólido claro | Não se aplica |
| Recomendação: candidatar | selo `evid-soft` | ícone de check | Vale se candidatar |
| Recomendação: considerar | selo `attn-soft` | — | Só com um bom motivo |
| Recomendação: não | selo `risk-soft` | — | Não recomendado |
| Regra que barra | bloco `risk-soft` | ícone de bloqueio | Quebra uma regra sua |
| Versão aprovada | selo `evid-soft` | ícone de check | Aprovada |
| Rascunho | selo `attn-soft` | — | Rascunho |
| Erro de checagem | `risk-text` | ícone | Erro |
| Aviso de checagem | `attn-text` | ícone | Aviso |
| Avaliação desatualizada | selo `attn-soft` | — | Desatualizada |
| Situação da vaga (Salva, Avaliada, Enviada...) | selo neutro `sunken` | — | Nome da situação |

A situação da vaga é **neutra**: não é evidência, então não usa verde.

### 3.3 Tipografia

- **Inter** (variável, 400/500/600): padrão de painéis profissionais, ótima legibilidade em tamanhos pequenos, numerais
  tabulares (`font-variant-numeric: tabular-nums`) para listas e notas.
- **JetBrains Mono** (400/500): nota, contagens, versões, datas e **os editores de Markdown da Base**.
- Auto-hospedadas via `@fontsource-variable`, só subset latin, `font-display: swap`, sem requisição externa
  (`font-src 'self'`). Registrar em `docs/dependencies.md`, respeitando a idade mínima de release do pnpm.

| Token | Tamanho/peso | Uso |
|---|---|---|
| `text-score` | 40px / 600 mono | Nota da vaga |
| `text-title` | 24px / 600 | h1 |
| `text-section` | 17px / 600 | h2 |
| `text-item` | 14px / 600 | Título de card/linha |
| `text-body` | 14px / 400 | Corpo |
| `text-meta` | 12.5px / 400 | Metadados, ajuda |
| `text-overline` | 11.5px / 600, maiúsculas, espaçado | Grupos do menu |
| Campos de formulário | 16px em telas de toque, 14px no desktop | Evita zoom no iOS |

### 3.4 Espaço, forma, elevação e ícones

- Base de 4px. Ritmo: 32px entre seções, 16px dentro de seção, 8px dentro de item. Densidade "confortável" por padrão.
- Raio: 6px em controles, 10px em painéis e cards, total em selos e avatares.
- Elevação (claro): `shadow-xs` em cards clicáveis no hover, `shadow-md` em menus e popovers, `shadow-lg` em diálogos.
  Elevação (escuro): sombra quase invisível, então o nível vem da superfície (`surface` → `raised`) e de uma borda `line`.
- Controles com 36px no desktop e 44px em ponteiro grosso (`pointer-coarse:`).
- Ícones: manter `icons.tsx` (grade 20px, traço 1,75), sem biblioteca nova; ampliar para cerca de 20 ícones (tema, check,
  bloqueio, alerta, seta, mais ações, busca, copiar, histórico, sair, etc.).

### 3.5 Larguras e navegação

| Token | Largura | Uso |
|---|---|---|
| `--w-read` | 44rem | Formulário de vaga, Conta, Login |
| `--w-work` | 80rem | Início, Vagas, Vaga |
| `--w-full` | 100% (máx. 110rem) | Base, Editor de currículo |

### 3.6 Regras de escrita

Frases curtas, verbo no botão ("Avaliar vaga", "Gerar currículo"), maiúscula só na primeira palavra. Máximo de uma linha de
apoio por seção; o resto vai para bloco recolhido. Plurais corretos (helper `plural` em `lib/`). Nada de texto que descreve
o óbvio. Termos do career-ops traduzidos sempre do mesmo jeito: *critical* = Crítico, *high* = Alto, *meaningful* =
Relevante, *preferred* = Diferencial, *stated* = dito na vaga, *structural* = pela estrutura da vaga, *inferred* = inferido.

### 3.7 Estados de interação (obrigatórios em todo componente interativo)

Transições de 120 ms (`ease-out`) em cor, fundo, borda e sombra; nunca em largura ou altura. Tudo desligado com
`prefers-reduced-motion: reduce`.

| Componente | Repouso | Hover | Pressionado (`active`) | Foco (`focus-visible`) | Desabilitado | Carregando | Selecionado / atual |
|---|---|---|---|---|---|---|---|
| Botão principal | `brand` + `on-brand` | `brand-hover` | `brand-active` | anel `brand` 2px + 2px | 50% de opacidade, cursor `not-allowed`, sem hover | spinner à esquerda, texto da etapa ("Avaliando…"), `aria-busy`, largura fixa (não pula) | — |
| Botão secundário | `surface` + borda `line-strong` + `ink-1` | fundo `sunken` | fundo `line` | anel `brand` | idem | idem | — |
| Botão fantasma (`ghost`) | só texto `ink-2` | fundo `sunken` + `ink-1` | fundo `line` | anel `brand` | idem | idem | `brand-soft` + `brand-text` |
| Botão destrutivo | `risk` + branco | `risk-hover` | `risk-hover` mais escuro | anel `risk` | idem | idem | — |
| Link | `brand`, sem sublinhado em navegação, sublinhado em texto corrido | sublinhado | `brand-active` | anel `brand` | — | — | — |
| Campo de texto | `surface` + borda `line-strong` | borda `ink-3` | — | borda `brand` + anel `brand` 30% | fundo `sunken`, texto `ink-3` | — | — |
| Campo com erro | borda `risk` + mensagem `risk-text` | — | — | anel `risk` | — | — | — |
| Caixa de seleção / rádio | borda `line-strong` | borda `ink-3` | — | anel `brand` | opacidade 50% | — | preenchido `brand` com check branco |
| Item de menu | transparente | `sunken` | `line` | fundo `sunken` + anel interno | `ink-3`, sem hover | — | check à direita |
| Linha clicável (Vagas, Início) | `surface` | `sunken` + seta aparece | `line` | anel `brand` interno | — | esqueleto | barra lateral `brand` 3px |
| Aba / filtro segmentado | `ink-2` | `ink-1` | — | anel `brand` | — | — | sublinhado / fundo `brand-soft` + `brand-text` |
| Item da navegação lateral | `ink-2` | `sunken` + `ink-1` | `line` | anel `brand` | — | — | `brand-soft` + `brand-text` + ícone `brand` |
| Card clicável | borda `line` | borda `line-strong` + `shadow-xs` | sem sombra | anel `brand` | — | esqueleto | borda `brand` |

Além disso: `cursor-pointer` só no que é clicável; área de toque mínima de 44px em ponteiro grosso; `user-select: none` em
controles; seleção de texto com `brand-soft`.

### 3.8 Tema claro e escuro

- **Três opções:** Claro, Escuro e Sistema (padrão: segue `prefers-color-scheme`). Escolha no menu do usuário e com o
  atalho `Ctrl/Cmd+Shift+L`; salva em `localStorage`.
- **Sem piscar na carga:** um script inline mínimo em `index.html` aplica `data-theme` antes da primeira pintura; o
  `color-scheme` do documento acompanha o tema (barras de rolagem, campos nativos e calendário corretos).
- **Mesmos significados nos dois temas** (seção 2). Cada par da seção 3.1 tem o valor do escuro conferido.
- **Imagens e marca:** `Mark` e favicon com versão para fundo escuro.
- **O que não muda:** a folha A4 de pré-visualização continua branca nos dois temas (é o arquivo que será exportado), com uma
  moldura escura em volta no tema escuro.
- **Teste:** axe com `color-contrast` ligado em Chromium nos dois temas, e capturas de cada página nos dois.

### 3.9 Rápido e fluido

| Técnica | Onde | Meta |
|---|---|---|
| Rotas carregadas sob demanda (`React.lazy` + `Suspense`) | Base e Editor (mais pesadas) | JS inicial ≤ 180 KB gzip |
| Pré-carregar no hover/foco do link (`queryClient.prefetchQuery`) | Linhas de Vagas e Início → detalhe da vaga | Abrir a vaga sem tela de carregamento |
| Esqueletos com a forma do conteúdo | Listas, painel da vaga, avaliação, editor | Nada pula quando os dados chegam (CLS ≈ 0) |
| Manter os dados anteriores ao refazer a busca (`placeholderData: keepPreviousData`) | Filtros e busca de Vagas | Filtrar sem piscar a lista |
| Atualização otimista (com desfazer em caso de erro) | Situação da vaga, renomear currículo, arquivar | Resposta < 100 ms |
| Progresso por etapas nas chamadas de IA | Avaliar, gerar currículo | O usuário sempre sabe em que etapa está |
| Transições de rota suaves (`document.startViewTransition`, quando disponível) | Navegação principal | 150 ms, desligado com movimento reduzido |
| Avisos não bloqueantes (toast) | Salvo, aprovado, copiado, erro de rede | Some em 4 s; não rouba o foco |
| Atalhos | `Ctrl/Cmd+S` salvar, `Ctrl/Cmd+K` buscar vaga, `N` nova vaga, `Esc` fecha menus | Listados no menu do usuário |

**Orçamento medido na fase 8** (Chromium, build de produção, 1366×768): LCP < 1,5 s; resposta a clique < 100 ms; troca de
tela sem carregamento visível para dados já em cache.

---

## 4. Layouts por página

Cada tipo de trabalho tem o seu esqueleto. Larguras na seção 3.5.

### Estrutura global — painel com barra lateral

- **Barra lateral fixa** (240px; recolhível para 64px só com ícones, lembrando a escolha): marca, navegação na ordem do fluxo
  (**Início, Vagas, Base**), botão **+ Nova vaga** em destaque, e no rodapé o indicador de IA (ativa / desligada / sem
  chave), o seletor de tema e o menu do usuário (Conta, atalhos, Sair).
- **Barra superior fina** (56px) dentro da área de conteúdo: trilha de navegação (Vagas › Dev Backend), busca de vagas
  (`Ctrl/Cmd+K`) e as ações da página.
- Abaixo de 1024px a barra lateral vira gaveta, aberta pelo botão de menu.

### Início — "Fila de trabalho" (`--w-work`)
Base vazia: um único bloco com a Linha do fluxo e **Preencher a base**. Com base: cartões de resumo pequenos no topo (vagas
para avaliar, currículos para aprovar, avaliações desatualizadas), todos clicáveis; abaixo, vagas agrupadas por **próxima
ação**, cada linha com Nota, Trilho mini e o botão da ação. Coluna estreita: currículos recentes.

### Vagas — "Lista densa" (`--w-work`)
Tabela de linhas de 64px: título + empresa à esquerda; Nota e Trilho mini ao centro; situação e próxima ação à direita.
Cabeçalho fixo ao rolar, ordenação por nota ou data, busca + filtro segmentado com contagem (Em andamento, Todas, Arquivadas).
Meta: pelo menos 8 vagas visíveis em 1366×768.

### Vaga — "Mesa de trabalho" (`--w-work`, 2 colunas)
- **Painel fixo à direita (20rem):** Nota + recomendação, Trilho com legenda, Próxima ação, Linha do fluxo, pretensão
  salarial sugerida (valor e modalidade, com botão copiar), seletor de situação, link da vaga original e menu ⋯ (Editar,
  Arquivar, Excluir).
- **Coluna principal, nesta ordem:** regra que barra (se houver), veredito em uma frase com razões, **matriz de requisitos**,
  lacunas e como contornar, plano de adaptação, palavras-chave, currículos da vaga, texto original recolhido.
- Em telas estreitas o painel vira um bloco compacto no topo.

### Avaliação — "Matriz" (dentro da Vaga)
Linhas `requisito | importância | match | evidência`, na ordem já calculada (importância, faltando antes de atendido).
A evidência aparece citada, com a marca "conferida na sua base" ou "não encontrada na base". Clicar expande o trecho da vaga
(`jdSignal`) e a lacuna. Filtro rápido "só lacunas". Notas por dimensão num bloco recolhido ("Como a nota foi formada").
Observações do programa (`warnings`) em um rodapé neutro, não em alerta.

### Base — "Editor de texto" (`--w-full`, 2 colunas)
- Abas **CV** e **Perfil e regras**, cada uma com editor Markdown em mono à esquerda (numeração de linhas, realce leve de
  títulos `#`, `###` e `**negrito**`).
- À direita, **"Como o programa leu"**: para o CV, nome, contatos, experiências (empresa, cargo exato, período), projetos,
  formação e grupos de habilidades reconhecidos, com aviso quando uma experiência ficou sem cargo; para o perfil, as
  "Expressões a evitar" e o idioma do currículo. É o que as checagens usam.
- Barra fixa: contagem de caracteres, **Salvar** (`Ctrl/Cmd+S`), última alteração, Histórico (painel lateral com restaurar e
  comparar com a versão atual). Alterações não salvas avisam ao sair da página.

### Editor de currículo — "Dividido" (`--w-full`)
Formulário à esquerda e **folha A4 em tempo real à direita** a partir de 1280px, com rolagem independente e zoom (ajustar à
largura, 100%); abaixo disso mantém a alternância atual. Barra fixa no topo: nome, versão, situação, **cobertura de
palavras-chave** (barra + %, lista das ausentes ao clicar), **checagem contra a base** (erros e avisos clicáveis que levam ao
item e o destacam), **Salvar** e **Aprovar**. Erros e avisos ficam junto de cada item. Cargo, empresa e período aparecem como
**vindos da base**, porque mudá-los gera erro de checagem.

### Conta e Login (`--w-read`)
Conta: formulário simples, com a escolha de tema. Login e aceite de convite: fundo `canvas` com a marca, um único painel
central e o seletor de tema discreto no canto.

### O que não recebe a identidade
**PDF, DOCX, HTML exportados e a folha de pré-visualização** continuam neutros e compatíveis com ATS (ADR-0012). A folha
precisa corresponder ao arquivo exportado. Nenhum token da aplicação entra nos modelos de currículo.

---

## 5. Componentes (biblioteca em `components/ui`)

| Componente | Ação | Substitui |
|---|---|---|
| `Button`, `LinkButton` | Variantes `primary`, `secondary`, `ghost`, `danger`; tamanhos `sm`/`md`; estado `loading`; todos os estados da seção 3.7 | 5 cópias de `*LinkClass` |
| `IconButton` | Botão só com ícone, com `aria-label` obrigatório e tooltip | Botões de ícone soltos |
| `StatusBadge` | Só por estado semântico (seção 3.2) | `Badge` com `tone` livre |
| `ScoreBadge` | Nota + recomendação, tamanhos `inline` e `hero` | Bloco de nota em `AnalysisSection` |
| `EvidenceRail` | Trilho nos tamanhos `mini` e `full` | Novo |
| `CoverageMeter` | Barra + % de palavras-chave, com lista das ausentes | Parágrafo de cobertura no editor |
| `IssueList` | Erros e avisos de checagem, com link para o item | Listas locais do editor |
| `FlowSteps` | Linha do fluxo | Novo |
| `ProgressSteps` | Progresso por etapas das chamadas de IA | `LoadingStatus` nas ações longas |
| `Skeleton` | Blocos com a forma do conteúdo, animação suave (sem animação com movimento reduzido) | "Carregando…" |
| `Toast` | Avisos não bloqueantes, empilhados, com ação "Desfazer" | Alertas de sucesso fixos na página |
| `Tooltip` | Dica em hover e foco, com atraso de 400 ms | `title` nativo |
| `ThemeToggle` | Claro / Escuro / Sistema | Novo |
| `CommandSearch` | Busca de vagas por `Ctrl/Cmd+K` | Novo |
| `MarkdownEditor` | Editor mono com numeração, contagem, `Ctrl+S` e aviso de não salvo | `TextAreaField` na Base |
| `Disclosure` | Bloco recolhível único, com animação de altura respeitando movimento reduzido | 6 `<details>` à mão |
| `Tabs`, `Segmented` | Abas e filtro com contagem | Filtros com `SelectField` |
| `Panel`, `DataTable`, `EmptyState` | Superfícies, tabela densa com cabeçalho fixo e estados vazios | Blocos `border-dashed` e cards repetidos |
| `Alert` | Tons `error`, `attention`, `success`, `neutral` | Tom `info` azul |
| `MenuButton`, `Dialog` | Menu e diálogo com foco preso, `Esc` e posicionamento que não sai da tela | Âncora fixa à direita |
| `Field*` | Estados e tamanhos tokenizados, mesma API | Sem mudança de uso |
| `Mark` | Marca em SVG (claro e escuro) + `favicon.svg` | Texto solto `APP_NAME` |

---

## 6. Critérios de aceite globais

1. Nenhuma cor crua do Tailwind (`slate-`, `blue-` etc.) nem hex solto em `apps/web/src`, garantido por teste em
   `tests/architecture`; só tokens.
2. Uma ação `primary` por área visual; verde só em estados comprovados, recomendados ou aprovados (revisão visual).
3. Todo componente interativo cobre os estados da seção 3.7: verificado por uma página de catálogo de componentes
   (`/dev/componentes`, só em desenvolvimento) capturada nos dois temas.
4. Contraste real aprovado: axe com `color-contrast` ligado, em Chromium, em todas as páginas e **nos dois temas**.
5. Tema escuro sem piscar na carga e respeitando a preferência do sistema.
6. Nota, recomendação e próxima ação da vaga visíveis sem rolar em 1366×768.
7. Sem rolagem horizontal em 360px; navegação completa por teclado; foco sempre visível.
8. Orçamento da seção 3.9 cumprido e registrado (JS inicial, LCP, resposta a clique).
9. `pnpm check`, `pnpm test:integration` e `pnpm test:e2e` verdes.
10. Conteúdo e modelos dos arquivos exportados inalterados: nenhum teste de exportação modificado.
11. Nenhum dado real nas capturas ou fixtures: só a base sintética (`apps/api/test/helpers/scripted-provider.ts`).

---

## 7. Fases

Cada fase termina com os testes verdes e commit próprio. Commits em inglês, **somente com a identidade de Thiago, sem linha
de coautoria**, sem force push, e apenas quando ele pedir.

| # | Fase | Entrega | Depende de | Agente |
|---|---|---|---|---|
| 0 | Base de comparação | Harness Playwright com `page.route` e **dados sintéticos** (base, avaliação e currículo de exemplo; sem banco e sem tocar na Neon); capturas "antes" em 360/768/1366/1920; contagem de cliques do fluxo principal; medição do orçamento atual (JS, LCP) | Decisões da seção 9 | `visual-qa-reviewer` |
| 1 | Fundamentos | Tokens claro e escuro, script de tema sem piscar, fontes, `Mark`, favicon, biblioteca da seção 5 com todos os estados, catálogo `/dev/componentes`, `docs/design-system.md`, ADR-0016 | 0 | `design-system-lead` |
| 2 | Estrutura global | Barra lateral, barra superior, indicador de IA, seletor de tema, busca `Ctrl+K`, larguras, rotas sob demanda, transições de rota, toasts | 1 | `design-system-lead` |
| 3 | Dados de apoio | Nota, recomendação e composição do Trilho em `JobSummary`; `GET /api/resumes` recentes; `GET /api/profile/reading` (como o CV foi lido, via `parseBaseCv`); todos com isolamento por dono, casos cruzados e testes | 0 | `backend-implementer` |
| 4 | Fluxo de vagas | Início, Vagas, Vaga, Matriz da avaliação, currículos da vaga, formulário de vaga, pré-carregamento, esqueletos, atualização otimista, progresso por etapas, textos da seção 1 | 2, 3 | `workflow-ui-implementer` |
| 5 | Editor | Layout dividido com zoom, barra fixa com cobertura e checagens, `Ctrl+S`, navegação até o problema | 2 | `resume-editor-implementer` |
| 6 | Base e demais | Base em duas colunas com "Como o programa leu" e histórico, Conta, Login, Convite, 404 | 2, 3 | `base-ui-implementer` |
| 7 | Varredura | Migração das cores restantes, remoção de código morto, teste de arquitetura | 4, 5, 6 | `ui-migration-sweeper` |
| 8 | Portão final | Capturas "depois" nos dois temas, axe real nos dois temas, orçamento da seção 3.9, critérios da seção 6, revisão de coerência | 7 | `visual-qa-reviewer` → `final-architect-reviewer` |

**Paralelismo:** 3 pode correr junto com 1–2. 4, 5 e 6 correm em paralelo em worktrees separadas, pois tocam pastas
distintas; o orquestrador integra um por vez. O restante é sequencial.

**Pausas para Thiago conferir no navegador:** ao fim das fases 1 (catálogo de componentes nos dois temas), 2, 4, 5 e 6.

---

## 8. Agentes

O documento de produto pede para não acionar subagentes por padrão. Este plano os usa porque Thiago pediu explicitamente,
o que tem precedência. Só há delegação onde o trabalho é independente, e nada é duplicado.

### 8.1 Definições e modelos

| Agente | Situação | Modelo | Effort | Isolamento | Por quê |
|---|---|---|---|---|---|
| Orquestrador (sessão principal) | existente | Opus 5.5 (`claude-opus-5-5`) | high | — | Integra, decide conflitos e mantém a coerência |
| `design-system-lead` | **novo** | Opus 5.5 | high | branch principal | Tokens, temas, estados e componentes: um erro aqui se multiplica em todas as telas |
| `workflow-ui-implementer` | **novo** | Sonnet 5.5 (`claude-sonnet-5-5`) | high | worktree | Telas mais complexas (vaga e avaliação), sobre fundação pronta |
| `resume-editor-implementer` | **novo** | Sonnet 5.5 | high | worktree | Layout dividido e estado de edição delicado |
| `base-ui-implementer` | **novo** | Sonnet 5.5 | medium | worktree | Base, conta e autenticação: padrões já definidos |
| `ui-migration-sweeper` | **novo** | Haiku 5.5 (`claude-haiku-5-5`) | medium | branch principal | Trabalho mecânico com verificação por teste |
| `visual-qa-reviewer` | **novo** | Sonnet 5.5 | high | branch principal | Harness, capturas, axe real e orçamento; não altera telas |
| `backend-implementer` | existente | Sonnet 5.5 | high | worktree | Três extensões pequenas de API |
| `final-architect-reviewer` | existente | Opus 5.5 | xhigh | somente leitura | Portão final único, sem auditorias repetidas |

Não acionar: `security-reviewer` (a fase 3 reutiliza o isolamento já testado; acionar só se aparecer rota fora do padrão por
dono), `solution-architect` e `data-model-engineer` (sem mudança de modelo de dados).

### 8.2 Modelo de arquivo (`.claude/agents/<nome>.md`)

```yaml
---
name: workflow-ui-implementer
description: Implementa as telas de vagas, avaliação e currículos do Chameleon CV seguindo docs/PLANO_IDENTIDADE_VISUAL.md.
model: sonnet
effort: high
---
```

Corpo comum a todos: ler só as seções indicadas deste plano e `docs/design-system.md`; aplicar a skill
`personal-resume-workbench`; usar apenas tokens e componentes da biblioteca; **não criar variantes novas**, pedindo ao
orquestrador quando faltar algo; conferir cada tela nos dois temas; preservar nomes acessíveis usados nos testes; não fazer
commit nem push; relatar o que foi feito e o que não foi verificado.

### 8.3 Briefing por agente

- **`design-system-lead`** — Seções 2, 3, 5 e estrutura global da 4. Único autorizado a criar tokens e componentes. Entrega
  os dois temas, todos os estados da seção 3.7, o catálogo `/dev/componentes`, `design-system.md` e a ADR-0016. Não migra
  páginas além do necessário para validar os componentes.
- **`workflow-ui-implementer`** — Layouts Início, Vagas, Vaga e Avaliação, com as técnicas da seção 3.9 que cabem a elas.
  Arquivos: `features/home/HomePage`, `features/jobs/*`, `features/resumes/ResumesSection`, `DownloadMenu`, `features/ai/*`.
  Revisa os textos da seção 1. Não muda a ordem nem as regras da avaliação: elas vêm do servidor.
- **`resume-editor-implementer`** — Layout Editor. Arquivos: `ResumeEditorPage`, `ResumeForm`, `content.ts`. `ResumePreview`
  só muda de moldura: o conteúdo continua igual ao exportado, e a folha fica branca nos dois temas.
- **`base-ui-implementer`** — Layouts Base, Conta, autenticação e 404. Arquivos: `features/profile/**`,
  `features/home/AccountPage`, `NotFoundPage`, `features/auth/*`. Sem alterar regras de validação, consentimento ou sessão;
  o painel "Como o programa leu" só exibe o que a API devolve.
- **`ui-migration-sweeper`** — Substituir cores cruas restantes pela tabela de equivalência da fase 1; apagar constantes de
  estilo sem uso; escrever o teste de arquitetura. Sem decisão de design: caso ambíguo vai para o orquestrador.
- **`visual-qa-reviewer`** — Fase 0 e fase 8. Dados sempre sintéticos: **nunca capturar a base real, nunca usar a Neon,
  nunca versionar capturas com dados pessoais**. Mede o orçamento da seção 3.9. Reporta achados, não corrige.
- **`backend-implementer`** — Fase 3. Contratos opcionais (não invalidam dados salvos), escopo por `ownerId`, caso cruzado A/B
  em `tests/integration/isolation`, sem chamar IA nem enviar texto da vaga.
- **`final-architect-reviewer`** — Avaliar contra este plano, o documento de produto e a ADR-0015; **ignorar o plano V3
  citado na própria definição do agente**.

---

## 9. Decisões pendentes (Thiago)

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Aprovar o conceito (marca índigo para interação, verde só para evidência) | Aprovar. A paleta muda rápido depois da fase 1, o conceito não |
| D2 | Cor de marca | **Índigo** (`#4f46e5` / `#818cf8`): profissional, bem distante do verde de evidência e com bom contraste nos dois temas. Alternativas: azul-petróleo (`#0e7490`), que fica perto demais do verde; violeta (`#7c3aed`), mais chamativo |
| D3 | Navegação em barra lateral (padrão de painel) em vez de barra superior | Barra lateral: comporta a busca, o tema e o indicador de IA sem apertar, e recolhe para ícones |
| D4 | Fase 3 (nota e Trilho na lista, currículos recentes, leitura do CV) | Fazer. Sem ela, nota e Trilho só aparecem dentro da vaga e a Base não mostra o que o programa entendeu |
| D5 | Novas dependências: fontes Inter e JetBrains Mono auto-hospedadas | Aceitar. Alternativa: fonte do sistema, com perda de identidade |
| D6 | Configurar uma chave de IA antes da fase 8 | Configurar (Gemini é gratuita). As capturas usam dados sintéticos, mas a revisão final deve olhar uma avaliação real |

Resolvidas desde as versões anteriores: integração da `feat/analysis-and-home-ux` à `main` (feita no merge de 10/11),
PostgreSQL local (instalado; integração e E2E rodam) e o tema escuro (entrou no escopo).

**Fora do escopo:** temas além de claro e escuro, personalização de cores pelo usuário, animações decorativas, edição de
Markdown com formatação visual (WYSIWYG) e qualquer mudança nos arquivos exportados.

---

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Testes quebrarem em massa | Preservar nomes acessíveis; os seletores usam papel e nome |
| Agentes divergirem visualmente | Só `design-system-lead` cria tokens e componentes; teste de arquitetura; catálogo de componentes |
| Tema escuro esquecido em telas novas | Só tokens (teste impede cor crua); capturas e axe nos dois temas na fase 8 |
| Conflito na integração das worktrees | Pastas separadas; biblioteca congelada após a fase 2 |
| Painel fixo apertar em telas médias | Vira bloco no topo abaixo de 1024px; barra lateral recolhe; validado na fase 8 |
| Prévia dividida ficar lenta | Atualizar com valor adiado (`useDeferredValue`); sem salvar a cada tecla |
| Atualização otimista mostrar estado errado | Só em ações simples e reversíveis; reverte e avisa com toast em caso de erro |
| Espera da IA parecer travamento | `ProgressSteps` com as etapas reais; botão em estado `loading` com o texto da etapa |
| Avaliação real mais longa que a sintética | Testar a matriz com 30 requisitos e textos longos no harness da fase 0 |
| Peso das fontes e do JS | Só subset latin; rotas sob demanda; medir o bundle antes e depois |
