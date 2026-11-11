// ESLint 9 (flat config). Ver docs/architecture.md secao 2.1 e ADR-0008 (item 3).
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts', '**/*.tsx'];
const SOURCE_FILES = ['**/*.{ts,tsx,js,jsx,mjs,cjs}'];

/** `@prisma/*` so pode ser importado por packages/db (ADR-0008). */
const PRISMA_PATTERN = {
  group: ['@prisma/*'],
  message: 'Importe @prisma/* somente dentro de packages/db; use @chameleon/db nos demais pacotes.',
};

const NODE_BUILTIN_PATTERN = {
  group: ['node:*', 'fs', 'fs/*', 'path', 'child_process', 'net', 'http', 'https'],
  message: 'Este pacote e puro/isomorfico: sem IO nem modulos do Node.',
};

const forbidInternal = (names, message) => ({
  group: names.map((name) => `@chameleon/${name}`).flatMap((n) => [n, `${n}/*`]),
  message,
});

/** Constroi a regra `no-restricted-imports` sempre incluindo a fronteira do Prisma. */
const restrictImports = (...extraPatterns) => ({
  'no-restricted-imports': ['error', { patterns: [PRISMA_PATTERN, ...extraPatterns] }],
});

/**
 * Restricted database access (ADR-0008 items 2 and 3). Raw SQL members (`$queryRaw*`,
 * `$executeRaw*`, `$queryRawTyped`, `$runCommandRaw`) are reachable only from packages/db and the
 * auth module (apps/api/src/auth/**); the unrestricted handles `unsafeRaw` and `.global` only from
 * the same places in production code. The selectors cover plain member access, computed access with
 * a string/template literal, optional chaining, destructuring (also with a computed or quoted key)
 * and, best effort, dynamic keys on db-like objects (`db[k]`). The structural defense is that domain
 * modules are never handed a `Db` (see apps/api/src/app.ts); this rule is the second line.
 * Proven by apps/api/test/eslint-restricted-access.test.ts.
 */
const RAW_NAMES = '^\\$(queryRaw|executeRaw|runCommandRaw)\\w*$';
const ACCESS_NAMES = '^(unsafeRaw|global)$';
const DB_LIKE_OBJECT = '^(db|prisma|tx|client|unsafeRaw|.*Db|.*Client|.*Prisma)$';

const restrictedNameSelectors = (names, message) => [
  { selector: `MemberExpression[computed=false][property.name=/${names}/]`, message },
  { selector: `MemberExpression[computed=true][property.value=/${names}/]`, message },
  {
    selector: `MemberExpression[computed=true][property.type='TemplateLiteral'][property.quasis.0.value.cooked=/${names}/]`,
    message,
  },
  { selector: `ObjectPattern > Property[key.name=/${names}/]`, message },
  { selector: `ObjectPattern > Property[key.value=/${names}/]`, message },
];

const RAW_SQL_SELECTORS = restrictedNameSelectors(
  RAW_NAMES,
  'Raw SQL ($queryRaw*/$executeRaw*/$runCommandRaw) is only allowed in packages/db and apps/api/src/auth.',
);

const UNRESTRICTED_DB_SELECTORS = [
  ...restrictedNameSelectors(
    ACCESS_NAMES,
    'db.global / db.unsafeRaw bypass owner scoping: only packages/db and apps/api/src/auth may use them. Use req.auth.db (db.forOwner).',
  ),
  {
    selector: `MemberExpression[computed=true][property.type='Identifier']:matches([object.name=/${DB_LIKE_OBJECT}/i], [object.property.name=/${DB_LIKE_OBJECT}/i])`,
    message:
      'Dynamic property access on a database client can reach global/unsafeRaw/$queryRaw: use an explicit model delegate.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/generated/**',
      '.data/**',
      'fixtures-private/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
    ],
  },

  js.configs.recommended,
  {
    files: TS_FILES,
    extends: [tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Fronteira do Prisma: todo o repositorio, exceto packages/db.
  {
    files: SOURCE_FILES,
    ignores: ['packages/db/**'],
    rules: restrictImports(),
  },
  // Raw SQL: only packages/db and the auth module.
  {
    files: SOURCE_FILES,
    ignores: ['packages/db/**', 'apps/api/src/auth/**'],
    rules: { 'no-restricted-syntax': ['error', ...RAW_SQL_SELECTORS] },
  },
  // Unrestricted handles (db.global / db.unsafeRaw) in production code: same allowlist. Test files
  // may inspect the database with the unrestricted client on purpose.
  {
    files: [
      'apps/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      'packages/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    ],
    ignores: ['packages/db/**', 'apps/api/src/auth/**'],
    rules: {
      'no-restricted-syntax': ['error', ...RAW_SQL_SELECTORS, ...UNRESTRICTED_DB_SELECTORS],
    },
  },

  // contracts: apenas zod; sem pacotes internos nem IO.
  {
    files: ['packages/contracts/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'web', 'domain', 'db', 'ai', 'documents'],
        'contracts nao importa nenhum outro pacote interno.',
      ),
      NODE_BUILTIN_PATTERN,
    ),
  },
  // domain: puro; so contracts.
  {
    files: ['packages/domain/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'web', 'db', 'ai', 'documents'],
        'domain so pode importar @chameleon/contracts.',
      ),
      { group: ['express', 'pg', 'pino'], message: 'domain e puro: sem frameworks nem IO.' },
      NODE_BUILTIN_PATTERN,
    ),
  },
  {
    files: ['packages/ai/src/**', 'packages/documents/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'web', 'db'],
        'ai/documents so importam contracts e domain (e nao importam db nem uma a outra).',
      ),
      forbidInternal(['ai', 'documents'], 'ai e documents sao independentes entre si.'),
    ),
  },
  {
    files: ['packages/db/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            forbidInternal(
              ['api', 'web', 'domain', 'ai', 'documents'],
              'db so pode importar @chameleon/contracts.',
            ),
          ],
        },
      ],
    },
  },
  // web: so contracts. Sem pacotes de servidor no bundle.
  {
    files: ['apps/web/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'db', 'domain', 'ai', 'documents'],
        'apps/web so pode importar @chameleon/contracts.',
      ),
    ),
  },
  {
    files: ['apps/api/src/**'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: restrictImports(forbidInternal(['web'], 'api nao importa apps/web.')),
  },

  // React (apps/web): hooks + acessibilidade.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [jsxA11y.flatConfigs.recommended, reactHooks.configs.flat['recommended-latest']],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Node (api, scripts, configs).
  {
    files: [
      'apps/api/**/*.ts',
      'scripts/**/*.mjs',
      '*.js',
      '*.ts',
      'tests/**/*.ts',
      '**/scripts/*.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
  },

  // JS puro: sem checagem de tipos.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
