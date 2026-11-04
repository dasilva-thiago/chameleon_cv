# Pacote V3 — Gerador universal de currículos

Este pacote contém a especificação do produto, o perfil-piloto, os modelos universais de entrada e a configuração do Claude Code para roteamento automático de modelos e esforços.

## Documentos principais

1. `PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md` — plano central do produto, arquitetura, implementação, critérios de aceite e orquestração automática.
2. `PROMPT_EXECUCAO_AUTONOMA_CLAUDE_CODE.md` — prompt pronto para iniciar a implementação com o agente principal.
3. `MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.md` — formulário detalhado para qualquer pessoa preencher.
4. `MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.yaml` — exemplo estruturado de importação.
5. `PERFIL_PROFISSIONAL_SCHEMA.json` — contrato de validação.
6. `BASE_DE_DADOS_CURRICULO_THIAGO.md` — conjunto de dados do perfil-piloto; não deve virar esquema fixo da plataforma. Este arquivo contém dados pessoais reais e não deve ser publicado em repositório público. Mantenha-o local/privado ou substitua-o por fixture fictícia anonimizada antes de publicar o repositório.
7. `ADENDO_ESCOPO_ESCALABILIDADE_PERFIS.md` — adendo complementar de escopo e escalabilidade.

## Configuração do Claude Code

- `.claude/settings.json` define `sonnet` como modelo padrão e `high` como esforço-base.
- `.claude/agents/` contém sete subagentes com `model` e `effort` próprios.
- `scripts/iniciar-claude-code.ps1` inicia uma sessão CLI com `sonnet` e `high` no Windows.

### Como aplicar

1. Faça backup dos arquivos `.claude/settings.json` e `.claude/agents/` que já existirem no projeto.
2. Extraia os arquivos do ZIP diretamente na raiz do repositório, mesclando a pasta `.claude` com a existente. Não substitua configurações preexistentes sem mesclar as chaves JSON. O ZIP foi organizado para que `.claude/` e `scripts/` fiquem diretamente na raiz.
3. Confira que os arquivos dos sete agentes estão em `.claude/agents/`.
4. Abra PowerShell na raiz do repositório e execute:

```powershell
.\scripts\iniciar-claude-code.ps1
```

5. Envie o conteúdo de `PROMPT_EXECUCAO_AUTONOMA_CLAUDE_CODE.md` ao Claude Code.

O comando inicia a sessão principal com Sonnet `high`. Os subagentes chamam Opus `xhigh` ou Sonnet `high` conforme o frontmatter. O agente principal deve acionar os agentes especializados nas fases previstas. Não será necessário alternar `/model` ou `/effort` manualmente entre as fases.

Se preferir iniciar manualmente, execute `claude --model sonnet --effort high` na raiz do repositório.

## Limites importantes

- A sessão principal permanece em Sonnet como orquestradora; os subagentes são o mecanismo nativo para executar tarefas especializadas com modelos e esforços diferentes dentro da sessão.
- O modelo principal não muda automaticamente por causa de texto no prompt; o roteamento por tarefa ocorre pela configuração `model`/`effort` dos subagentes.
- O roteamento depende dos modelos estarem disponíveis no plano/provedor e de uma versão compatível do Claude Code.
- A variável `CLAUDE_CODE_EFFORT_LEVEL` tem precedência sobre o esforço dos subagentes. O script a remove temporariamente para o processo Claude e restaura o valor ao terminar.
- O fluxo reduz trocas manuais de modelos, mas não remove aprovações de permissões, bloqueios de autenticação, limites de uso ou autorizações para ações externas/destrutivas.
- Não usar `--dangerously-skip-permissions` como atalho para autonomia.

## Atualização do código-fonte

O modelo Markdown, YAML, JSON Schema, tipos, validação, API e banco devem permanecer alinhados. A base de Thiago serve apenas para testar a plataforma com um perfil realista, não para definir campos obrigatórios ou comportamento universal.
