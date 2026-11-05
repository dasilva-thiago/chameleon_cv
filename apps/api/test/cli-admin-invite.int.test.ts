import { createHash } from 'node:crypto';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runAdminInvite } from '../src/cli/admin-invite';
import { buildTestApp, TEST_PASSWORD, TEST_SIGNUP_CONSENTS, TestClient } from './helpers';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll();
});

async function cli(args: string[], now?: Date) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAdminInvite(args, {
    db: testDb.db,
    appOrigin: 'https://cv.example.test',
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    ...(now ? { now: () => now } : {}),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const TOKEN_IN_OUTPUT = /^([A-Za-z0-9_-]{43})$/m;

describe('CLI admin:invite', () => {
  it('cria o convite: token mostrado uma vez, so o SHA-256 no banco, validade de 72h', async () => {
    const now = new Date('2026-11-04T12:00:00.000Z');
    const result = await cli(['Nova.Pessoa@Example.test'], now);
    expect(result.code).toBe(0);
    const token = TOKEN_IN_OUTPUT.exec(result.out)?.[1];
    expect(token).toBeDefined();
    expect(result.out).toContain(`https://cv.example.test/accept-invite#token=${token}`);

    // Leitura pelo Prisma (mesmo espaco de tempo da aplicacao; ver nota sobre fuso do cluster).
    const rows = await testDb.db.global.invite.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('nova.pessoa@example.test');
    expect(rows[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(token ?? '')
        .digest('hex'),
    );
    expect(rows[0]?.expiresAt.toISOString()).toBe('2026-11-07T12:00:00.000Z');
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('o token impresso funciona no aceite pela API', async () => {
    const result = await cli(['quem@example.test', '--expires-in-hours', '1']);
    const token = TOKEN_IN_OUTPUT.exec(result.out)?.[1] ?? '';
    const { app, config } = buildTestApp(testDb.db);
    const response = await new TestClient(app, config).post('/api/auth/invites/accept', {
      token,
      password: TEST_PASSWORD,
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(response.status).toBe(201);
  });

  it('recusa segundo convite em aberto, a nao ser com --replace; --revoke encerra', async () => {
    const first = await cli(['dup@example.test']);
    const firstToken = TOKEN_IN_OUTPUT.exec(first.out)?.[1] ?? '';

    const again = await cli(['dup@example.test']);
    expect(again.code).toBe(1);
    expect(again.err).toContain('--replace');

    const replaced = await cli(['dup@example.test', '--replace']);
    expect(replaced.code).toBe(0);
    expect(replaced.out).toContain('encerrado');
    const { app, config } = buildTestApp(testDb.db);
    const old = await new TestClient(app, config).post('/api/auth/invites/accept', {
      token: firstToken,
      password: TEST_PASSWORD,
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(old.status).toBe(400);

    const revoked = await cli(['dup@example.test', '--revoke']);
    expect(revoked.code).toBe(0);
    expect(revoked.out).toContain('revogados: 1');
    const open = await testDb.sql(`SELECT 1 FROM "Invite" WHERE "usedAt" IS NULL`);
    expect(open.rows).toHaveLength(0);
  });

  it('convite expirado em aberto e substituido sem --replace', async () => {
    await cli(['exp@example.test'], new Date('2026-01-01T00:00:00Z'));
    const next = await cli(['exp@example.test'], new Date('2026-11-04T00:00:00Z'));
    expect(next.code).toBe(0);
    const open = await testDb.sql(`SELECT 1 FROM "Invite" WHERE "usedAt" IS NULL`);
    expect(open.rows).toHaveLength(1);
  });

  it('recusa e-mail invalido, e-mail com conta existente, validade fora do intervalo e opcao desconhecida', async () => {
    expect((await cli(['nao-e-email'])).code).toBe(1);
    expect((await cli(['x@example.test', '--expires-in-hours', '0'])).code).toBe(1);
    expect((await cli(['x@example.test', '--expires-in-hours', 'abc'])).code).toBe(1);
    expect((await cli(['x@example.test', '--bogus'])).code).toBe(2);
    expect((await cli([])).code).toBe(2);

    await testDb.db.global.user.create({ data: { email: 'existe@example.test' } });
    const exists = await cli(['existe@example.test']);
    expect(exists.code).toBe(1);
    expect(exists.err).toContain('conta');
  });
});
