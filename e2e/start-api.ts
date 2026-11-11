/**
 * Starts the REAL API for the Playwright run against a throw-away, fully migrated database (a clone of the test
 * template, never the developer database), with a SCRIPTED AI provider (no call ever leaves the machine), creates one
 * invite and writes it to `e2e/.tmp/session.json` for the spec. The database is dropped when the process receives a termination signal; a left-over one from a killed run
 * is dropped at the next start.
 */
import { createTestDb } from '../packages/db/src/testing';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../packages/db/src';
import { createAiService } from '../apps/api/src/ai/service';
import { createApp } from '../apps/api/src/app';
import { createInvite } from '../apps/api/src/auth/invites';
import { loadConfig } from '../apps/api/src/config';
import { createLogger } from '../apps/api/src/logging';
import { scriptedProvider } from '../apps/api/test/helpers/scripted-provider';

// Local .env (database admin URL) without overriding variables already set, as vitest.config.ts does.
try {
  process.loadEnvFile('.env');
} catch {
  // no .env: the environment (CI) must provide TEST_DATABASE_ADMIN_URL
}

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, '.tmp');
const sessionFile = join(tmp, 'session.json');
const API_PORT = process.env.E2E_API_PORT ?? '3100';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5273';

mkdirSync(tmp, { recursive: true });
const testDb = await createTestDb();

try {
  const previous = (JSON.parse(readFileSync(sessionFile, 'utf8')) as { database?: string })
    .database;
  if (previous && /^chameleon_test_[A-Za-z0-9_]+$/.test(previous) && previous !== testDb.name) {
    await testDb.sql(`DROP DATABASE IF EXISTS "${previous}" WITH (FORCE)`);
  }
} catch {
  // first run: nothing to clean
}

const email = 'e2e.pessoa@example.test';
const { token } = await createInvite(testDb.db, { email });
writeFileSync(sessionFile, JSON.stringify({ email, token, database: testDb.name }));

let closing = false;
const close = (signal: string): void => {
  if (closing) return;
  closing = true;
  void testDb
    .drop()
    .catch(() => undefined)
    .finally(() => process.exit(signal === 'exit' ? 0 : 0));
};
process.on('SIGTERM', () => {
  close('SIGTERM');
});
process.on('SIGINT', () => {
  close('SIGINT');
});

Object.assign(process.env, {
  DATABASE_URL: testDb.url,
  APP_ORIGIN: `http://localhost:${WEB_PORT}`,
  API_PORT,
  SIGNUP_MODE: 'invite',
  TRUST_PROXY: '0',
  LOG_LEVEL: 'warn',
});
const config = loadConfig(process.env);
const db = createDb({ connectionString: config.DATABASE_URL });
const ai = createAiService({
  mode: 'auto',
  providers: [scriptedProvider()],
  limits: { totalDailyRequests: 1000, totalDailyTokens: 1_000_000 },
});
createApp({ config, logger: createLogger(config), db, ai }).listen(config.API_PORT, '127.0.0.1');
