import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './deps-lib';

/**
 * Design system gate (docs/PLANO_IDENTIDADE_VISUAL.md, criterion 1): the web app colors everything through the
 * semantic tokens of apps/web/src/index.css, so the light and dark themes and the meaning of each color cannot drift
 * screen by screen. A raw Tailwind palette class or a hex literal in a component fails this test.
 */

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const UTILITIES =
  'bg|text|border|border-[trblxy]|divide|outline|ring|ring-offset|accent|from|via|to|fill|stroke|shadow|placeholder|decoration|caret';

const RAW_CLASS = new RegExp(
  `(?<![\\w-])(?:[\\w-]+:)*(?:${UTILITIES})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:\\/\\d+)?(?![\\w-])`,
  'g',
);
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

export function rawColorsIn(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  return [...(code.match(RAW_CLASS) ?? []), ...(code.match(HEX) ?? [])];
}

describe('tokens de design na web', () => {
  const files = sourceFiles(WEB_SRC);

  it('varre os componentes (guarda contra varredura vazia)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('nenhuma cor crua do Tailwind nem hex solto fora de index.css', () => {
    const findings = files.flatMap((file) =>
      rawColorsIn(readFileSync(file, 'utf8')).map(
        (match) => `${relative(ROOT, file).replace(/\\/g, '/')}: ${match}`,
      ),
    );
    expect(findings).toEqual([]);
  });

  it('o detector reconhece cores cruas e ignora tokens', () => {
    expect(rawColorsIn('className="bg-slate-100 hover:text-blue-800 text-white"')).toEqual([
      'bg-slate-100',
      'hover:text-blue-800',
      'text-white',
    ]);
    expect(rawColorsIn('style={{ color: "#10b981" }}')).toEqual(['#10b981']);
    expect(
      rawColorsIn('className="bg-surface text-ink-1 border-line-strong bg-brand/40 text-on-brand"'),
    ).toEqual([]);
  });
});
