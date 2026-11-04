import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

/**
 * Regras de dependencia entre workspaces (docs/architecture.md secao 2.1, ADR-0008).
 * Funcoes puras sobre `SourceFile`/`Manifest`, mais o coletor que le o disco.
 */

export interface SourceFile {
  /** Caminho relativo a raiz, com `/`. */
  path: string;
  imports: string[];
}

export interface Manifest {
  /** Diretorio do workspace, ex.: `packages/db`. */
  dir: string;
  dependencies: string[];
  devDependencies: string[];
}

export interface Violation {
  rule: string;
  where: string;
  detail: string;
}

/** Pacotes internos que cada workspace pode importar (nomes curtos de @chameleon/<nome>). */
export const ALLOWED_INTERNAL: Readonly<Record<string, readonly string[]>> = {
  'packages/contracts': [],
  'packages/domain': ['contracts'],
  'packages/profile-io': ['contracts', 'domain'],
  'packages/ai': ['contracts', 'domain'],
  'packages/documents': ['contracts', 'domain'],
  'packages/db': ['contracts'],
  // test-fixtures valida as fixtures com o contrato e o importador (somente em testes; profile-io nao pode depender dele).
  'packages/test-fixtures': ['contracts', 'profile-io'],
  'apps/api': ['contracts', 'domain', 'profile-io', 'db', 'ai', 'documents'],
  'apps/web': ['contracts'],
};

const SCOPE = '@chameleon/';
const PRISMA = /^(@prisma\/|prisma$)/;
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'generated',
  '.data',
  '.git',
  'fixtures-private',
  'playwright-report',
  'test-results',
]);

export function extractImports(code: string): string[] {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
  for (const match of withoutComments.matchAll(pattern)) {
    if (match[2]) found.push(match[2]);
  }
  return found;
}

/** `packages/db/src/x.ts` -> `packages/db`; `apps/api/...` -> `apps/api`; senao undefined. */
export function workspaceOf(path: string): string | undefined {
  const match = /^(apps|packages)\/([^/]+)\//.exec(path);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function internalName(specifier: string): string | undefined {
  if (!specifier.startsWith(SCOPE)) return undefined;
  return specifier.slice(SCOPE.length).split('/')[0];
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes('/test/');
}

function selfName(workspace: string): string {
  return workspace.split('/')[1] ?? workspace;
}

export function findViolations(files: SourceFile[], manifests: Manifest[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const workspace = workspaceOf(file.path);
    for (const specifier of file.imports) {
      // R1: o Prisma so existe dentro de packages/db.
      if (PRISMA.test(specifier) && workspace !== 'packages/db') {
        violations.push({
          rule: 'prisma-boundary',
          where: file.path,
          detail: `importa "${specifier}" fora de packages/db`,
        });
      }
      if (!workspace) continue;

      // R2/R3: matriz de dependencias internas.
      const name = internalName(specifier);
      if (name && name !== selfName(workspace)) {
        const allowed = new Set(ALLOWED_INTERNAL[workspace] ?? []);
        if (isTestFile(file.path)) allowed.add('test-fixtures');
        if (!allowed.has(name)) {
          violations.push({
            rule: 'internal-dependency',
            where: file.path,
            detail: `${workspace} nao pode importar ${SCOPE}${name}`,
          });
        }
      }

      // R4: nada importa por caminho relativo para fora do proprio workspace.
      if (specifier.startsWith('.')) {
        const target = posix.normalize(posix.join(posix.dirname(file.path), specifier));
        if (!target.startsWith(`${workspace}/`) && target !== workspace) {
          violations.push({
            rule: 'relative-escape',
            where: file.path,
            detail: `import relativo "${specifier}" sai de ${workspace}`,
          });
        }
      }
    }
  }

  // Manifestos: dependencies seguem a mesma matriz; devDependencies so podem acrescentar test-fixtures.
  for (const manifest of manifests) {
    const allowed = ALLOWED_INTERNAL[manifest.dir];
    if (!allowed) continue;
    for (const dep of manifest.dependencies) {
      const name = internalName(dep);
      if (name && !allowed.includes(name)) {
        violations.push({
          rule: 'manifest-dependency',
          where: `${manifest.dir}/package.json`,
          detail: `dependencies inclui ${dep}, nao permitido`,
        });
      }
    }
    for (const dep of manifest.devDependencies) {
      const name = internalName(dep);
      if (name && !allowed.includes(name) && name !== 'test-fixtures') {
        violations.push({
          rule: 'manifest-dependency',
          where: `${manifest.dir}/package.json`,
          detail: `devDependencies inclui ${dep}, nao permitido`,
        });
      }
    }
    // Somente packages/db declara o Prisma.
    if (manifest.dir !== 'packages/db') {
      for (const dep of [...manifest.dependencies, ...manifest.devDependencies]) {
        if (PRISMA.test(dep)) {
          violations.push({
            rule: 'prisma-boundary',
            where: `${manifest.dir}/package.json`,
            detail: `declara ${dep} fora de packages/db`,
          });
        }
      }
    }
  }

  // Ciclos entre pacotes internos (dependencies + devDependencies).
  const graph = new Map<string, string[]>();
  for (const manifest of manifests) {
    const edges = [...manifest.dependencies, ...manifest.devDependencies]
      .map(internalName)
      .filter((n): n is string => n !== undefined);
    graph.set(selfName(manifest.dir), edges);
  }
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string, trail: string[]): void => {
    if (done.has(node)) return;
    if (visiting.has(node)) {
      violations.push({
        rule: 'cycle',
        where: node,
        detail: `ciclo: ${[...trail, node].join(' -> ')}`,
      });
      return;
    }
    visiting.add(node);
    for (const next of graph.get(node) ?? []) visit(next, [...trail, node]);
    visiting.delete(node);
    done.add(node);
  };
  for (const node of graph.keys()) visit(node, []);

  return violations;
}

// ---------------------------------------------------------------------------
// Leitura do disco
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
}

export function collectSourceFiles(root: string): SourceFile[] {
  const files: string[] = [];
  for (const top of ['apps', 'packages', 'tests', 'scripts', 'e2e']) {
    const dir = join(root, top);
    if (existsDir(dir)) walk(dir, files);
  }
  for (const entry of readdirSync(root)) {
    if (/^[^.].*\.(ts|js|mjs|cjs)$/.test(entry)) files.push(join(root, entry));
  }
  return (
    files
      .map((full) => relative(root, full).split(sep).join('/'))
      // O proprio verificador contem especificadores de exemplo; nao o analise.
      .filter((path) => !path.startsWith('tests/architecture/'))
      .map((path) => ({
        path,
        imports: extractImports(readFileSync(resolve(root, path), 'utf8')),
      }))
  );
}

function existsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function collectManifests(root: string): Manifest[] {
  const manifests: Manifest[] = [];
  for (const top of ['apps', 'packages']) {
    const base = join(root, top);
    if (!existsDir(base)) continue;
    for (const entry of readdirSync(base)) {
      const file = join(base, entry, 'package.json');
      try {
        const json = JSON.parse(readFileSync(file, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        manifests.push({
          dir: `${top}/${entry}`,
          dependencies: Object.keys(json.dependencies ?? {}),
          devDependencies: Object.keys(json.devDependencies ?? {}),
        });
      } catch {
        // diretorio sem package.json: ignorado
      }
    }
  }
  return manifests;
}

export function repoRoot(fromDir: string): string {
  return resolve(fromDir, '..', '..');
}
