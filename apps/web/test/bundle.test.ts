import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Gate "nenhum padrao de chave ou segredo no build da web" (plano, criterio da Fase 1).
 * Faz um build real de producao para um diretorio temporario e varre todos os arquivos.
 */
const SECRET_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'chave estilo OpenAI/Anthropic (sk-...)', pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: 'nome de variavel ANTHROPIC', pattern: /ANTHROPIC/i },
  { name: 'nome de variavel OPENAI', pattern: /OPENAI/i },
  { name: 'chave privada PEM', pattern: /BEGIN (?:[A-Z]+ )?PRIVATE KEY/ },
  { name: 'DATABASE_URL', pattern: /DATABASE_URL/ },
  { name: 'URL de banco com credenciais', pattern: /postgres(?:ql)?:\/\/[^\s"']*@/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'token GitHub', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'segredo de sessao/CSRF fixo', pattern: /SESSION_SECRET|API_KEY\s*[:=]/i },
];

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const outDir = mkdtempSync(join(tmpdir(), 'chameleon-web-bundle-'));
const webRoot = join(import.meta.dirname, '..');

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('bundle de producao da web', () => {
  it('nao contem chaves, segredos nem nomes de variaveis sensiveis', async () => {
    await build({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, write: true },
    });

    const files = listFiles(outDir);
    expect(files.some((file) => file.endsWith('.js'))).toBe(true);
    expect(files.some((file) => file.endsWith('index.html'))).toBe(true);

    const findings: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const { name, pattern } of SECRET_PATTERNS) {
        if (pattern.test(content)) findings.push(`${name} em ${file.slice(outDir.length + 1)}`);
      }
    }
    expect(findings).toEqual([]);
  }, 120_000);
});
