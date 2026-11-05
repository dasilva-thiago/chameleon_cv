# Como aplicar no repositório Chameleon CV

Este pacote contém uma nova fonte de verdade do produto, uma skill de Claude Code, instruções persistentes do projeto e um prompt para retomar o trabalho interrompido.

## Arquivos incluídos

- `docs/REDEFINICAO_PRODUTO_PESSOAL.md` — nova definição do produto e roadmap pessoal P0–P5.
- `.claude/skills/personal-resume-workbench/SKILL.md` — skill de projeto, disponível como `/personal-resume-workbench`.
- `CLAUDE.md` — instruções persistentes carregadas pelo Claude Code ao trabalhar no repositório.
- `PROMPT_RETOMADA_REDEFINICAO_PESSOAL.md` — prompt para a sessão atual/seguinte retomar o trabalho sem perder alterações em andamento.

## Instalação recomendada

1. Faça uma cópia/commit de segurança do estado local atual antes de mexer no repositório. Não limpe worktrees nem descarte alterações dos agentes.
2. Extraia o conteúdo deste ZIP **na raiz** do clone `chameleon_cv`, preservando a estrutura de pastas. Os diretórios `.claude/` e `docs/` serão mesclados; não substitua seus conteúdos existentes.
3. Se já existir um `CLAUDE.md` local não versionado, mescle as instruções em vez de sobrescrevê-lo.
4. Confirme que estes caminhos existem:
   - `CLAUDE.md`
   - `docs/REDEFINICAO_PRODUTO_PESSOAL.md`
   - `.claude/skills/personal-resume-workbench/SKILL.md`
5. Na sessão do Claude Code, execute `/personal-resume-workbench` para ativar explicitamente a skill. Em seguida, abra `PROMPT_RETOMADA_REDEFINICAO_PESSOAL.md`, copie o prompt e envie-o.
6. Peça ao Claude que primeiro inspecione o estado Git/worktrees/agentes. Não autorize `reset`, `clean`, force push ou migração destrutiva para aplicar o novo escopo.

## O que o Claude deve fazer com o plano antigo

A redefinição não deve ser apenas um arquivo adicional ignorado. O prompt solicita que Claude:

- reescreva `docs/implementation-plan.md` como roadmap pessoal, guardando o anterior em `docs/archive/` se for útil;
- atualize `README.md`, `docs/architecture.md` e `docs/progress.md`;
- marque o adendo e o prompt autônomo antigos como supersedidos para escopo de produto;
- mantenha ADRs, contratos, banco, segurança e código existentes quando tecnicamente válidos.

Assim, a antiga visão deixa de comandar o desenvolvimento sem que o histórico ou o trabalho já feito sejam destruídos.

## Importante

A redefinição e o prompt foram preparados com base na documentação pública do repositório e no estado de execução relatado por Thiago. Eles não modificam o GitHub nem o clone local automaticamente. A integração deve ser feita no clone local, depois da inspeção de segurança do estado atual.
