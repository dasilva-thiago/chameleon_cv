import { defineConfig } from '@playwright/test';

const API_PORT = process.env.E2E_API_PORT ?? '3100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5273';

/**
 * End-to-end run on the real stack: the API on a throw-away migrated database (`e2e/start-api.ts`), the web app
 * served by Vite (proxying /api to that API) and a real Chromium. One worker: the spec is a single story.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec tsx e2e/start-api.ts',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { E2E_API_PORT: API_PORT, E2E_WEB_PORT: WEB_PORT },
    },
    {
      command: `pnpm --filter @chameleon/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PORT },
    },
  ],
});
