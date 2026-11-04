$ErrorActionPreference = 'Stop'

if (-not (Get-Command 'claude' -ErrorAction SilentlyContinue)) {
    Write-Error 'Claude Code CLI nao foi encontrado no PATH. Instale/atualize o Claude Code e tente novamente.'
    exit 1
}

$plan = Join-Path (Get-Location) 'PLANO_DESENVOLVIMENTO_GERADOR_CURRICULOS_V3.md'
if (-not (Test-Path $plan)) {
    Write-Warning 'O plano V3 nao foi encontrado na pasta atual. Execute este script a partir da raiz do repositorio ou copie o plano para ela.'
}

Write-Host 'Iniciando Claude Code com Sonnet high como orquestrador.' -ForegroundColor Cyan
Write-Host 'Os subagentes selecionam Opus ou Sonnet e seus esforcos conforme .claude/agents/.' -ForegroundColor DarkCyan
Write-Host 'Nao sera necessario alternar /model ou /effort durante as fases.' -ForegroundColor DarkCyan

# A variavel de ambiente tem precedencia sobre o effort dos subagentes.
# Remova-a temporariamente para iniciar o processo e restaure-a ao terminar.
$previousEffort = $env:CLAUDE_CODE_EFFORT_LEVEL
try {
    Remove-Item Env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue
    & claude --model sonnet --effort high
    $claudeExitCode = $LASTEXITCODE
} finally {
    if ($null -eq $previousEffort) {
        Remove-Item Env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue
    } else {
        $env:CLAUDE_CODE_EFFORT_LEVEL = $previousEffort
    }
}
exit $claudeExitCode
