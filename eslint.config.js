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

/** `$queryRaw` & cia. so existem dentro de packages/db. */
const RAW_SQL_SELECTOR =
  'MemberExpression[property.name=/^\\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)$/]';

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
    rules: {
      ...restrictImports(),
      'no-restricted-syntax': [
        'error',
        {
          selector: RAW_SQL_SELECTOR,
          message: 'SQL cru ($queryRaw/$executeRaw) so e permitido dentro de packages/db.',
        },
      ],
    },
  },

  // contracts: apenas zod; sem pacotes internos nem IO.
  {
    files: ['packages/contracts/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'web', 'domain', 'profile-io', 'db', 'ai', 'documents', 'test-fixtures'],
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
        ['api', 'web', 'profile-io', 'db', 'ai', 'documents', 'test-fixtures'],
        'domain so pode importar @chameleon/contracts.',
      ),
      { group: ['express', 'pg', 'pino'], message: 'domain e puro: sem frameworks nem IO.' },
      NODE_BUILTIN_PATTERN,
    ),
  },
  {
    files: ['packages/profile-io/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'web', 'db', 'ai', 'documents', 'test-fixtures'],
        'profile-io so importa contracts e domain.',
      ),
    ),
  },
  {
    files: ['packages/ai/src/**', 'packages/documents/src/**'],
    rules: restrictImports(
      forbidInternal(
        ['api', 'web', 'db', 'profile-io', 'test-fixtures'],
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
              ['api', 'web', 'domain', 'profile-io', 'ai', 'documents'],
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
        ['api', 'db', 'domain', 'profile-io', 'ai', 'documents', 'test-fixtures'],
        'apps/web so pode importar @chameleon/contracts.',
      ),
    ),
  },
  // test-fixtures so e importavel por arquivos de teste (src de producao da api nao importa).
  {
    files: ['apps/api/src/**'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: restrictImports(
      forbidInternal(['test-fixtures'], 'test-fixtures e importavel apenas por arquivos de teste.'),
      forbidInternal(['web'], 'api nao importa apps/web.'),
    ),
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
