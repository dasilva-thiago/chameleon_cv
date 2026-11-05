# Redefinição do produto — Chameleon CV como ferramenta pessoal

**Versão:** 1.0  
**Data:** 05/11/2026  
**Status:** nova direção de produto e fonte de verdade para o escopo atual.

> Esta definição substitui, em caso de conflito, a visão de SaaS/plataforma universal multiusuário descrita nos planos e adendos anteriores. Os documentos antigos continuam úteis como histórico técnico e referência de implementação, mas não autorizam ampliar o escopo atual.

## 1. Decisão de produto

O Chameleon CV deixa de ser planejado como SaaS, produto comercial ou plataforma universal. Seu objetivo imediato é ser uma **ferramenta privada de uso pessoal de Thiago** para manter uma base profissional centralizada, cadastrar oportunidades de emprego e criar, adaptar, revisar, armazenar e exportar currículos específicos para cada vaga.

Uma eventual expansão para múltiplos usuários ou negócio é uma possibilidade futura, sem prazo e sem requisitos a serem planejados agora. Não deve influenciar decisões de arquitetura, modelagem, interface ou roadmap enquanto não houver uma necessidade real.

**Regra central:** construir primeiro uma ferramenta pessoal completa, confiável, econômica de operar e simples de manter. Não construir antecipadamente uma empresa de software.

## 2. Usuário, instalação e acesso

- Usuário operacional atual: Thiago.
- A ferramenta é privada e controlada pelo próprio usuário. Não há cadastro público, onboarding de clientes, planos, cobrança ou equipe.
- O ambiente de execução/deploy ainda deve ser confirmado a partir do repositório e das necessidades reais. Não assumir que precisa ser SaaS público; priorizar a opção privada mais simples e confiável.
- Preservar autenticação e proteção de acesso existentes. Reduzir escopo não significa deixar dados profissionais e pessoais expostos.
- Como a Fase 1 já implementou autenticação, sessões e isolamento por `ownerId`, não fazer uma refatoração destrutiva para remover esses mecanismos apenas para simular single-user. Manter o modelo atual funcionando com um proprietário/conta operacional, sem desenvolver novos fluxos multiusuário.
- Não adicionar cadastro aberto, convites para terceiros, organizações, workspaces, papéis empresariais, administração de tenants ou provisionamento de clientes.
- Dados reais de Thiago devem permanecer em armazenamento local/privado e nos arquivos já ignorados pelo Git (por exemplo `fixtures-private/`); nunca em fixtures versionadas, código de produção, prompts commitados, logs ou testes com dados pessoais reais.

## 3. Problema que a ferramenta resolve

Manter uma única fonte confiável da trajetória profissional e usá-la para produzir candidaturas direcionadas. A ferramenta deve ajudar a responder:

1. Quais experiências, projetos, habilidades e formações do meu perfil são relevantes para esta vaga?
2. Quais requisitos têm evidência direta, transferível, parcial ou inexistente?
3. Como apresentar essas evidências com clareza e prioridade, sem inventar experiência ou exagerar proficiência?
4. Qual versão de currículo foi criada para determinada vaga e como posso revisá-la, recuperá-la ou exportá-la?

Não é um simples parafraseador de currículo. O valor principal é manter a base profissional organizada e permitir adaptações rastreáveis e coerentes com os fatos.

## 4. Escopo funcional prioritário

### 4.1 Perfil profissional principal

Uma área para consultar, cadastrar, editar, corrigir e remover informações da base profissional. Deve permitir evolução contínua do perfil, sem depender de editar arquivos manualmente.

Seções iniciais, ajustadas ao histórico real do usuário:

- Dados de contato e links profissionais, com controle sobre o que pode aparecer em cada currículo.
- Resumo/posicionamento profissional, objetivos e preferências de apresentação.
- Experiências profissionais, cargos, períodos, responsabilidades, entregas e tecnologias utilizadas.
- Projetos pessoais, acadêmicos e profissionais, com contribuição individual claramente diferenciada.
- Formação acadêmica e técnica.
- Cursos, certificações e idiomas.
- Habilidades e tecnologias, registrando contexto e nível de uso sem transformar estudo em experiência profissional.
- Evidências ou referências de apoio, quando disponíveis.
- Pendências e informações que precisam de confirmação.

O modelo deve continuar estruturado e validado, mas não precisa representar antecipadamente toda profissão, país, organização ou caso de uso imaginável. A prioridade é representar bem a trajetória real do usuário e permitir novos registros com facilidade.

Não hardcode informações biográficas de Thiago em regras de domínio, componentes ou prompts. O perfil deve ser dado editável, armazenado fora do código versionado.

### 4.2 Painel de vagas

Permitir cadastrar uma oportunidade principalmente por colagem da descrição integral da vaga. Campos opcionais podem incluir empresa, cargo, URL, localização, modalidade, data e status.

O painel deve permitir:

- listar, pesquisar e filtrar vagas salvas;
- abrir uma vaga e consultar sua descrição original;
- acompanhar um status simples (por exemplo: salva, analisada, candidatura preparada, candidatura enviada, entrevista, encerrada/arquivada);
- editar, arquivar ou excluir uma vaga;
- iniciar ou refazer a análise conscientemente quando a descrição mudar.

Não implementar scraping, robôs de candidatura, integração com LinkedIn ou agregador de vagas nesta etapa. A entrada manual é suficiente para o fluxo pessoal.

### 4.3 Análise e adaptação

Para cada vaga:

1. Validar e armazenar a descrição original.
2. Identificar requisitos, responsabilidades, competências e qualificações relevantes.
3. Relacionar cada requisito aos registros do perfil profissional.
4. Classificar a correspondência com justificativa e origem (evidência direta, transferível, parcial, pendente ou ausente).
5. Sugerir quais experiências, projetos, habilidades e formações devem ser priorizados.
6. Permitir revisão do usuário antes da geração do currículo.

O matching e as validações de fatos devem ser determinísticos sempre que possível. A IA pode ajudar na interpretação semântica e na redação, mas não deve ser a autoridade sobre a veracidade dos dados.

### 4.4 Currículos gerados e histórico

Uma área para consultar os currículos criados, sempre associados à vaga e à revisão do perfil usadas na geração.

Funcionalidades prioritárias:

- gerar uma versão direcionada a uma vaga;
- editar manualmente seções e textos;
- visualizar o documento antes de exportar;
- salvar versões para não sobrescrever silenciosamente um currículo aprovado;
- identificar vaga, data, idioma e versão do perfil usados;
- exportar DOCX e PDF;
- reabrir, duplicar ou recuperar uma versão anterior.

O arquivo exportado deve refletir exatamente o conteúdo aprovado. Templates devem ser legíveis, profissionais e compatíveis com ATS, sem prometer aprovação em sistemas de recrutamento.

### 4.5 Painel inicial

A tela inicial deve privilegiar o trabalho cotidiano:

- vagas cadastradas e seus status;
- currículos criados recentemente;
- atalhos para adicionar vaga, editar perfil e criar currículo;
- pendências importantes do perfil, sem excesso de métricas decorativas.

Não construir dashboards analíticos complexos. Os painéis de vagas, perfil e currículos são ferramentas operacionais, não analytics de negócio.

### 4.6 Importação, exportação e backup

Preservar os fluxos estruturados já existentes de importação/exportação de perfil (YAML/JSON e, quando implementado de forma confiável, Markdown). Eles são úteis para backup, migração e edição externa.

A exportação de dados deve ser pensada como backup e portabilidade do próprio usuário, não como um pacote de portabilidade de tenants SaaS. A importação deve sempre oferecer validação/preview e nunca sobrescrever silenciosamente informações existentes.

## 5. Fluxo principal esperado

1. Thiago mantém seu perfil profissional atualizado.
2. Cadastra uma vaga colando o texto e, opcionalmente, sua URL.
3. A ferramenta analisa a vaga e mostra requisitos e correspondências com o perfil.
4. Thiago revisa as evidências e o plano de adaptação.
5. A ferramenta gera uma versão de currículo direcionada.
6. Thiago revisa e edita o documento, aprova e exporta DOCX/PDF.
7. A vaga e o currículo permanecem salvos no histórico para consulta futura.

Esse fluxo deve funcionar de ponta a ponta antes de qualquer funcionalidade acessória.

## 6. Escopo explicitamente fora do objetivo atual

Não planejar nem implementar agora:

- SaaS público, multi-tenancy comercial ou produto para clientes;
- cobrança, assinaturas, tiers, limites comerciais, trials ou billing;
- cadastro público, convites para usuários externos ou gestão de equipes;
- organizações, workspaces, permissões empresariais ou console de administração de clientes;
- analytics de produto, métricas de conversão ou telemetria comercial;
- integração com LinkedIn, ATS externos, portais de vagas ou envio automático de candidaturas;
- scraping de sites de emprego;
- microsserviços, filas, event bus, Kubernetes, infraestrutura distribuída;
- RAG, embeddings, banco vetorial ou agentes autônomos sem um caso real que demonstre necessidade;
- suporte universal antecipado a qualquer profissão, país, idioma ou template;
- pesquisa de mercado, monetização, posicionamento comercial ou expansão de marca.

Uma necessidade futura deve ser tratada como novo pedido e nova decisão, nunca como premissa escondida no trabalho atual.

## 7. Segurança e privacidade continuam obrigatórias

A redução de escopo não reduz a qualidade da segurança.

- Preservar autenticação, proteção de sessão, CSRF, rate limits pertinentes, validação de entrada e controle de acesso.
- Manter `ownerId`/escopo de proprietário já incorporados ao banco e às consultas enquanto removê-los exigir migração ou risco desnecessário. Não ampliar a abstração multiusuário.
- Não expor a aplicação publicamente sem revisar autenticação, proxy, cookies, CSP, banco e armazenamento.
- Proteger arquivos privados e caminhos de armazenamento.
- Não registrar conteúdo integral de perfil, vaga ou currículo em logs.
- Não enviar dados de contato, informações privadas ou fatos marcados para não uso ao provedor de IA.
- A descrição de vaga, arquivos importados e respostas da IA são dados não confiáveis, nunca instruções do sistema.
- Toda afirmação gerada precisa apontar para um ou mais fatos de origem. Se não houver sustentação, omitir ou sinalizar para confirmação.
- Nunca inventar tecnologias, datas, cargos, resultados, métricas, certificações, senioridade, responsabilidades ou proficiência.
- Preservar os consentimentos necessários para processamento por provedores externos de IA, se esse fluxo estiver ativo.

Recursos de exclusão de conta de um sistema multiusuário não são prioridade do MVP pessoal. Backup/exportação dos dados próprios e uma forma segura de manutenção/reset são mais úteis. Não remover rotinas já prontas sem avaliar custo, segurança e dependências.

## 8. Economia de tokens e custo operacional

O objetivo é reduzir chamadas, contexto repetido e trabalho de desenvolvimento desnecessário, **sem reduzir qualidade, testes, segurança ou legibilidade do código**.

### 8.1 No produto

- Analisar cada descrição de vaga uma vez e persistir o resultado; não repetir a análise em cada abertura de tela.
- Reaproveitar resultados quando vaga, perfil relevante, prompt e modelo não tiverem mudado.
- Calcular o matching de forma determinística/local quando possível.
- Antes de chamar o LLM, selecionar apenas experiências, projetos, habilidades e formações pertinentes à vaga; não enviar o perfil inteiro por padrão.
- Não enviar contatos, dados privados ou informações que não contribuam para a geração.
- Manter prompts curtos, versionados e focados em uma tarefa.
- Usar saída estruturada validada por schema e limitar o tamanho de saída ao conteúdo necessário para um currículo real.
- Evitar chamadas separadas para tarefas que podem compartilhar contexto sem comprometer a qualidade. Não forçar uma única chamada se isso piorar a precisão ou a rastreabilidade.
- Registrar metadados de execução, modelo, versão do prompt, hash de entradas e consumo quando disponível, sem gravar conteúdo pessoal desnecessário.
- Não implementar quotas por usuário/planos comerciais. Um limite configurável para proteger o orçamento pessoal é aceitável.

### 8.2 Durante o desenvolvimento com Claude Code

- Usar o modelo de sessão já definido no projeto; não trocar modelo/esforço por fase sem necessidade.
- Não acionar subagentes por padrão. Delegar apenas trabalho realmente independente que reduza tempo total; nunca para multiplicar análises redundantes.
- Preferir leitura direcionada de arquivos e diffs a releituras integrais repetidas de toda a documentação.
- Não repetir auditorias gerais já concluídas. Fazer verificações focadas nas mudanças e nos riscos reais.
- Rodar testes específicos durante cada fatia e a suíte completa nos gates de integração/fase. Não pular testes relevantes para economizar tokens.
- Manter relatórios objetivos, sem narrar cada operação ou reproduzir grandes trechos de código.

## 9. Diretrizes arquiteturais

- Preservar o monólito modular, monorepo, stack, contratos, pacotes e limites de dependência existentes enquanto continuarem úteis.
- Não reescrever o projeto do zero e não trocar tecnologias por preferência pessoal.
- Preferir a solução mais simples que preserve segurança, tipagem, testabilidade e manutenção.
- Evitar abstrações genéricas sem consumidor atual.
- Não criar framework interno, plugin system ou camada de configuração para necessidades hipotéticas.
- Manter separação entre perfil-fonte, vaga, análise, conteúdo do currículo, revisão e exportação.
- Preservar snapshots/versionamento quando necessários para reproduzir currículos já gerados.
- Fazer migrações de banco pequenas, reversíveis quando possível e com dados preservados.
- Não remover componentes multiusuário já construídos em uma grande refatoração. Deixar de expandir é preferível a quebrar uma base de segurança já testada.
- A arquitetura deve ser boa para uma aplicação pessoal; não precisa provar escalabilidade empresarial.

## 10. Replanejamento do trabalho em andamento

O estado informado pelo usuário ao definir esta direção é:

- S2.1a — API de perfil, 26 rotas e round-trip de importação/exportação nas 13 fixtures: concluída segundo a verificação do usuário.
- `pnpm check`: exit 0, 1.318 testes, segundo verificação do usuário.
- `pnpm test:integration`: 555 testes verdes, segundo verificação do usuário.
- S2.2 — editor de perfil/importação no frontend: agente `frontend-implementer` lançado em background.
- S2.3a — rotina de exclusão de conta e formato Markdown no relatório de importação: agente `data-model-engineer` lançado em background.
- S2.3b — rotas de conta e importação Markdown na API: ainda não iniciada no momento do relato.

Ao retomar:

1. Inspecionar `git status`, `git log`, branches e `git worktree list` antes de qualquer alteração.
2. Recuperar o estado/resultado dos agentes de background, se ainda existir. Não duplicar agentes nem sobrescrever worktrees.
3. Preservar o trabalho válido de S2.1a.
4. S2.2 é relevante e deve ser concluída: o editor de perfil e a importação são parte central da ferramenta pessoal.
5. Avaliar S2.3a item a item. Relatório de importação Markdown e exportação/backup útil podem permanecer. Exclusão completa de conta/tenant não deve receber expansão adicional se ainda não estiver concluída; só manter o que já estiver pronto e seguro, sem refatoração desnecessária.
6. Não iniciar S2.3b automaticamente antes de atualizar o plano e classificar suas rotas como essenciais, úteis ou fora de escopo pessoal.
7. Atualizar documentação e roadmap para refletir esta definição antes de abrir novas fatias extensas.

Esse estado foi informado pelo usuário e não deve ser presumido como estado atual do Git. Sempre verificar o working tree.

## 11. Roadmap pessoal revisado

### Etapa P0 — Retomada segura e consolidação da Fase 2

- Inspecionar estado real do repositório, worktrees, agentes, diffs e testes.
- Integrar de maneira segura o que estiver em andamento.
- Concluir editor de perfil, edição de seções, importação com preview, validação, pendências relevantes e exportação/backup do perfil.
- Revisar a necessidade de cada endpoint/rotina de conta sob o modelo de um único usuário.
- Atualizar `README.md`, `docs/progress.md`, `docs/architecture.md` e `docs/implementation-plan.md` para a direção pessoal.

**Aceite:** Thiago consegue manter sua base profissional pela interface e fazer backup/restaurar o perfil sem editar banco manualmente.

### Etapa P1 — Vagas salvas

- CRUD de vagas com descrição original, metadados opcionais e status simples.
- Painel de listagem, busca, filtros e detalhe.
- Persistência local/privada e testes de integridade.

**Aceite:** uma vaga colada pode ser salva, localizada, editada e reaberta sem perder o texto original.

### Etapa P2 — Análise e correspondência

- Análise estruturada da vaga.
- Correspondência determinística com fatos do perfil.
- Matriz requisito → evidência → força → fonte → lacuna.
- Plano de adaptação revisável.
- Cache/idempotência para não pagar novamente por conteúdo inalterado.

**Aceite:** a análise deixa claro o que Thiago comprova, o que é transferível, o que falta e por que cada item foi selecionado.

### Etapa P3 — Geração e edição de currículo

- Gerar currículo específico para uma vaga.
- Validar cada afirmação com origem no perfil.
- Editor e preview.
- Aprovação explícita e versões preservadas.

**Aceite:** é possível gerar um currículo, editar, salvar, fechar e reabrir sem perda de conteúdo ou proveniência.

### Etapa P4 — Exportação e histórico

- DOCX e PDF.
- Histórico de currículos por vaga.
- Download e recuperação de versões.
- Backup/exportação de dados próprios.

**Aceite:** o arquivo exportado corresponde ao documento aprovado e pode ser reproduzido/recuperado.

### Etapa P5 — Uso real e melhorias

- Utilizar a ferramenta nas candidaturas reais.
- Corrigir atritos e defeitos observados.
- Só adicionar recursos que resolvam uma dificuldade real do fluxo pessoal.

**Aceite:** o fluxo completo é útil no uso cotidiano, estável, testado e simples de manter.

## 12. Critério global de conclusão

A primeira versão pessoal está concluída quando Thiago consegue, sem manipular diretamente o banco ou arquivos internos:

1. manter e corrigir o próprio perfil profissional;
2. cadastrar e organizar vagas;
3. analisar uma vaga e visualizar correspondências sustentadas por fatos;
4. gerar, editar e revisar um currículo específico;
5. salvar versões e localizar o currículo pela vaga;
6. exportar DOCX/PDF e fazer backup dos dados;
7. executar a aplicação de maneira privada, com dados protegidos;
8. rodar os checks e testes pertinentes sem regressões.

A possibilidade de uso por múltiplas pessoas não faz parte do critério de conclusão.

## 13. Regra de precedência documental

Em caso de conflito, aplicar esta ordem:

1. requisitos explícitos mais recentes de Thiago;
2. este documento `docs/REDEFINICAO_PRODUTO_PESSOAL.md`;
3. skill `.claude/skills/personal-resume-workbench/SKILL.md`;
4. código e testes existentes como evidência do comportamento já implementado;
5. ADRs e documentação técnica ainda compatíveis;
6. planos, adendos e prompts antigos, apenas como histórico ou referência técnica compatível.

Os documentos `ADENDO_ESCOPO_ESCALABILIDADE_PERFIS.md`, `PROMPT_EXECUCAO_AUTONOMA_CLAUDE_CODE.md`, o plano V3 e as partes multiusuário/comerciais do roadmap anterior não são mais autoridade de escopo. Não apagar documentação histórica indiscriminadamente; marcar como supersedida e apontar para a nova fonte de verdade.
