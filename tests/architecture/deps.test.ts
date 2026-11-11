import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_INTERNAL,
  collectManifests,
  collectSourceFiles,
  extractImports,
  findViolations,
  repoRoot,
  type Manifest,
  type SourceFile,
} from './deps-lib';

const ROOT = repoRoot(dirname(fileURLToPath(import.meta.url)));

const manifest = (dir: string, dependencies: string[] = [], devDependencies: string[] = []) =>
  ({ dir, dependencies, devDependencies }) satisfies Manifest;
const file = (path: string, ...imports: string[]) => ({ path, imports }) satisfies SourceFile;

describe('grafo de dependencias do repositorio real', () => {
  const files = collectSourceFiles(ROOT);
  const manifests = collectManifests(ROOT);

  it('encontra os workspaces esperados (guarda contra varredura vazia)', () => {
    expect(manifests.map((m) => m.dir).sort()).toEqual(Object.keys(ALLOWED_INTERNAL).sort());
    expect(files.length).toBeGreaterThan(20);
  });

  it('nao ha violacoes (contracts/domain isolados, Prisma so em packages/db, web so com contracts)', () => {
    expect(findViolations(files, manifests)).toEqual([]);
  });

  it('packages/contracts e packages/domain nao importam apps/* nem @prisma/*', () => {
    for (const f of files.filter((x) => /^packages\/(contracts|domain)\//.test(x.path))) {
      for (const specifier of f.imports) {
        expect(specifier, f.path).not.toMatch(/^@prisma\//);
        expect(specifier, f.path).not.toMatch(/^@chameleon\/(api|web)$/);
        expect(specifier, f.path).not.toMatch(/apps\//);
      }
    }
  });

  it('apps/web nao importa packages/db, ai nem documents', () => {
    for (const f of files.filter((x) => x.path.startsWith('apps/web/'))) {
      for (const specifier of f.imports) {
        expect(specifier, f.path).not.toMatch(/^@chameleon\/(db|ai|documents)(\/|$)/);
        expect(specifier, f.path).not.toMatch(/packages\/(db|ai|documents)/);
      }
    }
  });
});

describe('verificador (o teste de grafo detecta violacoes)', () => {
  it('extrai importacoes estaticas, dinamicas, re-exports e require, ignorando comentarios', () => {
    const code = `
      import a from 'a';
      import type { B } from "b";
      import 'side-effect';
      export * from 'c';
      const d = await import('d');
      const e = require('e');
      // import x from 'comentado'
      /* import y from 'bloco' */
    `;
    expect(extractImports(code).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'side-effect']);
  });

  it('reprova @prisma/* fora de packages/db e aceita dentro', () => {
    const violations = findViolations(
      [
        file('apps/api/src/x.ts', '@prisma/client'),
        file('packages/domain/src/y.ts', '@prisma/adapter-pg'),
        file('tests/z.test.ts', '@prisma/client'),
        file('packages/db/src/ok.ts', '@prisma/client'),
      ],
      [],
    );
    expect(violations.map((v) => v.where).sort()).toEqual([
      'apps/api/src/x.ts',
      'packages/domain/src/y.ts',
      'tests/z.test.ts',
    ]);
  });

  it('reprova domain/contracts importando apps/* e pacotes nao permitidos', () => {
    const violations = findViolations(
      [
        file('packages/domain/src/a.ts', '@chameleon/api', '@chameleon/db', '@chameleon/contracts'),
        file('packages/contracts/src/b.ts', '@chameleon/domain', '../../../apps/api/src/app'),
      ],
      [],
    );
    expect(violations.map((v) => v.detail)).toEqual(
      expect.arrayContaining([
        'packages/domain nao pode importar @chameleon/api',
        'packages/domain nao pode importar @chameleon/db',
        'packages/contracts nao pode importar @chameleon/domain',
      ]),
    );
    expect(violations.some((v) => v.rule === 'relative-escape')).toBe(true);
  });

  it('reprova apps/web importando db, ai ou documents', () => {
    const violations = findViolations(
      [file('apps/web/src/a.tsx', '@chameleon/db', '@chameleon/ai', '@chameleon/documents')],
      [],
    );
    expect(violations).toHaveLength(3);
  });

  it('reprova dependencias de manifesto proibidas, Prisma fora do db e ciclos', () => {
    const violations = findViolations(
      [],
      [
        manifest('packages/contracts', ['@chameleon/domain']),
        manifest('packages/domain', ['@chameleon/contracts', '@prisma/client']),
        manifest('apps/web', ['@chameleon/db']),
      ],
    );
    const rules = violations.map((v) => v.rule);
    expect(rules).toContain('manifest-dependency');
    expect(rules).toContain('prisma-boundary');
    expect(rules).toContain('cycle');
  });
});
