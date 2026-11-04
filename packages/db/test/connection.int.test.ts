import pg from 'pg';
import { describe, expect, it } from 'vitest';

/**
 * Teste de fumaca de integracao: conecta ao cluster local (ou ao service do CI) usando
 * TEST_DATABASE_ADMIN_URL. O harness por worker (template + clones) entra na S1.1a.
 */
describe('conexao com o PostgreSQL de teste', () => {
  it('TEST_DATABASE_ADMIN_URL esta definida', () => {
    expect(
      process.env.TEST_DATABASE_ADMIN_URL,
      'Defina TEST_DATABASE_ADMIN_URL (veja .env.example) e inicie o banco: pnpm db:local:start',
    ).toBeTruthy();
  });

  it('conecta e informa a versao do servidor (>= 16)', async () => {
    const connectionString = process.env.TEST_DATABASE_ADMIN_URL;
    expect(connectionString).toBeTruthy();
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      const result = await client.query<{ major: number }>(
        `SELECT current_setting('server_version_num')::int / 10000 AS major`,
      );
      expect(result.rows[0]?.major).toBeGreaterThanOrEqual(16);
    } finally {
      await client.end();
    }
  });
});
