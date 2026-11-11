# ADR-0015 — Fluxo do career-ops: base em Markdown, avaliação e adaptação com IA

**Status:** Implementada · 2026-11-10 · Substitui as ADRs 0004, 0005, 0006, 0007, 0011 e 0013 (removidas; estão no histórico do git).

## Contexto

O objetivo do produto passou a ser **funcionar como o career-ops**: colar uma vaga e, com o que o sistema sabe sobre a pessoa e
IA, receber a avaliação da vaga e um currículo adaptado a ela. O desenho anterior tinha um perfil estruturado (ProfileFact,
26 tabelas tipadas, estados por campo, pendências, evidências, importação YAML/JSON com migração de versões) e uma IA que só
podia **escolher** itens prontos do perfil. Era caro de manter (~45 mil linhas de código, ~38 mil de testes) e não reescrevia
o texto para a vaga, que é o que torna o currículo do career-ops bom.

## Decisão

- **Base profissional em Markdown** (`ProfileBase` + `ProfileBaseRevision` imutável): dois textos que a pessoa edita no app.
  - **CV** (equivale ao `cv.md`): a única fonte de fatos.
  - **Perfil e regras** (equivale a `modes/_profile.md` + `modes/_custom.md`): alvos, regras que barram vagas, faixas
    salariais, política de local, enquadramento por tipo de vaga, regras de escrita, "Expressões a evitar". Não traz fatos.
- **Avaliação** (`modes/oferta.md`), duas chamadas de IA:
  1. só a vaga: resumo, requisitos com importância (`critical`…`low_signal`) e nível de evidência (`stated`/`structural`/
     `inferred`), palavras-chave — a importância nunca olha o candidato (regra das duas passadas);
  2. vaga + base: tipo de vaga, regras quebradas, match por requisito com evidência citada, lacunas com mitigação, notas por
     dimensão, nota global 1-5, veredito, pretensão salarial, plano de adaptação.
  O programa confere (`@chameleon/domain`, `finalizeAnalysis`): citação `stated` precisa existir na vaga, `inferred` nunca é
  `critical`/`high`, evidência de um `strong` precisa existir na base (senão vira `partial`), regra que barra precisa de
  citação literal, e a recomendação sai da nota (4.0+ candidatar, 3.5-3.9 só com motivo, abaixo não; regra quebrada = não).
  A leitura da vaga é reaproveitada quando só a base muda.
- **Currículo** (`modes/pdf.md`), uma chamada: a IA escreve título, resumo, competências, bullets e grupos de habilidades e
  escolhe os projetos. O programa monta o documento mantendo **da base** cargo, empresa, datas, local, curso e links, com
  todas as experiências na ordem da base, e roda as checagens portadas do career-ops: números fora da base, cargo diferente,
  senioridade, expressões a evitar (erros, bloqueiam a aprovação); tecnologias/palavras-chave fora da base, ordem, empresa
  desconhecida (avisos). Mede a cobertura das palavras-chave da vaga. Sem IA, o currículo sai como a base, sem adaptação.
- **Privacidade:** telefone e e-mail são removidos de todo prompt (o cabeçalho do currículo vem da base, não da IA). Faixas
  salariais do perfil vão à IA, porque a pretensão salarial depende delas. Vaga é dado não confiável, cercada no prompt.
- **Mantido:** autenticação, sessões, convites, isolamento por dono (`forOwner`, FKs compostas, ownerId imutável), consentimentos,
  auditoria sem conteúdo, roteador multi-provedor com limites diários, versões de currículo com aprovação imutável, DOCX/PDF.

## Alternativas consideradas

- Manter o perfil estruturado e só simplificar o formato: menos remoção, mas a IA continuaria presa a itens prontos.
- Rastreabilidade por item (`sourceIds`): trocada pelas checagens contra o texto da base, como no career-ops.

## Consequências

- A avaliação **exige** um provedor de IA configurado (`GEMINI_API_KEY` etc.) e o consentimento de IA da conta.
- Migração `20261110120000_profile_base_markdown`: remove as tabelas do perfil estruturado e **apaga avaliações e currículos
  do formato antigo** (as vagas ficam). Fazer backup antes de aplicar em produção.
- Verificação: `packages/domain/test/domain.test.ts`, `packages/ai/test/ai.test.ts`, `apps/api/test/{profile,ai,resumes}.int.test.ts`,
  `tests/integration/isolation/*`, `e2e/resume-flow.spec.ts`.
