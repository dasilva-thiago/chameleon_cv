# Definição do produto — Chameleon CV

**Versão:** 2.0 · **Data:** 10/11/2026 · Fonte de verdade do escopo atual (substitui a versão 1.0 de 05/11/2026).

## 1. O que é

Uma ferramenta que **funciona como o career-ops**: a pessoa cola uma vaga e recebe, com base no que o sistema sabe sobre ela
e em IA, a **avaliação da vaga** e um **currículo adaptado** a ela, conferido contra os fatos da pessoa e exportável em
DOCX/PDF.

Hoje é usada por uma pessoa (Thiago), no próprio computador. A intenção é publicá-la depois, primeiro para uso próprio e
mais tarde para outras pessoas: por isso login, sessões, convites e isolamento por dono continuam, sem novos fluxos de
multiusuário por enquanto (cadastro aberto, organizações, cobrança e afins ficam fora até haver necessidade real).

## 2. Fluxo principal

1. **Base profissional**: dois textos em Markdown, editados no app, com histórico de versões.
   - **CV**: a única fonte de fatos (experiências, projetos, formação, habilidades, idiomas, cursos).
   - **Perfil e regras**: alvos, regras que barram vagas, faixas salariais por modalidade, política de local, como se
     apresentar por tipo de vaga, narrativa e regras de escrita (com a seção "Expressões a evitar").
2. **Vaga**: colar o texto (título, empresa e link opcionais) e acompanhar a situação da candidatura.
3. **Avaliação** (modo `oferta` do career-ops): nota 1-5, veredito e recomendação; tipo de vaga; regras quebradas; requisitos
   com importância e match (forte, parcial, faltando) com evidência citada da base; lacunas com risco e mitigação;
   palavras-chave; pretensão salarial sugerida; plano de adaptação.
4. **Currículo** (modo `pdf` do career-ops): título, resumo, competências e bullets reescritos com as palavras da vaga, só
   com fatos da base; checagens contra a base; cobertura das palavras-chave; edição, aprovação (imutável) e exportação.

## 3. Regras que não mudam

- **Nada inventado.** Cargo, empresa, datas, local, curso e links vêm sempre da base. Números, senioridade e expressões
  proibidas que a base não sustenta bloqueiam a aprovação; tecnologias fora da base geram aviso. "Palavras-chave são
  reformuladas, nunca fabricadas."
- **A vaga é dado não confiável**: nunca vira instrução para a IA.
- **Privacidade**: telefone e e-mail nunca vão para a IA; os dados ficam no banco da pessoa; nada pessoal no repositório
  (`fixtures-private/` é ignorada pelo git); logs e auditoria sem conteúdo.
- **Recomendação honesta**: abaixo de 4.0 o app desaconselha candidatar; regra quebrada = não recomendado.

## 4. Fora do escopo agora

Busca automática de vagas em portais, envio automático de candidaturas, rastreamento de entrevistas, cartas de
apresentação, pesquisa salarial na web, cadastro aberto, organizações, planos e cobrança.

## 5. Custos de IA

Provedores gratuitos primeiro (Gemini, Groq, Mistral, Cerebras, OpenRouter, GitHub Models), com teto diário. A avaliação
faz duas chamadas e é guardada: só roda de novo quando a vaga ou a base mudam (e, se só a base mudou, a leitura da vaga é
reaproveitada). O currículo faz uma chamada.

## 6. Precedência

Instrução mais recente da pessoa > este documento > [ADR-0015](decisions/ADR-0015-fluxo-career-ops-base-markdown.md) >
demais ADRs. Documentos antigos (perfil estruturado, plataforma universal, SaaS) estão no histórico do git e não autorizam
escopo.
