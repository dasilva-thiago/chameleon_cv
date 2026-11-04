import { createDb } from '@chameleon/db';
import { ConfigError, loadConfig } from '../config';
import { runAdminInvite } from './admin-invite';

/** Entrada do script `admin:invite` (ver apps/api/README.md). */
async function main(): Promise<number> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const db = createDb({ connectionString: config.DATABASE_URL, maxConnections: 2 });
  try {
    return await runAdminInvite(process.argv.slice(2), {
      db,
      appOrigin: config.APP_ORIGIN,
      stdout: (line) => console.log(line),
      stderr: (line) => console.error(line),
    });
  } finally {
    await db.$disconnect();
  }
}

process.exitCode = await main();
