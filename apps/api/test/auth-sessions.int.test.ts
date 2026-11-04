import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestAccount, TestClient } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

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

/**
 * Le a sessao pelo Prisma (mesmo espaco de tempo da aplicacao). Nao compare timestamps lidos por
 * SQL cru com o relogio da app: o cluster local usa TimeZone=America/Sao_Paulo e o adapter-pg
 * grava datas sem fuso (ver relatorio da S1.2, risco R-tz).
 */
async function sessionRow() {
  return testDb.db.unsafeRaw.session.findFirstOrThrow();
}

/** App com relogio controlado: `clock.at` avanca sem esperar. */
function setupWithClock() {
  const clock = { at: new Date() };
  const built = buildTestApp(testDb.db, { now: () => clock.at });
  return { ...built, clock, ctx: { app: built.app, config: built.config, db: testDb.db } };
}

describe('expiracao de sessao (ADR-0009)', () => {
  it('ociosa: 7 dias sem uso -> 401', async () => {
    const { clock, ctx } = setupWithClock();
    const account = await createTestAccount(ctx, { email: 'a@example.test' });
    const start = clock.at.getTime();

    clock.at = new Date(start + 6 * DAY);
    expect((await account.client.get('/api/auth/me')).status).toBe(200);

    // A leitura acima renovou a janela (visto no dia 6); 8 dias depois, sem uso, expira.
    clock.at = new Date(start + 14 * DAY + 1000);
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
  });

  it('ociosa: a linha com expiresAt no passado nao autentica', async () => {
    const { ctx } = setupWithClock();
    const account = await createTestAccount(ctx, { email: 'a@example.test' });
    await testDb.db.unsafeRaw.session.updateMany({
      where: { ownerId: account.ownerId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
  });

  it('absoluta: 30 dias de uso continuo ainda expiram; a renovacao nunca passa do limite absoluto', async () => {
    const { clock, ctx } = setupWithClock();
    const account = await createTestAccount(ctx, { email: 'a@example.test' });
    const start = clock.at.getTime();

    for (const day of [5, 10, 15, 20, 25, 29]) {
      clock.at = new Date(start + day * DAY);
      expect((await account.client.get('/api/auth/me')).status, `dia ${day}`).toBe(200);
    }
    const row = await sessionRow();
    // No dia 29 a janela deslizante (36) e cortada no limite absoluto (30).
    expect(row.expiresAt.getTime()).toBe(row.absoluteExpiresAt.getTime());
    expect(row.absoluteExpiresAt.getTime()).toBe(start + 30 * DAY);

    clock.at = new Date(start + 30 * DAY + 1000);
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
  });

  it('expiracao deslizante: o uso renova ate 7 dias a frente (com intervalo minimo entre gravacoes)', async () => {
    const { clock, ctx } = setupWithClock();
    const account = await createTestAccount(ctx, { email: 'a@example.test' });
    const start = clock.at.getTime();

    clock.at = new Date(start + 2 * DAY);
    await account.client.get('/api/auth/me');
    expect((await sessionRow()).expiresAt.getTime()).toBe(start + 9 * DAY);

    // Dentro do intervalo minimo (1 min) nao ha nova gravacao.
    clock.at = new Date(start + 2 * DAY + 10_000);
    await account.client.get('/api/auth/me');
    expect((await sessionRow()).expiresAt.getTime()).toBe(start + 9 * DAY);
  });

  it('sessao expirada limpa o cookie na resposta 401', async () => {
    const { ctx } = setupWithClock();
    const account = await createTestAccount(ctx, { email: 'a@example.test' });
    await testDb.sql(`UPDATE "Session" SET "revokedAt" = now()`);
    const response = await account.client.get('/api/auth/me');
    expect(response.status).toBe(401);
    expect(String(response.headers['set-cookie'])).toMatch(/__Host-cc_session=;/);
  });

  it('usuario desativado perde acesso imediatamente, mesmo com sessao valida', async () => {
    const { ctx } = setupWithClock();
    const account = await createTestAccount(ctx, { email: 'a@example.test' });
    await testDb.sql(`UPDATE "User" SET status = 'disabled' WHERE id = $1`, [account.ownerId]);
    expect((await account.client.get('/api/auth/me')).status).toBe(401);
  });

  it('cookie de outra sessao/usuario nao concede acesso (token aleatorio -> 401)', async () => {
    const { app, config } = setupWithClock();
    const client = new TestClient(app, config);
    client.setCookie(client.sessionCookieName, 'Z'.repeat(43));
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });
});
