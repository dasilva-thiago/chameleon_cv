# Roteamento automático de modelos

## Uma única inicialização

No PowerShell, a partir da raiz do repositório:

```powershell
.\scripts\iniciar-claude-code.ps1
```

Equivalente:

```powershell
claude --model sonnet --effort high
```

## Como os modelos serão usados

| Contexto | Modelo | Esforço |
|---|---|---|
| Orquestração da sessão principal | Sonnet | High |
| Auditoria inicial e arquitetura | Opus | XHigh |
| Implementação do modelo de dados | Sonnet | High |
| Backend | Sonnet | High |
| Frontend | Sonnet | High |
| QA e testes | Sonnet | High |
| Auditoria de segurança | Opus | XHigh |
| Auditoria arquitetural final | Opus | XHigh |

## Arquivos de configuração

- `.claude/settings.json`
- `.claude/agents/solution-architect.md`
- `.claude/agents/data-model-engineer.md`
- `.claude/agents/backend-implementer.md`
- `.claude/agents/frontend-implementer.md`
- `.claude/agents/qa-engineer.md`
- `.claude/agents/security-reviewer.md`
- `.claude/agents/final-architect-reviewer.md`

## Observações

A sessão principal permanece em Sonnet. Subagentes com `model` e `effort` no frontmatter executam as tarefas nos modelos e níveis de esforço configurados. O agente principal deve invocá-los explicitamente nos pontos do plano, sem solicitar trocas manuais.

A estratégia reduz pausas de configuração, mas não elimina aprovações de permissões, bloqueios de autenticação, limites de uso ou autorizações para ações externas/destrutivas.
