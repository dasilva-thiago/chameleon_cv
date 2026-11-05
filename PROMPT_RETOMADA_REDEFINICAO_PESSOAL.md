# Prompt — retomar o Chameleon CV com a nova direção pessoal

Cole este prompt na sessão do Claude Code aberta na raiz do repositório. Ele deve ser usado depois de copiar os arquivos deste pacote para o projeto.

---

Ative e siga a skill `/personal-resume-workbench`. Leia `CLAUDE.md` e `docs/REDEFINICAO_PRODUTO_PESSOAL.md` antes de continuar.

**A redefinição de produto é uma decisão explícita e substitui o escopo anterior.** O Chameleon CV será, nesta etapa, uma ferramenta privada de uso pessoal de Thiago — não um SaaS, plataforma comercial, produto universal ou projeto multiusuário. Não planeje a possível expansão futura. O objetivo é concluir com agilidade e economia de tokens uma ferramenta que permita manter o perfil profissional, cadastrar vagas, analisar correspondências, gerar/editar/armazenar currículos por vaga e exportar DOCX/PDF.

## Contexto de retomada informado pelo usuário

- S2.1a foi concluída: 26 rotas de perfil e round-trip de importação/exportação nas 13 fixtures.
- O usuário verificou `pnpm check` com exit 0 e 1.318 testes, e `pnpm test:integration` com 555 testes verdes.
- Foram lançados dois agentes em background: `frontend-implementer` para S2.2 (editor de perfil/importação) e `data-model-engineer` para S2.3a (purge de conta e formato Markdown no relatório de importação).
- S2.3b (rotas de conta e rota de importação Markdown na API) ainda não havia sido iniciada no momento desse relato.

Esses dados são o último estado informado, não uma garantia do estado atual do Git ou dos agentes.

## Primeira tarefa: recuperar o estado sem perder trabalho

Antes de editar qualquer coisa:

1. Execute `git status --short --branch`, `git log -5 --oneline`, `git branch --all` e `git worktree list`.
2. Verifique se os agentes/tarefas de background anteriores ainda estão disponíveis e recupere seus resultados. Não lance novamente um agente cujo trabalho ainda esteja ativo.
3. Inspecione diffs e arquivos não commitados em cada worktree/branch. Não use `git reset`, `git clean`, force push ou sobrescrita de arquivos para “limpar” o estado.
4. Se os resultados de background não estiverem mais disponíveis, determine pelo estado real do repositório o que foi concluído, o que ficou parcial e o que não começou.
5. Preserve o trabalho válido de S2.1a. Não repita os 1.318 testes, 555 testes de integração ou auditorias já concluídas sem uma razão técnica específica.

## Como reavaliar a Fase 2

Classifique cada entrega como **essencial para a ferramenta pessoal**, **útil se já estiver quase pronta** ou **fora do escopo atual**:

- S2.2 — editor de perfil e importação: essencial. Concluir uma experiência simples e confiável para cadastrar/editar experiências, habilidades, formação, projetos, evidências e pendências.
- Importação/exportação e backup do próprio perfil: essencial/útil. Manter validação e preview; evitar sobrescrita silenciosa.
- Relatório Markdown de importação: manter se a implementação for pequena, consistente e útil ao fluxo pessoal.
- Exportação/backup dos dados pessoais: útil; não precisa ser um produto de portabilidade de tenants.
- Purge/exclusão completa de conta SaaS e rotas específicas de lifecycle multiusuário: não ampliar agora. Se já estiver implementado e testado, não remova em refatoração desnecessária; documente como manutenção secundária. Se ainda estiver em andamento, não consuma novas fatias nele antes do núcleo pessoal.
- Consentimento para processamento externo por IA, proteção da sessão, segurança de arquivos e privacidade: manter quando aplicável. Não enfraquecer segurança por ser single-user.
- Não iniciar S2.3b automaticamente. Primeiro atualize e aproveite o roadmap pessoal; implemente apenas endpoints que sustentem o fluxo pessoal.

## Atualizar a documentação e substituir o plano antigo

Antes de abrir novas fatias grandes:

1. Trate `docs/REDEFINICAO_PRODUTO_PESSOAL.md` como fonte de verdade.
2. Atualize `docs/implementation-plan.md` para refletir o roadmap P0–P5 da redefinição. Preserve o plano antigo como histórico em `docs/archive/` se isso ajudar, mas não deixe duas fontes de verdade concorrentes.
3. Atualize `docs/progress.md` com o estado real verificado — não copie cegamente o estado informado acima.
4. Corrija `README.md` e `docs/architecture.md` para descrever a ferramenta pessoal e o que realmente está implementado.
5. Marque `ADENDO_ESCOPO_ESCALABILIDADE_PERFIS.md` e `PROMPT_EXECUCAO_AUTONOMA_CLAUDE_CODE.md` como supersedidos para decisões de produto/roadmap. Não apague ADRs ou decisões técnicas válidas; reavalie somente as que conflitam com o uso pessoal.
6. Se alguma decisão técnica precisar mudar, registre uma ADR curta com motivação, impacto, migração e testes. Não reescreva o banco ou contratos sem necessidade demonstrada.

## Prioridade de produto daqui em diante

1. Finalizar e validar a gestão do perfil profissional único.
2. Criar/terminar o painel de vagas salvas, com texto original e status simples.
3. Implementar análise da vaga e correspondência requisito → fato/evidência → justificativa/lacuna.
4. Implementar geração do currículo, revisão/edição, aprovação e histórico por vaga.
5. Implementar exportação DOCX/PDF e backup dos dados próprios.
6. Polir o painel inicial para mostrar vagas, currículos e pendências úteis.

Não construir cadastro de clientes, organizações, billing, planos, integrações de vagas, scraping, candidatura automática, analytics comerciais, RAG, vetores, microserviços ou infraestrutura de escala hipotética.

## Restrições de engenharia

- Não reescreva o projeto do zero. Mantenha a stack e os limites modulares existentes salvo problema concreto.
- Preserve autenticação, sessões, isolamento existente, validações, privacidade e testes. Um único usuário não significa aplicação sem proteção.
- Evite novas dependências e abstrações genéricas sem uso atual.
- Use o matching determinístico quando possível; envie ao LLM somente fatos relevantes para aquela vaga.
- Persista/cacheie análise e geração a partir de hashes de vaga, revisão relevante do perfil, prompt e modelo, evitando chamadas repetidas desnecessárias.
- Não force uma única chamada de IA quando isso comprometer factualidade; não crie chamadas separadas sem valor.
- Teste cada mudança com os testes direcionados e rode os gates completos quando uma etapa estiver integrada. Economia de tokens não autoriza pular testes relevantes ou baixar qualidade.
- Não paralelize por padrão. Use no máximo o paralelismo necessário para caminhos comprovadamente disjuntos; um único fluxo coordenado é preferível neste estágio.
- Preserve os padrões do usuário para Git: commits em inglês por etapa lógica, sem trailer de coautoria, sem force push. Não faça commit ou push sem autorização explícita da tarefa atual.

## Entrega desta retomada

Ao concluir a inspeção inicial, informe objetivamente:

- estado real do branch/worktree e dos agentes;
- quais partes de S2.2/S2.3a estão prontas, parciais ou ausentes;
- quais entregas de S2.3b foram descartadas, mantidas ou reclassificadas e por quê;
- mudanças documentais necessárias;
- próxima fatia essencial, com critérios de aceite e testes específicos.

Depois prossiga com a próxima tarefa essencial, sem reabrir auditorias completas nem pedir confirmação para decisões já definidas neste documento. Pare apenas diante de bloqueio real: credencial ausente, dado pessoal ambíguo que exige resposta de Thiago, ação destrutiva/irreversível, gasto externo não autorizado ou necessidade de publicar a aplicação.
