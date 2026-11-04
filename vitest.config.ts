import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Carrega o .env local (se existir) sem sobrescrever variaveis ja definidas no ambiente.
// Assim `pnpm test:integration` usa TEST_DATABASE_ADMIN_URL de .env sem passos extras.
try {
  process.loadEnvFile('.env');
} catch {
  // sem .env: o ambiente (ex.: CI) deve fornecer as variaveis.
}

const INTEGRATION = ['**/*.int.test.ts', 'tests/integration/**/*.test.ts'];
const COMMON_EXCLUDE = ['**/node_modules/**', '**/dist/**', '**/.data/**', 'e2e/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['**/*.test.ts', '**/*.test.tsx'],
          exclude: [...COMMON_EXCLUDE, ...INTEGRATION, 'apps/web/**'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/**/*.test.ts', 'apps/web/**/*.test.tsx'],
          exclude: [...COMMON_EXCLUDE, ...INTEGRATION],
          setupFiles: ['apps/web/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: INTEGRATION,
          exclude: COMMON_EXCLUDE,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Os bancos por worker (S1.1a) tornam seguro o paralelismo entre arquivos.
          // globalSetup (template migrado) sera adicionado na S1.1a.
        },
      },
    ],
  },
});
