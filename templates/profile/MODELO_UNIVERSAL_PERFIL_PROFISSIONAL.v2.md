# Modelo universal de perfil profissional

**Versão do modelo:** 2.1.0 <!-- path: schema_version -->
**Idioma do perfil (BCP-47, ex.: pt-BR):** `[Preencher]` <!-- path: locale -->
**Finalidade:** reunir, de forma estruturada e verificável, a trajetória de uma pessoa para que uma ferramenta produza currículos personalizados para vagas específicas.
**Público:** qualquer pessoa, de qualquer área, senioridade, formação, país ou tempo de experiência.

> **Importante:** este documento é um formulário de coleta, não um currículo. Preencha o que fizer sentido para a sua trajetória e **apague as instruções que não usar**. Não invente informações para preencher lacunas.

**Como esta versão funciona com a aplicação**

- Cada campo termina com uma anotação em comentário HTML (a palavra `path:` seguida do caminho do campo, invisível quando o arquivo é exibido). Ela liga o campo ao contrato 2.1.0 e é o que permite importar este Markdown. **Não apague nem altere as anotações.**
- Tudo o que for importado entra como _precisa de revisão_ (`needs_review`). Você confirma depois, na aplicação.
- Este modelo substitui o formulário 1.0.0, que fica como referência histórica.

---

# 1. Como preencher este modelo

## 1.1 Regras gerais

1. Seja específico. Em vez de “desenvolvimento de sistemas” ou “atendimento”, descreva o tipo de trabalho, o problema, sua participação, as ferramentas e o resultado.
2. Registre fatos, não só adjetivos. “Boa comunicação” vale menos do que explicar com quem você se comunicava e para resolver o quê.
3. Diferencie experiência profissional, projeto pessoal, atividade acadêmica, voluntariado, estudo e conhecimento conceitual.
4. Em trabalhos em equipe, registre a **sua** contribuição. Não atribua a você entregas de outras pessoas.
5. Informe datas com a precisão que realmente tiver (`AAAA`, `AAAA-MM` ou `AAAA-MM-DD`). Se só souber o ano, escreva só o ano. Para “até hoje”, use `present` no fim do período.
6. Não invente números, percentuais, volumes, resultados, ferramentas, clientes, cargos ou níveis de domínio.
7. **Campo que você não souber ou não quiser preencher:** deixe `[Preencher]`, em branco ou com `_`. O importador entende como _não informado_ (`null`). **Não escreva “Não informado”**: esse texto seria gravado como se fosse um dado e poderia aparecer no currículo.
8. Quando a resposta for um **estado explícito**, escreva um destes marcadores no lugar do valor:
   - `(não se aplica)` — o campo não faz sentido para o seu caso (`not_applicable`);
   - `(prefiro não informar)` — você decidiu não responder e não quer ser perguntado de novo (`declined`);
   - `(ainda não avaliei)` — você ainda não sabe estimar (`not_assessed`);
   - `(confirmar depois)` — o valor informado precisa de confirmação (`needs_confirmation`).
     Ausência de dado nunca significa “não tenho essa experiência”.
9. Sempre que possível, associe afirmações importantes a uma **evidência** (seção 18) e indique o id dela no campo “Evidências”.
10. Use **ids locais** (ex.: `EXP-001`, `PRJ-001`, `SKL-001`) para ligar registros. O id é opcional e livre; a aplicação o troca por um identificador próprio.
11. Atualize o perfil quando mudar de cargo, concluir um curso ou finalizar um projeto.

## 1.2 O que é uma evidência

Uma evidência é uma fonte que ajuda a verificar uma afirmação: repositório, portfólio, certificado, histórico, contrato, publicação, apresentação, indicador documentado ou referência profissional autorizada. Não é preciso anexar documentos confidenciais; basta indicar o tipo e um link público ou uma descrição não sensível.

## 1.3 Níveis de conhecimento (autoavaliação)

Use sempre como autoavaliação, nunca como certificação:

- `not_assessed` — não quer ou não consegue estimar;
- `exposure` — contato inicial; acompanhou ou entende o propósito;
- `basic` — executa tarefas simples com orientação ou consulta frequente;
- `intermediate` — realiza tarefas comuns de forma relativamente independente;
- `advanced` — resolve problemas complexos, decide e orienta outras pessoas;
- `expert` — profundidade excepcional e histórico consistente. Use com muita cautela.

Além do nível, informe **onde** o conhecimento foi usado (seção 8.2).

## 1.4 Privacidade

Não inclua CPF, RG, passaporte, endereço residencial completo, dados bancários, senhas, informações de saúde, religião, opinião política ou outros dados sensíveis. Para currículos, em geral bastam nome, cidade/região, e-mail, telefone e links profissionais.

Disponibilidade, expectativa salarial, preferências de carreira, regras pessoais de uso, pronomes, motivo de saída e observações privadas são **privados por construção**: nunca entram automaticamente no currículo nem são enviados a serviços de IA.

## 1.5 Governança de cada registro

Ao final dos registros principais há um bloco **“Governança deste registro”**. Ele é opcional:

- **Pode aparecer em currículos?** `allowed` (sim), `requires_approval` (somente com a sua aprovação a cada uso) ou `never` (nunca);
- **Visibilidade:** `public`, `private` ou `conditional` (só em candidaturas escolhidas por você);
- **Evidências:** ids da seção 18 que sustentam o registro;
- **Observações privadas:** notas só suas.

Se não preencher, a aplicação aplica os padrões do importador e marca o registro para revisão.

---

# 2. Identificação e contatos (itens 1 do escopo)

## 2.1 Identificação

- **Nome completo:** `[Preencher]` <!-- path: profile.identity.full_name -->
- **Nome de uso/profissional (se diferente):** `[Preencher]` <!-- path: profile.identity.preferred_name -->
- **Pronúncia do nome (opcional):** `[Preencher]` <!-- path: profile.identity.pronunciation -->
- **Pronomes (opcional; privado, não vai ao currículo):** `[Preencher]` <!-- path: profile.identity.pronouns -->
- **País de residência:** `[Preencher]` <!-- path: profile.identity.country_of_residence -->
- **Cidade:** `[Preencher]` <!-- path: profile.identity.city -->
- **Estado/província/região:** `[Preencher]` <!-- path: profile.identity.region -->
- **Países onde pretende trabalhar (lista):** `[Preencher]` <!-- path: profile.identity.countries_of_work_interest -->
- **Fuso horário (opcional; ex.: America/Sao_Paulo):** `[Preencher]` <!-- path: profile.identity.timezone -->
- **Idiomas preferidos para a interface e a comunicação (BCP-47, lista):** `[Preencher]` <!-- path: profile.identity.interface_languages -->

Visibilidade de cada dado de identificação (`public`, `private` ou `conditional`):

- **Nome completo:** `[Preencher]` <!-- path: profile.identity.field_visibility.full_name -->
- **Nome de uso:** `[Preencher]` <!-- path: profile.identity.field_visibility.preferred_name -->
- **Pronúncia:** `[Preencher]` <!-- path: profile.identity.field_visibility.pronunciation -->
- **País de residência:** `[Preencher]` <!-- path: profile.identity.field_visibility.country_of_residence -->
- **Cidade:** `[Preencher]` <!-- path: profile.identity.field_visibility.city -->
- **Região:** `[Preencher]` <!-- path: profile.identity.field_visibility.region -->
- **Fuso horário:** `[Preencher]` <!-- path: profile.identity.field_visibility.timezone -->

## 2.2 Contatos profissionais

**Repita este bloco para cada contato** (e-mail, telefone ou link). Você pode ter várias versões de contato.

### Contato — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.contact_points[].id -->
- **Tipo:** `email`, `phone` ou `link` <!-- path: profile.contact_points[].kind -->
- **Subtipo:** `professional`, `personal`, `mobile`, `landline`, `whatsapp`, `linkedin`, `github`, `gitlab`, `bitbucket`, `portfolio`, `website`, `behance`, `dribbble`, `artstation` ou `other` <!-- path: profile.contact_points[].subtype -->
- **Valor** (e-mail; telefone em qualquer formato comum, como `(12) 91234-5678` ou `+55 12 91234-5678` — o sistema guarda só os dígitos; ou URL `https://...`): `[Preencher]` <!-- path: profile.contact_points[].value -->
- **Rótulo (opcional):** `[Preencher]` <!-- path: profile.contact_points[].label -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.contact_points[].visibility -->
- **Incluir por padrão no cabeçalho do currículo?** `true` ou `false` <!-- path: profile.contact_points[].include_by_default -->
- **É o contato principal deste tipo?** `true` ou `false` <!-- path: profile.contact_points[].is_primary -->
- **Observações:** `[Preencher]` <!-- path: profile.contact_points[].notes -->

---

# 3. Posicionamento, resumo, narrativa e objetivos (item 2 do escopo)

Esta seção ajuda a ferramenta a entender como você se apresenta, sem limitá-la a um único título.

## 3.1 Posicionamento atual

- **Área ou profissão atual:** `[Preencher]` <!-- path: profile.positioning.current_profession -->
- **Cargo atual (se houver):** `[Preencher]` <!-- path: profile.positioning.current_job_title -->
- **Senioridade atual:** `student`, `entry`, `junior`, `mid`, `senior`, `specialist`, `lead`, `manager`, `executive` ou `not_assessed` <!-- path: profile.positioning.current_seniority -->
- **Como gostaria de se apresentar profissionalmente (uma linha):** `[Preencher]` <!-- path: profile.positioning.professional_headline -->

## 3.2 Textos de apresentação

Cada texto é um registro próprio (pode ser citado como fonte de uma afirmação). A IA pode propor versões, mas não acrescenta fatos não registrados.

**Repita para cada texto:** apresentação de uma frase (`one_sentence_intro`), resumo curto de até 500 caracteres (`short_summary`), resumo completo (`full_summary`), narrativa de carreira (`career_narrative`, privada por padrão), diferenciais comprováveis (`differentiator`, um por registro) e valores e critérios de trabalho (`value`, um por registro).

### Texto — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.statements[].id -->
- **Tipo:** `one_sentence_intro`, `short_summary`, `full_summary`, `career_narrative`, `differentiator` ou `value` <!-- path: profile.statements[].kind -->
- **Texto:** `[Preencher]` <!-- path: profile.statements[].text -->
- **Idioma do texto (BCP-47, opcional):** `[Preencher]` <!-- path: profile.statements[].locale -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.statements[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.statements[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.statements[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.statements[].meta.private_notes -->

## 3.3 Competências comportamentais com exemplos

Não basta marcar uma competência: explique uma situação em que ela foi demonstrada (comunicação, colaboração, organização, resolução de problemas, autonomia, liderança, adaptabilidade, pensamento analítico, atenção a detalhes, relacionamento com clientes/usuários, entre outras). Adicione só as que conseguir exemplificar.

### Exemplo — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.competency_examples[].id -->
- **Competência:** `[Preencher]` <!-- path: profile.competency_examples[].competency -->
- **Situação concreta:** `[Preencher]` <!-- path: profile.competency_examples[].situation -->
- **Ação realizada:** `[Preencher]` <!-- path: profile.competency_examples[].action -->
- **Resultado ou aprendizado:** `[Preencher]` <!-- path: profile.competency_examples[].outcome_or_learning -->
- **Competências do catálogo relacionadas (ids da seção 8.1):** `[Preencher]` <!-- path: profile.competency_examples[].related_skill_ids -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.competency_examples[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.competency_examples[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.competency_examples[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.competency_examples[].meta.private_notes -->

---

# 4. Experiências profissionais (itens 4 e 15 do escopo)

**Repita esta seção para cada vínculo, emprego, estágio, contrato, trabalho autônomo, freelance ou negócio próprio.** Para promoções ou mudanças de função na mesma organização, crie um registro por cargo e use o mesmo valor em “Grupo da organização”.

Trabalho **autônomo, freelance ou empreendedor**: use esta mesma seção, com tipo de vínculo `freelance`, `self_employed` ou `business_owner`, e preencha o bloco 4.8. Entregas pontuais e independentes podem ficar em Projetos (seção 5).

## Experiência — registro 1

### 4.1 Identificação do vínculo

- **Id local (opcional; ex.: EXP-001):** `[Preencher]` <!-- path: profile.experiences[].id -->
- **Empresa/organização (ou nome do negócio):** `[Preencher]` <!-- path: profile.experiences[].organization_name -->
- **Nome público da organização (se diferente; use quando o nome real for confidencial):** `[Preencher]` <!-- path: profile.experiences[].organization_public_name -->
- **Grupo da organização (mesmo valor em vários cargos do mesmo empregador):** `[Preencher]` <!-- path: profile.experiences[].organization_group -->
- **Setor/indústria:** `[Preencher]` <!-- path: profile.experiences[].industry -->
- **Cidade:** `[Preencher]` <!-- path: profile.experiences[].location.city -->
- **Estado/região:** `[Preencher]` <!-- path: profile.experiences[].location.region -->
- **País:** `[Preencher]` <!-- path: profile.experiences[].location.country -->
- **Cargo oficial registrado:** `[Preencher]` <!-- path: profile.experiences[].official_title -->
- **Título usado no currículo (se diferente; nunca deve falsear o cargo oficial):** `[Preencher]` <!-- path: profile.experiences[].display_title -->
- **Tipo de vínculo:** `employee`, `internship`, `apprenticeship`, `contractor`, `freelance`, `self_employed`, `business_owner`, `temporary`, `public_service`, `volunteer` ou `other` <!-- path: profile.experiences[].employment_type -->
- **Área/departamento:** `[Preencher]` <!-- path: profile.experiences[].department -->
- **Gestor ou equipe (opcional; não inclua dados de terceiros sem autorização):** `[Preencher]` <!-- path: profile.experiences[].manager_or_team -->
- **Jornada (opcional):** `[Preencher]` <!-- path: profile.experiences[].workload -->
- **Data de início (AAAA, AAAA-MM ou AAAA-MM-DD):** `[Preencher]` <!-- path: profile.experiences[].start_date -->
- **Data de término (AAAA, AAAA-MM, AAAA-MM-DD ou `present` se for o trabalho atual):** `[Preencher]` <!-- path: profile.experiences[].end_date -->
- **Modalidade:** `onsite`, `hybrid` ou `remote` <!-- path: profile.experiences[].work_mode -->

### 4.2 Contexto da função

- **Resumo da empresa ou da área:** `[Preencher]` <!-- path: profile.experiences[].company_context -->
- **Objetivo do cargo (responsabilidade central):** `[Preencher]` <!-- path: profile.experiences[].role_objective -->
- **Produtos, serviços, clientes ou usuários atendidos (sem expor dados confidenciais):** `[Preencher]` <!-- path: profile.experiences[].products_services_users -->
- **Tamanho/escopo da operação (somente se conhecido e autorizado):** `[Preencher]` <!-- path: profile.experiences[].operational_scope -->
- **Equipes e áreas com as quais interagia (lista):** `[Preencher]` <!-- path: profile.experiences[].team_interfaces -->

### 4.3 Responsabilidades e atividades

Liste atividades realmente executadas. **Repita o bloco para cada atividade.**

- **Id local (opcional):** `[Preencher]` <!-- path: profile.experiences[].items[].id -->
- **Tipo do item:** `responsibility` <!-- path: profile.experiences[].items[].kind -->
- **Atividade (ação + contexto + finalidade):** `[Preencher]` <!-- path: profile.experiences[].items[].text -->
- **Frequência:** `daily`, `weekly`, `occasional` ou `project_based` <!-- path: profile.experiences[].items[].frequency -->
- **Autonomia:** `supervised`, `partial`, `independent` ou `not_assessed` <!-- path: profile.experiences[].items[].autonomy -->
- **Resultado ou entrega:** `[Preencher]` <!-- path: profile.experiences[].items[].outcome -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.experiences[].items[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.experiences[].items[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.experiences[].items[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.experiences[].items[].meta.private_notes -->

As ferramentas, sistemas e conhecimentos usados nas atividades são registrados na seção 8 (competências e contexto de uso), ligados a esta experiência.

### 4.4 Projetos e entregas dentro da experiência

**Repita o bloco para cada entrega importante.**

- **Id local (opcional):** `[Preencher]` <!-- path: profile.experiences[].items[].id -->
- **Tipo do item:** `delivery` <!-- path: profile.experiences[].items[].kind -->
- **Nome ou descrição da entrega:** `[Preencher]` <!-- path: profile.experiences[].items[].text -->
- **Problema ou necessidade:** `[Preencher]` <!-- path: profile.experiences[].items[].problem -->
- **Sua contribuição individual:** `[Preencher]` <!-- path: profile.experiences[].items[].personal_contribution -->
- **Pessoas/áreas envolvidas (lista):** `[Preencher]` <!-- path: profile.experiences[].items[].collaborators -->
- **Etapas executadas (lista):** `[Preencher]` <!-- path: profile.experiences[].items[].steps -->
- **Resultado observado:** `[Preencher]` <!-- path: profile.experiences[].items[].outcome -->
- **Como o resultado foi verificado:** `[Preencher]` <!-- path: profile.experiences[].items[].verification -->
- **Pode ser divulgada publicamente?** `allowed` (sim), `requires_approval` (parcialmente/com aprovação) ou `never` (não) <!-- path: profile.experiences[].items[].meta.resume_use -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.experiences[].items[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.experiences[].items[].meta.private_notes -->

### 4.5 Conquistas e resultados mensuráveis

Registre somente números que possam ser explicados e sustentados. Se não houver métricas, descreva a entrega de forma qualitativa. **Repita o bloco para cada conquista.**

- **Id local (opcional):** `[Preencher]` <!-- path: profile.experiences[].items[].id -->
- **Tipo do item:** `achievement` <!-- path: profile.experiences[].items[].kind -->
- **Conquista ou resultado:** `[Preencher]` <!-- path: profile.experiences[].items[].text -->
- **Indicador (ex.: volume, prazo, custo, qualidade):** `[Preencher]` <!-- path: profile.experiences[].items[].metric.name -->
- **Valor (com unidade):** `[Preencher]` <!-- path: profile.experiences[].items[].metric.value -->
- **Valor anterior (linha de base, se conhecido):** `[Preencher]` <!-- path: profile.experiences[].items[].metric.baseline -->
- **Período medido:** `[Preencher]` <!-- path: profile.experiences[].items[].metric.period -->
- **Método de cálculo:** `[Preencher]` <!-- path: profile.experiences[].items[].metric.method -->
- **Sua participação no resultado:** `[Preencher]` <!-- path: profile.experiences[].items[].personal_contribution -->
- **Pode ser divulgada?** `allowed` (sim), `requires_approval` (parcialmente/com aprovação) ou `never` (não) <!-- path: profile.experiences[].items[].meta.resume_use -->
- **Fonte/evidência (ids):** `[Preencher]` <!-- path: profile.experiences[].items[].meta.evidence_ids -->

### 4.6 Tecnologias, conhecimentos e competências utilizados

Não há lista de tecnologias dentro da experiência: cadastre cada uma na seção 8.1 e registre o uso na seção 8.2, informando **esta experiência** como fonte (`experience_id`).

### 4.7 Encerramento e observações

- **Motivo de saída (privado e opcional):** `[Preencher]` <!-- path: profile.experiences[].exit_reason -->
- **Aprendizados relevantes (lista):** `[Preencher]` <!-- path: profile.experiences[].lessons_learned -->
- **Competências transferíveis (lista):** `[Preencher]` <!-- path: profile.experiences[].transferable_skills -->
- **Pode ser contatado como referência?** `allowed`, `not_allowed` ou `ask_first` (dados de referência ficam separados e protegidos) <!-- path: profile.experiences[].reference_contact_permission -->

### 4.8 Trabalho autônomo, freelance ou negócio próprio

Preencha somente se este registro for atividade autônoma ou empreendedora.

- **Atividade/serviço:** `[Preencher]` <!-- path: profile.experiences[].business.activity -->
- **Tipo de cliente ou mercado (sem expor dados confidenciais):** `[Preencher]` <!-- path: profile.experiences[].business.client_market_description -->
- **Escopo dos serviços (lista):** `[Preencher]` <!-- path: profile.experiences[].business.services_scope -->
- **Quantidade de projetos/clientes (somente se confirmada e autorizada):** `[Preencher]` <!-- path: profile.experiences[].business.client_count -->
- **Portfólio (URL):** `[Preencher]` <!-- path: profile.experiences[].business.portfolio_url -->

Responsabilidades pessoais, entregas e resultados verificáveis deste trabalho entram como itens (4.3, 4.4 e 4.5). Para proteger **nomes de clientes**, preencha “Nome público da organização” em 4.1 e/ou crie uma restrição na seção 20.

### 4.9 Governança deste registro

- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.experiences[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.experiences[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.experiences[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.experiences[].meta.private_notes -->

---

# 5. Projetos (item 5 do escopo)

**Repita para cada projeto pessoal, acadêmico, open source, freelance, profissional, voluntário, de pesquisa ou empreendedor.** Projetos não devem ser confundidos com vínculos empregatícios.

## Projeto — registro 1

### 5.1 Identificação

- **Id local (opcional; ex.: PRJ-001):** `[Preencher]` <!-- path: profile.projects[].id -->
- **Nome do projeto:** `[Preencher]` <!-- path: profile.projects[].name -->
- **Categoria:** `personal`, `academic`, `open_source`, `freelance`, `professional`, `research`, `volunteer`, `entrepreneurial` ou `other` <!-- path: profile.projects[].category -->
- **Status:** `idea`, `in_progress`, `active`, `completed` ou `archived` <!-- path: profile.projects[].status -->
- **Data de início:** `[Preencher]` <!-- path: profile.projects[].start_date -->
- **Data de conclusão (ou `present` se continua em andamento):** `[Preencher]` <!-- path: profile.projects[].end_date -->
- **Última atualização:** `[Preencher]` <!-- path: profile.projects[].last_updated -->
- **Website/demonstração (URL):** `[Preencher]` <!-- path: profile.projects[].demo_url -->
- **Endereço público do projeto (URL):** `[Preencher]` <!-- path: profile.projects[].public_url -->
- **Repositório (URL):** `[Preencher]` <!-- path: profile.projects[].repository_url -->
- **Documentação (URL):** `[Preencher]` <!-- path: profile.projects[].documentation_url -->
- **Projeto público?** `public` (sim), `partial` (parcialmente) ou `not_public` (não) <!-- path: profile.projects[].public_access -->
- **Licença (se aplicável):** `[Preencher]` <!-- path: profile.projects[].license -->
- **Experiência a que o projeto está ligado (id da seção 4, se houver):** `[Preencher]` <!-- path: profile.projects[].related_experience_id -->
- **Formação a que o projeto está ligado (id da seção 6, se houver):** `[Preencher]` <!-- path: profile.projects[].related_education_id -->

### 5.2 Participação e autoria

- **Seu papel (sem exagerar o cargo):** `[Preencher]` <!-- path: profile.projects[].role -->
- **Projeto em equipe?** `true` ou `false` <!-- path: profile.projects[].team_based -->
- **Sua contribuição exata (o que implementou, decidiu, documentou, testou ou entregou):** `[Preencher]` <!-- path: profile.projects[].personal_contribution -->
- **Partes feitas por outras pessoas (para delimitar autoria):** `[Preencher]` <!-- path: profile.projects[].contributions_by_others -->
- **Responsabilidade por decisões/arquitetura (o que foi decidido por você):** `[Preencher]` <!-- path: profile.projects[].decision_ownership -->

**Integrantes (opcional).** Repita o bloco para cada integrante:

- **Id local (opcional):** `[Preencher]` <!-- path: profile.projects[].collaborators[].id -->
- **Nome ou papel:** `[Preencher]` <!-- path: profile.projects[].collaborators[].name_or_role -->
- **Contribuição:** `[Preencher]` <!-- path: profile.projects[].collaborators[].contribution -->

### 5.3 Problema e solução

- **Problema que motivou o projeto:** `[Preencher]` <!-- path: profile.projects[].problem -->
- **Público-alvo ou usuários:** `[Preencher]` <!-- path: profile.projects[].target_audience -->
- **Necessidade atendida:** `[Preencher]` <!-- path: profile.projects[].need_addressed -->
- **Proposta de solução:** `[Preencher]` <!-- path: profile.projects[].proposed_solution -->
- **Arquitetura ou abordagem geral:** `[Preencher]` <!-- path: profile.projects[].architecture -->
- **Autenticação, autorização ou controle de acesso (se aplicável):** `[Preencher]` <!-- path: profile.projects[].authentication_authorization -->

### 5.4 Itens do projeto

Funcionalidades, contribuições, entregas, resultados, métricas, regras de negócio, fluxos, decisões, testes e integrações são **itens** do projeto. **Repita o bloco para cada item.**

- **Id local (opcional):** `[Preencher]` <!-- path: profile.projects[].items[].id -->
- **Tipo do item:** `feature`, `contribution`, `deliverable`, `outcome`, `metric`, `business_rule`, `workflow`, `decision`, `test` ou `integration` <!-- path: profile.projects[].items[].kind -->
- **Descrição:** `[Preencher]` <!-- path: profile.projects[].items[].text -->
- **Se for métrica — indicador:** `[Preencher]` <!-- path: profile.projects[].items[].metric.name -->
- **Se for métrica — valor (com unidade):** `[Preencher]` <!-- path: profile.projects[].items[].metric.value -->
- **Se for métrica — valor anterior:** `[Preencher]` <!-- path: profile.projects[].items[].metric.baseline -->
- **Se for métrica — período:** `[Preencher]` <!-- path: profile.projects[].items[].metric.period -->
- **Se for métrica — método e fonte:** `[Preencher]` <!-- path: profile.projects[].items[].metric.method -->
- **Pode ser divulgado?** `allowed`, `requires_approval` ou `never` <!-- path: profile.projects[].items[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.projects[].items[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.projects[].items[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.projects[].items[].meta.private_notes -->

### 5.5 Tecnologias e nível de participação

Não há tabela de tecnologias dentro do projeto: cadastre cada uma na seção 8.1 e registre o uso na seção 8.2 com este projeto como fonte (`project_id`). Use o campo “faceta” para separar partes do projeto (ex.: interface, dados, infraestrutura, atendimento, planejamento).

### 5.6 Resultados, qualidade e limitações

- **Feedback recebido (lista; indique se é qualitativo ou quantitativo):** `[Preencher]` <!-- path: profile.projects[].feedback -->
- **Limitações conhecidas (lista):** `[Preencher]` <!-- path: profile.projects[].known_limitations -->
- **Próximas melhorias (lista):** `[Preencher]` <!-- path: profile.projects[].next_improvements -->
- **O que aprendeu (lista):** `[Preencher]` <!-- path: profile.projects[].learning -->

### 5.7 Versão resumida para currículo

- **Descrição em uma linha:** `[Preencher]` <!-- path: profile.projects[].one_line_description -->
- **Descrição em até 500 caracteres:** `[Preencher]` <!-- path: profile.projects[].short_description -->
- **Palavras-chave tecnicamente corretas (lista):** `[Preencher]` <!-- path: profile.projects[].resume_keywords -->

### 5.8 Governança deste registro

- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.projects[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.projects[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.projects[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.projects[].meta.private_notes -->

---

# 6. Formação acadêmica (item 6 do escopo)

**Repita para cada ensino médio, curso técnico, tecnólogo, graduação, especialização, MBA, mestrado, doutorado ou pós-doutorado.**

## Formação — registro 1

- **Id local (opcional; ex.: EDU-001):** `[Preencher]` <!-- path: profile.education[].id -->
- **Instituição:** `[Preencher]` <!-- path: profile.education[].institution -->
- **Nome oficial do curso:** `[Preencher]` <!-- path: profile.education[].course_name -->
- **Tipo:** `secondary`, `technical`, `associate`, `bachelor`, `specialization`, `mba`, `masters`, `doctorate`, `postdoc` ou `other` <!-- path: profile.education[].degree_type -->
- **Área de conhecimento:** `[Preencher]` <!-- path: profile.education[].field_of_study -->
- **Situação:** `completed`, `in_progress`, `suspended` ou `incomplete` <!-- path: profile.education[].status -->
- **Data de início:** `[Preencher]` <!-- path: profile.education[].start_date -->
- **Data de conclusão:** `[Preencher]` <!-- path: profile.education[].completion_date -->
- **Previsão de conclusão (se em andamento):** `[Preencher]` <!-- path: profile.education[].expected_completion_date -->
- **Modalidade:** `onsite`, `online` ou `hybrid` <!-- path: profile.education[].modality -->
- **Localização:** `[Preencher]` <!-- path: profile.education[].location -->
- **Título obtido:** `[Preencher]` <!-- path: profile.education[].qualification_awarded -->
- **Trabalho de conclusão, tese ou dissertação — título:** `[Preencher]` <!-- path: profile.education[].thesis_title -->
- **Trabalho de conclusão, tese ou dissertação — descrição:** `[Preencher]` <!-- path: profile.education[].thesis_description -->
- **Orientador (opcional):** `[Preencher]` <!-- path: profile.education[].supervisor -->
- **Disciplinas relevantes (lista):** `[Preencher]` <!-- path: profile.education[].relevant_coursework -->
- **Projetos acadêmicos relevantes (lista de nomes; ou use a seção 5 com “formação” ligada):** `[Preencher]` <!-- path: profile.education[].academic_projects -->
- **Honrarias, bolsas ou distinções (lista):** `[Preencher]` <!-- path: profile.education[].honors_scholarships_distinctions -->
- **Link para comprovação pública (opcional):** `[Preencher]` <!-- path: profile.education[].verification_url -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.education[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.education[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.education[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.education[].meta.private_notes -->

---

# 7. Cursos, treinamentos e educação complementar (item 7 do escopo)

**Repita para cada curso, bootcamp, imersão, treinamento, workshop ou programa de formação.**

## Curso — registro 1

- **Id local (opcional; ex.: CRS-001):** `[Preencher]` <!-- path: profile.courses[].id -->
- **Nome do curso/programa:** `[Preencher]` <!-- path: profile.courses[].name -->
- **Instituição/provedor:** `[Preencher]` <!-- path: profile.courses[].provider -->
- **Tópicos/área e principais conteúdos (lista):** `[Preencher]` <!-- path: profile.courses[].topics -->
- **Data de início (ou de realização, se foi pontual):** `[Preencher]` <!-- path: profile.courses[].start_date -->
- **Data de conclusão (ou de realização):** `[Preencher]` <!-- path: profile.courses[].completion_date -->
- **Carga horária (somente se conhecida; em horas):** `[Preencher]` <!-- path: profile.courses[].workload_hours -->
- **Situação:** `completed`, `in_progress` ou `incomplete` <!-- path: profile.courses[].status -->
- **Certificado emitido?** `true` ou `false` <!-- path: profile.courses[].certificate_issued -->
- **URL ou código de validação:** `[Preencher]` <!-- path: profile.courses[].verification_url -->
- **Atividades ou projetos realizados (lista):** `[Preencher]` <!-- path: profile.courses[].activities_projects -->
- **Competências desenvolvidas (lista; detalhe na seção 8):** `[Preencher]` <!-- path: profile.courses[].skills_developed -->
- **Relevância para quais famílias de cargo (lista):** `[Preencher]` <!-- path: profile.courses[].relevant_job_families -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.courses[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.courses[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.courses[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.courses[].meta.private_notes -->

---

# 8. Competências e contexto de uso (itens 8 e 9 do escopo)

Cadastre as competências **individualmente** e registre **onde** cada uma foi usada. Uma lista de palavras-chave sem contexto não é aceita: o contexto (trabalho, projeto, estudo, certificação, conhecimento declarado ou apenas familiaridade) muda a força da evidência.

## 8.1 Catálogo de competências

Vale para qualquer área: ferramentas, métodos, conhecimentos de domínio, técnicas específicas da profissão, habilidades comportamentais e idiomas. **Repita para cada competência.**

- **Id local (opcional; ex.: SKL-001):** `[Preencher]` <!-- path: profile.skills[].id -->
- **Nome (obrigatório):** `[Preencher]` <!-- path: profile.skills[].name -->
- **Categoria:** `language` (linguagem técnica), `framework`, `library`, `database`, `tool` (ferramenta), `method` (método), `domain` (conhecimento de domínio), `soft_skill` (comportamental), `spoken_language` (idioma) ou `other` <!-- path: profile.skills[].category -->
- **Outros nomes ou siglas (lista):** `[Preencher]` <!-- path: profile.skills[].aliases -->
- **Descrição ou escopo (o que você sabe fazer com isso):** `[Preencher]` <!-- path: profile.skills[].description -->
- **Nível autoavaliado:** `not_assessed`, `exposure`, `basic`, `intermediate`, `advanced` ou `expert` <!-- path: profile.skills[].self_assessed_level -->
- **Tarefas que consegue executar (lista concreta):** `[Preencher]` <!-- path: profile.skills[].tasks_can_perform -->
- **Última utilização (data aproximada):** `[Preencher]` <!-- path: profile.skills[].last_used -->
- **Tempo de uso (somente se puder informar com precisão):** `[Preencher]` <!-- path: profile.skills[].duration_of_use -->
- **Observações ou limitações:** `[Preencher]` <!-- path: profile.skills[].limitations -->
- **Deseja incluir em currículos?** `allowed` (sim), `requires_approval` (depende da vaga) ou `never` (não) <!-- path: profile.skills[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.skills[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.skills[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.skills[].meta.private_notes -->

Categorias de exemplo (a lista é ilustrativa e não limita o cadastro): linguagens e ferramentas técnicas; engenharia, análise e visualização de dados; saúde e cuidado; ensino e pesquisa; vendas, atendimento e sucesso do cliente; finanças, contabilidade, jurídico, operações e logística; design e ferramentas criativas; gestão de projetos, produtos e processos; habilidades técnicas específicas da profissão ou do setor.

## 8.2 Onde cada competência foi usada

**Repita para cada par competência + contexto + fonte.** Escolha **uma** fonte coerente com o contexto:

| Contexto (`usage_context`) | Fonte exigida                                                    |
| -------------------------- | ---------------------------------------------------------------- |
| `professional_experience`  | `experience_id`                                                  |
| `project_experience`       | `project_id`                                                     |
| `volunteer_experience`     | `volunteering_id` (ou `experience_id` de um vínculo `volunteer`) |
| `coursework`               | `education_id` ou `course_id`                                    |
| `certification`            | `certification_id`                                               |
| `self_declared_knowledge`  | opcional                                                         |
| `conceptual_familiarity`   | opcional (conhece o assunto, sem prática)                        |
| `unverified`               | opcional (use quando não souber onde usou)                       |

- **Id local (opcional):** `[Preencher]` <!-- path: profile.skill_usages[].id -->
- **Competência (id do catálogo, seção 8.1):** `[Preencher]` <!-- path: profile.skill_usages[].skill_id -->
- **Contexto de uso:** `professional_experience`, `project_experience`, `volunteer_experience`, `coursework`, `certification`, `self_declared_knowledge`, `conceptual_familiarity` ou `unverified` <!-- path: profile.skill_usages[].usage_context -->
- **Fonte — experiência (id da seção 4):** `[Preencher]` <!-- path: profile.skill_usages[].experience_id -->
- **Fonte — projeto (id da seção 5):** `[Preencher]` <!-- path: profile.skill_usages[].project_id -->
- **Fonte — formação (id da seção 6):** `[Preencher]` <!-- path: profile.skill_usages[].education_id -->
- **Fonte — curso (id da seção 7):** `[Preencher]` <!-- path: profile.skill_usages[].course_id -->
- **Fonte — certificação (id da seção 10):** `[Preencher]` <!-- path: profile.skill_usages[].certification_id -->
- **Fonte — voluntariado (id da seção 13):** `[Preencher]` <!-- path: profile.skill_usages[].volunteering_id -->
- **Faceta (parte do projeto ou do trabalho; texto livre):** `[Preencher]` <!-- path: profile.skill_usages[].facet -->
- **Como foi usada:** `[Preencher]` <!-- path: profile.skill_usages[].usage_description -->
- **Parte implementada ou feita por você:** `[Preencher]` <!-- path: profile.skill_usages[].personal_implementation -->
- **Nível neste contexto:** `not_assessed`, `exposure`, `basic`, `intermediate`, `advanced` ou `expert` <!-- path: profile.skill_usages[].level_in_context -->
- **Início do uso:** `[Preencher]` <!-- path: profile.skill_usages[].start_date -->
- **Fim do uso (ou `present`):** `[Preencher]` <!-- path: profile.skill_usages[].end_date -->
- **Tarefas realizadas (lista):** `[Preencher]` <!-- path: profile.skill_usages[].tasks -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.skill_usages[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.skill_usages[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.skill_usages[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.skill_usages[].meta.private_notes -->

## 8.3 Conhecimentos em desenvolvimento

Registre aqui o que está estudando e **ainda não deve ser apresentado como competência consolidada**. Cadastre a competência na seção 8.1 e preencha o plano de estudo no mesmo registro; use `conceptual_familiarity` (sem prática) ou `self_declared_knowledge` (com prática) na seção 8.2.

- **Competência (registro da seção 8.1) — escopo do estudo:** `[Preencher]` <!-- path: profile.skills[].study_plan.scope -->
- **Fontes de estudo (lista):** `[Preencher]` <!-- path: profile.skills[].study_plan.sources -->
- **Projeto ou prática:** `[Preencher]` <!-- path: profile.skills[].study_plan.practical_project -->
- **Nível atual percebido:** `[Preencher]` <!-- path: profile.skills[].study_plan.perceived_level -->
- **Próximo objetivo:** `[Preencher]` <!-- path: profile.skills[].study_plan.next_goal -->

---

# 9. Idiomas (item 10 do escopo)

**Repita para cada idioma.** Não use só um nível geral quando a proficiência for diferente entre leitura, escrita, compreensão oral e conversação. Níveis: `A1`, `A2`, `B1`, `B2`, `C1`, `C2`, `native` ou `not_assessed`. Se você não conhece a escala (A1–C2), descreva o seu nível com suas próprias palavras em “Nível descritivo” (por exemplo, “avançado” ou “nível médio”): ele é guardado como você escreveu e **nunca** é convertido em A1–C2 automaticamente.

## Idioma — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.languages[].id -->
- **Idioma (nome):** `[Preencher]` <!-- path: profile.languages[].language -->
- **Código do idioma (BCP-47, opcional):** `[Preencher]` <!-- path: profile.languages[].language_code -->
- **Nível geral autoavaliado:** `[Preencher]` <!-- path: profile.languages[].overall_level -->
- **Nível descritivo (suas palavras, opcional):** `[Preencher]` <!-- path: profile.languages[].self_described_level -->
- **Leitura:** `[Preencher]` <!-- path: profile.languages[].reading -->
- **Escrita:** `[Preencher]` <!-- path: profile.languages[].writing -->
- **Compreensão oral:** `[Preencher]` <!-- path: profile.languages[].listening -->
- **Conversação:** `[Preencher]` <!-- path: profile.languages[].speaking -->
- **Uso profissional real:** `[Preencher]` <!-- path: profile.languages[].professional_usage -->
- **Certificação — nome:** `[Preencher]` <!-- path: profile.languages[].certification.name -->
- **Certificação — instituição:** `[Preencher]` <!-- path: profile.languages[].certification.issuer -->
- **Certificação — nota:** `[Preencher]` <!-- path: profile.languages[].certification.score -->
- **Certificação — data da avaliação:** `[Preencher]` <!-- path: profile.languages[].certification.assessment_date -->
- **Certificação — validade:** `[Preencher]` <!-- path: profile.languages[].certification.valid_until -->
- **Certificação cadastrada na seção 10 (id, opcional):** `[Preencher]` <!-- path: profile.languages[].certification_id -->
- **Deseja incluir no currículo?** `allowed` (sim), `requires_approval` (depende da vaga) ou `never` (não) <!-- path: profile.languages[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.languages[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.languages[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.languages[].meta.private_notes -->

---

# 10. Certificações, licenças e credenciais (item 11 do escopo)

**Repita para cada certificação ou habilitação.** Diferencie certificado de participação, conclusão de curso, certificação profissional e licença obrigatória para exercer uma atividade.

## Certificação — registro 1

- **Id local (opcional; ex.: CERT-001):** `[Preencher]` <!-- path: profile.certifications[].id -->
- **Nome oficial:** `[Preencher]` <!-- path: profile.certifications[].name -->
- **Entidade emissora:** `[Preencher]` <!-- path: profile.certifications[].issuer -->
- **Categoria:** `professional_certification`, `license`, `credential`, `attendance`, `completion` ou `other` <!-- path: profile.certifications[].category -->
- **Data de emissão:** `[Preencher]` <!-- path: profile.certifications[].issue_date -->
- **Validade (se aplicável):** `[Preencher]` <!-- path: profile.certifications[].expiration_date -->
- **Identificador público (opcional):** `[Preencher]` <!-- path: profile.certifications[].public_identifier -->
- **URL de validação (opcional):** `[Preencher]` <!-- path: profile.certifications[].verification_url -->
- **Situação atual:** `valid`, `expired`, `renewal_in_progress` ou `no_expiration` <!-- path: profile.certifications[].status -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.certifications[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.certifications[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.certifications[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.certifications[].meta.private_notes -->

As competências ligadas à certificação são registradas na seção 8.2 (contexto `certification`, fonte `certification_id`).

---

# 11. Conquistas, prêmios e reconhecimentos (item 12 do escopo)

**Repita para cada item.**

## Prêmio — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.awards[].id -->
- **Nome da conquista/prêmio:** `[Preencher]` <!-- path: profile.awards[].name -->
- **Organização responsável:** `[Preencher]` <!-- path: profile.awards[].organization -->
- **Data:** `[Preencher]` <!-- path: profile.awards[].date -->
- **Contexto e critério (como foi concedido):** `[Preencher]` <!-- path: profile.awards[].context_and_criteria -->
- **Sua contribuição ou motivo do reconhecimento:** `[Preencher]` <!-- path: profile.awards[].personal_contribution -->
- **Abrangência:** `institutional`, `regional`, `national`, `international` ou `other` <!-- path: profile.awards[].scope -->
- **Pode ser divulgado?** `allowed` (sim), `requires_approval` (parcialmente/com aprovação) ou `never` (não) <!-- path: profile.awards[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.awards[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.awards[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.awards[].meta.private_notes -->

---

# 12. Pesquisa, publicações, palestras e produção intelectual (item 13 do escopo)

Inclua artigos, TCCs, dissertações, teses, pesquisas, apresentações, livros, capítulos, documentação pública, palestras, aulas e contribuições relevantes. **Repita para cada item.**

## Publicação — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.publications[].id -->
- **Título:** `[Preencher]` <!-- path: profile.publications[].title -->
- **Tipo:** `article`, `research`, `thesis`, `dissertation`, `talk`, `lecture`, `book`, `chapter`, `documentation` ou `other` <!-- path: profile.publications[].type -->
- **Data:** `[Preencher]` <!-- path: profile.publications[].date -->
- **Instituição, evento ou publicação:** `[Preencher]` <!-- path: profile.publications[].venue_or_institution -->
- **Autores e sua posição:** `[Preencher]` <!-- path: profile.publications[].authorship -->
- **Resumo:** `[Preencher]` <!-- path: profile.publications[].summary -->
- **Sua contribuição:** `[Preencher]` <!-- path: profile.publications[].personal_contribution -->
- **Temas e métodos (lista):** `[Preencher]` <!-- path: profile.publications[].topics_methods -->
- **URL ou repositório:** `[Preencher]` <!-- path: profile.publications[].url -->
- **DOI (formato 10.xxxx/sufixo):** `[Preencher]` <!-- path: profile.publications[].doi -->
- **Situação:** `published`, `presented`, `submitted` ou `in_progress` <!-- path: profile.publications[].status -->
- **Pode aparecer em currículos?** `allowed`, `requires_approval` ou `never` <!-- path: profile.publications[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.publications[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.publications[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.publications[].meta.private_notes -->

---

# 13. Voluntariado, liderança, mentoria e atividades extracurriculares (item 14 do escopo)

Inclua atividades que demonstrem competências relevantes e que possam ser divulgadas. **Repita para cada atividade.**

## Atividade — registro 1

- **Id local (opcional; ex.: VOL-001):** `[Preencher]` <!-- path: profile.volunteering[].id -->
- **Organização ou iniciativa:** `[Preencher]` <!-- path: profile.volunteering[].organization -->
- **Papel/função:** `[Preencher]` <!-- path: profile.volunteering[].role -->
- **Tipo de participação:** `volunteer`, `community`, `association`, `leadership`, `mentoring`, `student_activity` ou `other` <!-- path: profile.volunteering[].participation_type -->
- **Início:** `[Preencher]` <!-- path: profile.volunteering[].start_date -->
- **Término (ou `present`):** `[Preencher]` <!-- path: profile.volunteering[].end_date -->
- **Responsabilidades (lista):** `[Preencher]` <!-- path: profile.volunteering[].responsibilities -->
- **Público atendido (sem dados pessoais de terceiros):** `[Preencher]` <!-- path: profile.volunteering[].audience -->
- **Resultados e entregas (lista):** `[Preencher]` <!-- path: profile.volunteering[].outcomes -->
- **Pode ser divulgada?** `allowed` (sim), `requires_approval` (parcialmente/com aprovação) ou `never` (não) <!-- path: profile.volunteering[].meta.resume_use -->
- **Visibilidade:** `public`, `private` ou `conditional` <!-- path: profile.volunteering[].meta.visibility -->
- **Evidências (ids):** `[Preencher]` <!-- path: profile.volunteering[].meta.evidence_ids -->
- **Observações privadas:** `[Preencher]` <!-- path: profile.volunteering[].meta.private_notes -->

As competências demonstradas são registradas na seção 8.2 (contexto `volunteer_experience`, fonte `volunteering_id`).

---

# 14. Informações complementares relevantes

Para informações profissionais importantes que não se encaixam nas seções anteriores. Não inclua detalhes íntimos ou sensíveis sem necessidade.

- **Conhecimentos específicos do setor (lista):** `[Preencher]` <!-- path: profile.additional_professional_context.industry_knowledge -->
- **Normas, padrões ou regulamentações conhecidos (lista):** `[Preencher]` <!-- path: profile.additional_professional_context.standards_regulations -->
- **Equipamentos, máquinas ou ferramentas especializadas (lista):** `[Preencher]` <!-- path: profile.additional_professional_context.specialized_equipment -->
- **Métodos, processos ou frameworks de trabalho (lista):** `[Preencher]` <!-- path: profile.additional_professional_context.methods_processes_frameworks -->
- **Experiência internacional ou intercultural:** `[Preencher]` <!-- path: profile.additional_professional_context.international_experience -->
- **Experiência com equipes distribuídas/remotas:** `[Preencher]` <!-- path: profile.additional_professional_context.distributed_team_experience -->
- **Experiência com clientes, fornecedores ou outras partes interessadas:** `[Preencher]` <!-- path: profile.additional_professional_context.stakeholder_experience -->
- **Outras informações profissionais:** `[Preencher]` <!-- path: profile.additional_professional_context.other -->

---

# 15. Disponibilidade e preferências de trabalho (item 16 do escopo)

**Privado por construção:** esta seção orienta recomendações e decisões de candidatura e **nunca faz parte do currículo**. Para o salário, o uso em qualquer geração exige autorização explícita.

- **Modalidades preferidas (lista):** `onsite`, `hybrid`, `remote` <!-- path: profile.availability_preferences.preferred_work_modes -->
- **Modalidades aceitas (lista):** `onsite`, `hybrid`, `remote` <!-- path: profile.availability_preferences.accepted_work_modes -->
- **Regiões/países de interesse (lista):** `[Preencher]` <!-- path: profile.availability_preferences.target_regions_countries -->
- **Disponibilidade para mudança:** `yes`, `no` ou `depends` <!-- path: profile.availability_preferences.willing_to_relocate -->
- **Disponibilidade para viagens:** `yes`, `no` ou `depends` <!-- path: profile.availability_preferences.travel_availability -->
- **Detalhes sobre viagens (percentual, frequência, restrições):** `[Preencher]` <!-- path: profile.availability_preferences.travel_notes -->
- **Disponibilidade para início:** `[Preencher]` <!-- path: profile.availability_preferences.start_availability -->
- **Tipos de contrato preferidos (lista):** `employee`, `internship`, `apprenticeship`, `contractor`, `freelance`, `self_employed`, `business_owner`, `temporary`, `public_service`, `volunteer`, `other` <!-- path: profile.availability_preferences.preferred_contract_types -->
- **Jornada preferida:** `[Preencher]` <!-- path: profile.availability_preferences.preferred_workload -->
- **Fusos/horários compatíveis:** `[Preencher]` <!-- path: profile.availability_preferences.compatible_timezones_hours -->
- **Faixa salarial desejada — valor (não negativo; opcional):** `[Preencher]` <!-- path: profile.availability_preferences.salary_expectation.amount -->
- **Faixa salarial desejada — moeda (ISO 4217, ex.: BRL):** `[Preencher]` <!-- path: profile.availability_preferences.salary_expectation.currency -->
- **Faixa salarial desejada — periodicidade:** `hourly`, `monthly` ou `yearly` <!-- path: profile.availability_preferences.salary_expectation.period -->
- **Faixa salarial desejada — observações:** `[Preencher]` <!-- path: profile.availability_preferences.salary_expectation.notes -->
- **Benefícios considerados importantes (lista):** `[Preencher]` <!-- path: profile.availability_preferences.desired_benefits -->
- **Preferências de ambiente/equipe (lista):** `[Preencher]` <!-- path: profile.availability_preferences.work_environment_preferences -->
- **Restrições ou condições de trabalho relevantes (lista; não insira detalhes médicos ou sensíveis desnecessários):** `[Preencher]` <!-- path: profile.availability_preferences.work_conditions -->
- **Condições que fariam recusar uma oportunidade (lista):** `[Preencher]` <!-- path: profile.availability_preferences.deal_breakers -->

---

# 16. Preferências de carreira e tipos de vaga (itens 3 e 17 do escopo)

Também **privado por construção**. Esta é a **fonte única** de cargos, áreas, setores e senioridade de interesse.

## 16.1 Cargos, áreas, setores e senioridade

- **Cargos prioritários (lista ordenada):** `[Preencher]` <!-- path: profile.career_preferences.priority_job_titles -->
- **Cargos secundários (lista):** `[Preencher]` <!-- path: profile.career_preferences.secondary_job_titles -->
- **Cargos que não deseja buscar (lista):** `[Preencher]` <!-- path: profile.career_preferences.excluded_job_titles -->
- **Áreas de interesse (lista):** `[Preencher]` <!-- path: profile.career_preferences.fields_of_interest -->
- **Setores preferidos (lista):** `[Preencher]` <!-- path: profile.career_preferences.preferred_industries -->
- **Setores que deseja evitar (lista):** `[Preencher]` <!-- path: profile.career_preferences.excluded_industries -->
- **Níveis de senioridade buscados (lista):** `student`, `entry`, `junior`, `mid`, `senior`, `specialist`, `lead`, `manager`, `executive`, `not_assessed` <!-- path: profile.career_preferences.target_seniority_levels -->
- **Termos de cargo equivalentes que aceita (lista):** `[Preencher]` <!-- path: profile.career_preferences.accepted_equivalent_titles -->
- **Títulos que não representam corretamente seu perfil (lista):** `[Preencher]` <!-- path: profile.career_preferences.misleading_titles_to_avoid -->

## 16.2 Interesses, objetivos e preferências por oportunidade

- **Interesses profissionais (lista):** `[Preencher]` <!-- path: profile.career_preferences.professional_interests -->
- **Problemas ou tipos de trabalho que gosta de resolver (lista):** `[Preencher]` <!-- path: profile.career_preferences.problems_to_solve -->
- **Objetivos para os próximos 1–3 anos:** `[Preencher]` <!-- path: profile.career_preferences.short_term_goals -->
- **Objetivos de longo prazo:** `[Preencher]` <!-- path: profile.career_preferences.long_term_goals -->
- **O que torna uma vaga especialmente interessante?** `[Preencher]` <!-- path: profile.career_preferences.what_makes_a_job_interesting -->
- **Quais responsabilidades prefere exercer? (lista)** `[Preencher]` <!-- path: profile.career_preferences.preferred_responsibilities -->
- **Quais atividades prefere evitar? (lista)** `[Preencher]` <!-- path: profile.career_preferences.responsibilities_to_avoid -->
- **Qual equilíbrio busca entre as frentes do seu trabalho (ex.: execução, operação, atendimento, gestão, análise)?** `[Preencher]` <!-- path: profile.career_preferences.work_balance_preference -->
- **Aceita oportunidades fora da área principal?** `yes`, `no` ou `depends` <!-- path: profile.career_preferences.interest_in_adjacent_fields -->
- **Condições para oportunidades fora da área principal:** `[Preencher]` <!-- path: profile.career_preferences.adjacent_fields_conditions -->

---

# 17. Preferências de currículo e apresentação (item 17 do escopo)

Orientam a geração, mas podem ser substituídas por escolhas feitas para uma vaga específica.

- **Idioma padrão (BCP-47):** `[Preencher]` <!-- path: profile.resume_preferences.default_language -->
- **Variante regional (ex.: pt-BR, pt-PT, en-US, en-GB):** `[Preencher]` <!-- path: profile.resume_preferences.regional_variant -->
- **Tom:** `formal`, `professional_direct`, `technical`, `executive`, `academic` ou `other` <!-- path: profile.resume_preferences.tone -->
- **Extensão preferida:** `one_page`, `two_pages` ou `content_based` <!-- path: profile.resume_preferences.preferred_length -->
- **Formatos de arquivo (lista):** `docx`, `pdf` <!-- path: profile.resume_preferences.output_formats -->
- **Estilo visual:** `ats_simple`, `traditional`, `modern_discreet`, `academic` ou `portfolio` <!-- path: profile.resume_preferences.visual_style -->
- **Foto:** `never` (não) ou `when_appropriate` (sim, quando apropriado ao país e à vaga) <!-- path: profile.resume_preferences.photo_preference -->
- **Título profissional padrão (ou deixe em branco para a IA escolher conforme a vaga):** `[Preencher]` <!-- path: profile.resume_preferences.default_headline -->
- **Seções que deseja priorizar (lista):** `summary`, `experience`, `projects`, `education`, `courses`, `skills`, `languages`, `certifications`, `awards`, `publications`, `volunteering` <!-- path: profile.resume_preferences.preferred_sections -->
- **Seções que deseja omitir por padrão (lista):** mesmos valores acima <!-- path: profile.resume_preferences.sections_to_omit -->
- **Experiências antigas que podem ser resumidas (lista de ids da seção 4):** `[Preencher]` <!-- path: profile.resume_preferences.older_experience_ids -->
- **Experiências ou projetos a destacar quando pertinentes (lista de ids das seções 4 e 5):** `[Preencher]` <!-- path: profile.resume_preferences.highlight_record_ids -->
- **Preferências de vocabulário (lista):** `[Preencher]` <!-- path: profile.resume_preferences.preferred_vocabulary -->
- **Expressões que não gosta de usar (lista):** `[Preencher]` <!-- path: profile.resume_preferences.expressions_to_avoid -->
- **Observações adicionais de estilo:** `[Preencher]` <!-- path: profile.resume_preferences.additional_style_notes -->

---

# 18. Evidências e referências (item 18 do escopo)

Use este catálogo para identificar a origem dos fatos das seções anteriores; basta registrar o tipo e um link ou descrição não sensível. A evidência é citada nos registros pelo campo “Evidências (ids)”, e aqui você pode indicar o que ela sustenta. **Repita para cada evidência.**

## Evidência — registro 1

- **Id local (ex.: EVD-001):** `[Preencher]` <!-- path: profile.evidence[].id -->
- **Tipo:** `repository`, `certificate`, `portfolio`, `document`, `publication`, `demo`, `reference`, `self_declaration` ou `other` <!-- path: profile.evidence[].type -->
- **Título/descrição:** `[Preencher]` <!-- path: profile.evidence[].title -->
- **URL ou localização (URL `https://...` ou descrição, como “pasta física”):** `[Preencher]` <!-- path: profile.evidence[].url_or_location -->
- **Quais registros ela sustenta? (lista de ids):** `[Preencher]` <!-- path: profile.evidence[].supports -->
- **Data da evidência:** `[Preencher]` <!-- path: profile.evidence[].evidence_date -->
- **Pública?** `true` ou `false` <!-- path: profile.evidence[].is_public -->
- **Autorizada para compartilhamento com recrutadores?** `allowed` (sim), `restricted` (com restrição) ou `not_allowed` (não) <!-- path: profile.evidence[].recruiter_sharing -->
- **Observações:** `[Preencher]` <!-- path: profile.evidence[].notes -->

**Referências pessoais** (pessoas que podem atestar seu trabalho) ficam fora do perfil importável. Registre apenas a permissão de contato no campo “Pode ser contatado como referência?” de cada experiência (4.7).

---

# 19. Informações pendentes, incertas ou conflitantes (item 19 do escopo)

A ferramenta precisa conhecer as incertezas para não transformá-las em fatos. **Repita para cada pendência.**

## Pendência — registro 1

- **Id local (ex.: PEND-001):** `[Preencher]` <!-- path: profile.pending_items[].id -->
- **Assunto:** `[Preencher]` <!-- path: profile.pending_items[].subject -->
- **Registro a que se refere (id, opcional):** `[Preencher]` <!-- path: profile.pending_items[].target.record_id -->
- **Campo a que se refere (opcional; ex.: start_date ou identity.pronouns):** `[Preencher]` <!-- path: profile.pending_items[].target.field -->
- **Informação atual:** `[Preencher]` <!-- path: profile.pending_items[].current_information -->
- **Motivo:** `missing` (falta o dado), `conflict` (fontes divergentes), `stale` (pode estar desatualizado) ou `unclear` (incerto) <!-- path: profile.pending_items[].reason -->
- **Detalhe do motivo (ex.: memória incompleta, aguardando documento):** `[Preencher]` <!-- path: profile.pending_items[].reason_detail -->
- **Versões conhecidas (lista):** `[Preencher]` <!-- path: profile.pending_items[].known_variants -->
- **O que pode ser afirmado com segurança por enquanto?** `[Preencher]` <!-- path: profile.pending_items[].safe_statement_for_now -->
- **Como confirmar?** `[Preencher]` <!-- path: profile.pending_items[].confirmation_method -->
- **Prioridade:** `low`, `medium` ou `high` <!-- path: profile.pending_items[].priority -->
- **Situação:** `open`, `resolved` ou `dismissed` <!-- path: profile.pending_items[].status -->

---

# 20. Privacidade e regras pessoais de uso (item 20 do escopo)

Regras que a aplicação **aplica de forma determinística**. Cada regra aponta para um registro (e, opcionalmente, um campo dele) ou para um termo. **Repita para cada regra.**

## Regra — registro 1

- **Id local (opcional):** `[Preencher]` <!-- path: profile.usage_rules.restrictions[].id -->
- **Registro alvo (id, opcional):** `[Preencher]` <!-- path: profile.usage_rules.restrictions[].target.record_id -->
- **Campo alvo (do registro, ou do perfil como identity.pronouns; opcional):** `[Preencher]` <!-- path: profile.usage_rules.restrictions[].target.field -->
- **Termo a filtrar (quando a regra não aponta para um registro):** `[Preencher]` <!-- path: profile.usage_rules.restrictions[].target.term -->
- **Regra:** `never_include` (nunca incluir em currículos), `require_approval` (exige aprovação antes de aparecer) ou `private_guidance_only` (só para orientação de carreira, nunca para recrutadores) <!-- path: profile.usage_rules.restrictions[].rule -->
- **Motivo (não sensível):** `[Preencher]` <!-- path: profile.usage_rules.restrictions[].reason -->

Exemplos de uso: empresas ou projetos que não podem ser divulgados, links que não devem ser compartilhados, informações privadas para orientação de carreira.

---

# 21. Revisão e manutenção do perfil

- **Data de preenchimento (AAAA-MM-DD):** `[Preencher]` <!-- path: profile.review.profile_created_date -->
- **Data da última revisão (AAAA-MM-DD):** `[Preencher]` <!-- path: profile.review.last_reviewed_date -->
- **Responsável pela revisão:** `self` (a própria pessoa) ou `other_authorized` (outra pessoa autorizada) <!-- path: profile.review.reviewed_by -->
- **Seções revisadas (lista):** `[Preencher]` <!-- path: profile.review.reviewed_sections -->
- **Informações que precisam ser atualizadas (lista):** `[Preencher]` <!-- path: profile.review.items_to_update -->

> **Consentimento:** a autorização para processar estas informações e gerar currículos **não é registrada neste arquivo**. Ela é dada e guardada na aplicação, com a versão da política aceita. Um “Sim” escrito aqui não vale como consentimento.

---

# 22. Checklist antes de importar o perfil

- [ ] Nome e contatos estão corretos.
- [ ] Datas foram informadas sem estimativas apresentadas como exatas.
- [ ] Cargos oficiais estão separados de títulos usados no currículo.
- [ ] Empregos estão separados de projetos, cursos e voluntariado.
- [ ] Minha contribuição individual está clara nos trabalhos em equipe.
- [ ] Tecnologias e competências têm contexto de uso (seção 8.2).
- [ ] Níveis de conhecimento são autoavaliações honestas ou estão como `not_assessed`.
- [ ] Resultados e métricas possuem fonte ou foram omitidos.
- [ ] Informações pendentes estão identificadas.
- [ ] Links e evidências foram revisados.
- [ ] Dados privados e sensíveis desnecessários foram removidos.
- [ ] Preferências privadas estão nas seções 15, 16 e 20.
- [ ] Não escrevi “Não informado” em nenhum campo.

**Regra final:** esta base deve ser tão completa quanto necessário para representar a trajetória da pessoa, mas a ferramenta seleciona apenas o que for relevante para cada oportunidade. O perfil completo nunca é copiado integralmente para um currículo.
