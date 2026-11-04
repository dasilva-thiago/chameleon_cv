import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, SESSION_TIMEZONE_OPTION, type Db } from '../client';
import {
  TEST_DB_PREFIX,
  assertLocalConnectionString,
  assertSafeTestDbName,
  dropDatabase,
  quoteIdent,
  resolveAdminUrl,
  stampDatabase,
  urlForDatabase,
  withAdmin,
} from './admin';
import { ensureTemplateDatabase } from './template';

export interface TestDb {
  /** Nome do banco clonado (`chameleon_test_<run>_w<worker>_<n>`). */
  readonly name: string;
  /** URL de conexao do clone (use em `createDb({ connectionString })` ou em servidores de teste). */
  readonly url: string;
  /** Clientes do Prisma ja ligados ao clone (forOwner, global, unsafeRaw). */
  readonly db: Db;
  /** SQL cru (pg) no clone: para provocar violacoes de FK/CHECK e inspecionar o catalogo. */
  sql<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>;
  /** Esvazia todas as tabelas (exceto `_prisma_migrations`): limpeza entre testes do mesmo arquivo. */
  truncateAll(): Promise<void>;
  /** Fecha as conexoes e remove o clone. Idempotente. */
  drop(): Promise<void>;
}

export interface CreateTestDbOptions {
  /** Padrao: TEST_DATABASE_ADMIN_URL. Recusado se o host nao for local. */
  adminUrl?: string;
}

const requestedRunId = (process.env.CHAMELEON_TEST_RUN_ID ?? '')
  .replace(/[^a-z0-9]/gi, '')
  .toLowerCase();
const runId = requestedRunId === '' ? randomBytes(3).toString('hex') : requestedRunId;
let sequence = 0;

function workerId(): string {
  const id = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? '0';
  return id.replace(/[^0-9]/g, '') || '0';
}

const CLONE_RETRIES = 20;
const OBJECT_IN_USE = '55006';

async function cloneDatabase(adminUrl: string, template: string, name: string): Promise<void> {
  await withAdmin(adminUrl, async (client) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE "${template}"`);
        await stampDatabase(client, name);
        // CREATE DATABASE ... TEMPLATE nao copia ALTER DATABASE SET: reaplica o fuso UTC no clone.
        await client.query(`ALTER DATABASE ${quoteIdent(name)} SET timezone TO 'UTC'`);
        return;
      } catch (error) {
        // Outro worker clonando o mesmo template ao mesmo tempo: tenta de novo.
        const code = (error as { code?: string }).code;
        if (code !== OBJECT_IN_USE || attempt >= CLONE_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
  });
}

/**
 * Cria um banco isolado, clonado do template migrado (ADR-0002). Chame em `beforeAll` (um clone por
 * arquivo de teste) e `drop()` em `afterAll`. O primeiro uso de cada processo garante o template.
 */
export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestDb> {
  const adminUrl = options.adminUrl ?? resolveAdminUrl();
  assertLocalConnectionString(adminUrl, 'adminUrl');
  const template = await ensureTemplateDatabase(adminUrl);
  const name = `${TEST_DB_PREFIX}${runId}_w${workerId()}_${++sequence}`;
  assertSafeTestDbName(name);
  await cloneDatabase(adminUrl, template, name);

  const url = urlForDatabase(adminUrl, name);
  const db = createDb({ connectionString: url, maxConnections: 4 });
  const pool = new pg.Pool({ connectionString: url, max: 2, options: SESSION_TIMEZONE_OPTION });
  let dropped = false;

  return {
    name,
    url,
    db,
    sql: (text, params) => pool.query(text, params),
    async truncateAll() {
      const { rows } = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
      );
      if (rows.length === 0) return;
      const tables = rows.map((row) => `"${row.tablename.replaceAll('"', '""')}"`).join(', ');
      await pool.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    },
    async drop() {
      if (dropped) return;
      dropped = true;
      await db.$disconnect();
      await pool.end();
      await withAdmin(adminUrl, (client) => dropDatabase(client, name));
    },
  };
}

/** Cria o banco, executa `fn` e remove o banco mesmo se `fn` falhar. */
export async function withTestDb<T>(
  fn: (testDb: TestDb) => Promise<T>,
  options?: CreateTestDbOptions,
): Promise<T> {
  const testDb = await createTestDb(options);
  try {
    return await fn(testDb);
  } finally {
    await testDb.drop();
  }
}
