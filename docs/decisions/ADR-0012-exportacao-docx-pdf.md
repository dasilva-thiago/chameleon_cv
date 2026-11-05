# ADR-0012 — Exportação DOCX/PDF sem LibreOffice

**Status:** Aceita; implementada em 2026-11-05 (P4) com os desvios abaixo · 2026-11-04

## Contexto
O plano §4.8 sugere converter DOCX→PDF com LibreOffice headless, "quando suportado pelo ambiente", e exige: DOCX editável, PDF com texto selecionável e links, uma coluna, sem tabelas de layout, preview fiel e inspeção do resultado.

Verificado em 2026-11-04:
- LibreOffice, Microsoft Word e pandoc **ausentes**;
- Chromium do Playwright **presente** em cache (`chromium-1248`), revisão exigida pelo `playwright-core` 1.64.1;
- Chrome 157 e Edge 143 instalados.

## Decisão
- **Um único `RenderModel`** (blocos ordenados e tipados, independentes de layout), derivado do `ResumeContent` aprovado + `headerSelection`, alimenta dois renderizadores em `packages/documents`.
- **DOCX:** biblioteca `docx` 9.x (MIT).
  - Estilos nativos (Heading1/2, Normal, ListBullet), uma coluna, hyperlinks reais, fonte Arial, margens padrão.
  - Sem tabelas de layout e sem conteúdo essencial em cabeçalho ou rodapé.
  - Metadados (`creator`, `title`) sem PII além do nome.
- **PDF:** template HTML/CSS versionado (`templates/resume/<id>/<versão>`), **o mesmo usado no preview da web**, impresso por Playwright Chromium `page.pdf()`.
  - Formato A4 ou Letter, conforme o locale. Fonte Arimo embarcada (Apache-2.0, compatível em métrica com Arial, o que aproxima as quebras de linha do DOCX).
  - JavaScript desabilitado e conteúdo injetado como texto escapado.
  - Navegador headless com `--disable-gpu` e sem rede (`page.route('**', abort)` exceto `data:`).
  - Se o binário do Playwright estiver ausente, usa `channel: 'chrome'` (`PDF_BROWSER=bundled|chrome`).
- **Inspeção automática** (`packages/documents/src/inspect`), que gera o `DocumentExport.inspection`:
  - PDF: texto e número de páginas via `pdfjs-dist` ou `unpdf`; verificação de que o texto não está vazio, de que os links estão presentes como anotações e de que a contagem de páginas fica em ≤ 2, com aviso se o conteúdo exceder;
  - DOCX: abrir o zip, analisar `word/document.xml`, extrair texto com `mammoth`, verificar hyperlinks, ausência de tabelas e de imagens;
  - **equivalência textual:** a sequência normalizada de textos do `RenderModel` deve ser igual à do DOCX e à do PDF;
  - nenhum dado proibido (reusa o V10 do ADR-0011);
  - arquivo inválido ou vazio não é registrado e não muda o status para `exported` (plano §18).
- **Nome do arquivo:** `<Nome>_<Rótulo-localizado>_<Empresa>_<Cargo>_<AAAAMMDD>.<ext>`.
  - O nome vem do perfil, e não do piloto (corrige o plano l. 704–706).
  - Sanitização ASCII, com limite de tamanho e `Empresa_Nao_Informada` (ou o equivalente no locale) como fallback.

## Alternativas avaliadas

| Opção | Licença | Qualidade/ATS | Prós | Contras |
|---|---|---|---|---|
| DOCX + LibreOffice → PDF | MPL | alta, fiel ao DOCX | um único layout | **não instalado**; ~400 MB em produção |
| **docx + Chromium (HTML→PDF)** | MIT / Apache-2.0 + BSD | alta, texto e links nativos | o preview é igual ao PDF; já está disponível offline | dois renderizadores (mitigado pelo `RenderModel` e pelo teste de equivalência); Chromium em produção |
| docx + @react-pdf/renderer | MIT | boa | sem navegador | layout próprio diferente do preview HTML; fontes manuais |
| docx + pdfkit/pdf-lib | MIT | média | leve | quebra de linha, paginação e hifenização feitas à mão: alto custo de manutenção |
| Word COM (Windows) | proprietário | alta | — | Word ausente e não portável |
| Gotenberg | MIT | alta | — | exige Docker |

## Limitações (registradas, não mascaradas)
- Sem Word ou LibreOffice, **a paginação e a aparência do DOCX não são verificáveis por máquina**. Só a estrutura e o texto são verificados. O critério do plano "DOCX abre no Word/LibreOffice" depende de verificação manual (bloqueio do usuário), ou de instalar o LibreOffice depois e ativar `DOCX_VISUAL_CHECK=libreoffice`, que converte e compara o número de páginas.
- O DOCX e o PDF podem diferir em quebras de linha. A ordem e o conteúdo são garantidos pelo teste de equivalência.

## Verificação
- Testes de integração geram ambos os formatos para 3 fixtures de tamanhos diferentes.
- Verificação de páginas ≤ 2 quando o conteúdo permite, texto extraído igual ao do `RenderModel` e links presentes.
- Um teste com um campo contendo `<script>` mostra o texto literal no PDF.

## Implementação (2026-11-05, P4)
`packages/documents` tem `render-model.ts` (um `RenderModel` para os dois formatos), `docx.ts` (biblioteca `docx`), `html.ts` + `pdf.ts` (HTML com todo valor escapado e CSP restritiva, impresso por `playwright-core`/Chromium com JavaScript e rede desligados; navegadores tentados em ordem: Chromium do Playwright, Chrome, Edge; `PDF_BROWSER`, `PDF_BROWSER_PATH`). O teste do pacote confere, para DOCX e PDF, que o texto sai na ordem do `RenderModel`, que links reais existem (anotações no PDF, relações no DOCX), que não há tabelas/imagens, que conteúdo hostil (`<script>`, `<img>`) aparece como texto literal e que o PDF tem ≤ 2 páginas no exemplo.
Desvios do desenho original, registrados e não mascarados: **sem** fonte Arimo embarcada (usa Arial/Arimo/Liberation conforme instalado: quebras de linha podem diferir entre máquinas); **sem** pacote `inspect` em produção nem `DocumentExport` persistido (o arquivo é reproduzível do conteúdo aprovado, cujo hash é verificado a cada exportação; a auditoria guarda formato, versão e hash); a verificação visual do DOCX no Word/LibreOffice continua manual (limitação original mantida). Rota: `GET /api/resumes/:resumeId/versions/:versionId/export?format=docx|pdf` (somente versão aprovada).
