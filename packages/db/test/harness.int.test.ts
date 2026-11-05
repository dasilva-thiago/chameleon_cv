import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertLocalConnectionString,
  createTestDb,
  ensureTemplateDatabase,
  migrationsHash,
  resolveAdminUrl,
  templateName,
  withTestDb,
  type TestDb,
} from '../src/testing';
import { assertSafeTestDbName } from '../src/testing/admin';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'migrations');

async function databaseExists(name: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: resolveAdminUrl() });
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return result.rowCount === 1;
  } finally {
    await client.end();
  }
}

describe('harness de banco por worker (ADR-0002)', () => {
  const created: TestDb[] = [];
  afterAll(async () => {
    await Promise.all(created.map((testDb) => testDb.drop()));
  });
  const track = async (): Promise<TestDb> => {
    const testDb = await createTestDb();
    created.push(testDb);
    return testDb;
  };

  it('constroi o template migrado uma unica vez (nome derivado do hash das migracoes)', async () => {
    const name = await ensureTemplateDatabase(resolveAdminUrl());
    expect(name).toBe(templateName());
    expect(name).toMatch(/^chameleon_test_tpl_[0-9a-f]{12}$/);
    expect(migrationsHash()).toBe(migrationsHash());
    expect(await ensureTemplateDatabase(resolveAdminUrl())).toBe(name);
    expect(await databaseExists(name)).toBe(true);
  });

  it('cria um clone migrado com o nome do worker e o remove ao final', async () => {
    const testDb = await createTestDb();
    expect(testDb.name).toMatch(/^chameleon_test_[0-9a-f]{6}_w\d+_\d+$/);
    expect(await databaseExists(testDb.name)).toBe(true);

    const tables = await testDb.sql<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`,
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual(
      expect.arrayContaining(['User', 'Session', 'Invite', 'ConsentRecord', 'Credential']),
    );
    const applied = await testDb.sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`,
    );
    const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    ).length;
    expect(applied.rows[0]?.n).toBe(onDisk);

    await testDb.drop();
    expect(await databaseExists(testDb.name)).toBe(false);
    await testDb.drop(); // idempotente
    // Cloning the template database competes with the other workers: give it room (it flaked at 30 s under load).
  }, 120_000);

  it('o clone ja nasce vazio e os clones nao compartilham estado', async () => {
    const [a, b] = [await track(), await track()];
    expect(a.name).not.toBe(b.name);
    await a.db.global.user.create({ data: { email: 'solo@example.test' } });
    expect(await a.db.global.user.count()).toBe(1);
    expect(await b.db.global.user.count()).toBe(0);
  });

  it('o template permanece intocado pelos clones', async () => {
    const testDb = await track();
    await testDb.db.global.user.create({ data: { email: 'tpl@example.test' } });
    const next = await track();
    expect(await next.db.global.user.count()).toBe(0);
  });

  it('truncateAll limpa todas as tabelas e preserva _prisma_migrations', async () => {
    const testDb = await track();
    const user = await testDb.db.global.user.create({ data: { email: 'trunc@example.test' } });
    await testDb.db.forOwner(user.id).consentRecord.create({
      data: { ownerId: user.id, purpose: 'profile_processing', granted: true, policyVersion: 'v1' },
    });
    await testDb.truncateAll();
    expect(await testDb.db.global.user.count()).toBe(0);
    expect(await testDb.db.forOwner(user.id).consentRecord.count()).toBe(0);
    const migrations = await testDb.sql<{ n: number }>(
      'SELECT count(*)::int AS n FROM _prisma_migrations',
    );
    expect(migrations.rows[0]?.n).toBeGreaterThan(0);
  });

  it('withTestDb remove o banco mesmo quando o corpo falha', async () => {
    let name = '';
    await expect(
      withTestDb(async (testDb) => {
        name = testDb.name;
        expect(await databaseExists(name)).toBe(true);
        throw new Error('falha de proposito');
      }),
    ).rejects.toThrow('falha de proposito');
    expect(await databaseExists(name)).toBe(false);
  });

  it('cria clones em paralelo sem colidir (corrida no mesmo template)', async () => {
    const batch = await Promise.all(Array.from({ length: 4 }, () => createTestDb()));
    created.push(...batch);
    expect(new Set(batch.map((t) => t.name)).size).toBe(4);
  });
});

describe('seguranca do harness', () => {
  it.each([
    'postgresql://u:p@db.example.com:5432/postgres',
    'postgresql://u@10.0.0.5:5432/postgres',
    'postgresql://u@127.0.0.1.evil.com:5432/postgres',
  ])('recusa host nao local: %s', async (url) => {
    expect(() => assertLocalConnectionString(url, 'x')).toThrow(/nao e local/);
    expect(() => resolveAdminUrl({ TEST_DATABASE_ADMIN_URL: url })).toThrow(/nao e local/);
    await expect(createTestDb({ adminUrl: url })).rejects.toThrow(/nao e local/);
    await expect(ensureTemplateDatabase(url)).rejects.toThrow(/nao e local/);
  });

  it.each(['postgresql://u@127.0.0.1:54329/postgres', 'postgresql://u@localhost:5432/postgres'])(
    'aceita host local: %s',
    (url) => {
      expect(() => assertLocalConnectionString(url, 'x')).not.toThrow();
    },
  );

  it('exige TEST_DATABASE_ADMIN_URL e valida a URL', () => {
    expect(() => resolveAdminUrl({})).toThrow(/TEST_DATABASE_ADMIN_URL nao definida/);
    expect(() => assertLocalConnectionString('nao-e-url', 'x')).toThrow(/URL de conexao valida/);
  });

  it.each(['chameleon_dev', 'postgres', 'chameleon', 'chameleon_test_', 'chameleon_test_X;DROP'])(
    'nao permite remover o banco "%s"',
    (name) => {
      expect(() => assertSafeTestDbName(name)).toThrow();
    },
  );
});
