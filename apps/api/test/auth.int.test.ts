import { createHash } from 'node:crypto';
import {
  acceptInviteResponseSchema,
  apiErrorBodySchema,
  loginResponseSchema,
  logoutResponseSchema,
  invitePreviewResponseSchema,
} from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { parseSetCookie } from 'cookie';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInvite, revokeOpenInvites } from '../src/auth/invites';
import {
  buildTestApp,
  createTestAccount,
  DEV_ORIGIN,
  TEST_PASSWORD,
  TEST_SIGNUP_CONSENTS,
  TestClient,
  testConfig,
  type TestResponse,
} from './helpers';

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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const errorOf = (response: TestResponse) => apiErrorBodySchema.parse(response.body).error;
const setCookies = (response: TestResponse): string[] =>
  (response.headers['set-cookie'] as string[] | undefined) ?? [];

function setup(options: Parameters<typeof buildTestApp>[1] = {}) {
  const built = buildTestApp(testDb.db, options);
  const client = new TestClient(built.app, built.config);
  return { ...built, client };
}

describe('aceite de convite', () => {
  it('cria User + Credential argon2id, registra consentimento, inicia a sessao e consome o convite', async () => {
    const { client } = setup();
    const { token, invite } = await createInvite(testDb.db, { email: 'Pessoa@Example.test' });

    const preview = await client.post('/api/auth/invites/preview', { token });
    expect(preview.status).toBe(200);
    expect(invitePreviewResponseSchema.parse(preview.body).email).toBe('pessoa@example.test');

    const response = await client.post('/api/auth/invites/accept', {
      token,
      password: TEST_PASSWORD,
      displayName: 'Pessoa Teste',
      consents: [{ purpose: 'profile_processing', granted: true, policyVersion: '2026-11.1' }],
    });
    expect(response.status).toBe(201);
    const body = acceptInviteResponseSchema.parse(response.body);
    expect(body.user).toMatchObject({ email: 'pessoa@example.test', displayName: 'Pessoa Teste' });
    // Resposta minima: nada de hash, tokens ou ids de sessao.
    expect(Object.keys(body).sort()).toEqual(['session', 'user']);
    expect(JSON.stringify(response.body)).not.toMatch(/argon2|passwordHash|tokenHash/i);

    const credential = await testDb.sql<{ passwordHash: string }>(
      `SELECT "passwordHash" FROM "Credential" WHERE "ownerId" = $1`,
      [body.user.id],
    );
    expect(credential.rows[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(credential.rows[0]?.passwordHash).not.toContain(TEST_PASSWORD);

    const consents = await testDb.sql(
      `SELECT purpose, granted, "policyVersion" FROM "ConsentRecord" WHERE "ownerId" = $1`,
      [body.user.id],
    );
    expect(consents.rows).toEqual([
      { purpose: 'profile_processing', granted: true, policyVersion: '2026-11.1' },
    ]);

    const used = await testDb.sql<{ usedAt: Date | null; usedByUserId: string | null }>(
      `SELECT "usedAt", "usedByUserId" FROM "Invite" WHERE id = $1`,
      [invite.id],
    );
    expect(used.rows[0]?.usedAt).not.toBeNull();
    expect(used.rows[0]?.usedByUserId).toBe(body.user.id);

    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
  });

  it('convite desconhecido, expirado, usado e revogado respondem igual (INVITE_INVALID)', async () => {
    const { client } = setup();
    const unknown = 'A'.repeat(43);
    const expired = await createInvite(testDb.db, { email: 'expirado@example.test' });
    await testDb.db.global.invite.update({
      where: { id: expired.invite.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const used = await createInvite(testDb.db, { email: 'usado@example.test' });
    expect(
      (
        await client.post('/api/auth/invites/accept', {
          token: used.token,
          password: TEST_PASSWORD,
          consents: TEST_SIGNUP_CONSENTS,
        })
      ).status,
    ).toBe(201);
    const revoked = await createInvite(testDb.db, { email: 'revogado@example.test' });
    expect(await revokeOpenInvites(testDb.db, 'revogado@example.test', new Date())).toBe(1);

    const results: unknown[] = [];
    for (const token of [unknown, expired.token, used.token, revoked.token]) {
      const other = new TestClient(setup().app, testConfig());
      const preview = await other.post('/api/auth/invites/preview', { token });
      const accept = await other.post('/api/auth/invites/accept', {
        token,
        password: TEST_PASSWORD,
        consents: TEST_SIGNUP_CONSENTS,
      });
      for (const response of [preview, accept]) {
        expect(response.status).toBe(400);
        const error = errorOf(response);
        results.push({ code: error.code, message: error.message });
      }
    }
    expect(results.every((r) => JSON.stringify(r) === JSON.stringify(results[0]))).toBe(true);
    expect(results[0]).toMatchObject({ code: 'INVITE_INVALID' });

    // Nenhum usuario alem do que aceitou o convite valido foi criado.
    const users = await testDb.sql(`SELECT email FROM "User"`);
    expect(users.rows).toEqual([{ email: 'usado@example.test' }]);
  });

  it('aceites concorrentes do mesmo convite: exatamente um vence', async () => {
    const { token } = await createInvite(testDb.db, { email: 'corrida@example.test' });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => {
        const client = new TestClient(setup().app, testConfig());
        return client.post('/api/auth/invites/accept', {
          token,
          password: TEST_PASSWORD,
          consents: TEST_SIGNUP_CONSENTS,
        });
      }),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(3);
    const users = await testDb.sql(`SELECT id FROM "User"`);
    expect(users.rows).toHaveLength(1);
  });

  it('senha fraca -> 400 sem consumir o convite; senha curta -> VALIDATION_ERROR', async () => {
    const { client } = setup();
    const { token } = await createInvite(testDb.db, { email: 'fraca@example.test' });
    const weak = await client.post('/api/auth/invites/accept', {
      token,
      password: 'password1234',
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(weak.status).toBe(400);
    expect(errorOf(weak).code).toBe('WEAK_PASSWORD');
    const short = await client.post('/api/auth/invites/accept', {
      token,
      password: 'curta',
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(short.status).toBe(400);
    expect(errorOf(short).code).toBe('VALIDATION_ERROR');
    const ok = await client.post('/api/auth/invites/accept', {
      token,
      password: TEST_PASSWORD,
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(ok.status).toBe(201);
  });

  it('convite emitido para um e-mail que ja tem conta e rejeitado como invalido', async () => {
    const { app, config, client } = setup();
    await createTestAccount({ app, config, db: testDb.db }, { email: 'dupla@example.test' });
    // A CLI recusaria; aqui forca-se a linha para provar a defesa no aceite.
    await testDb.sql(
      `INSERT INTO "Invite" (id, email, "tokenHash", "expiresAt")
       VALUES (gen_random_uuid(), 'dupla@example.test', $1, now() + interval '1 day')`,
      [sha256('B'.repeat(43))],
    );
    const response = await client.post('/api/auth/invites/accept', {
      token: 'B'.repeat(43),
      password: TEST_PASSWORD,
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('INVITE_INVALID');
  });

  it('SIGNUP_MODE=closed bloqueia preview e aceite', async () => {
    const { client } = setup({ config: testConfig({ SIGNUP_MODE: 'closed' }) });
    const { token } = await createInvite(testDb.db, { email: 'fechado@example.test' });
    expect((await client.post('/api/auth/invites/preview', { token })).status).toBe(403);
    const accept = await client.post('/api/auth/invites/accept', {
      token,
      password: TEST_PASSWORD,
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(accept.status).toBe(403);
    expect(errorOf(accept).code).toBe('SIGNUP_CLOSED');
  });
});

describe('cookies e armazenamento de segredos', () => {
  it('producao (https): __Host-cc_session HttpOnly Secure SameSite=Lax Path=/ sem Domain', async () => {
    const { app, config } = setup();
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const login = await new TestClient(app, config).post('/api/auth/login', {
      email: account.email,
      password: account.password,
    });
    expect(login.status).toBe(200);
    const cookies = setCookies(login).map((line) => ({ line, cookie: parseSetCookie(line) }));
    const session = cookies.find((c) => c.cookie.name === '__Host-cc_session');
    expect(session).toBeDefined();
    expect(session?.cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(session?.cookie.domain).toBeUndefined();
    expect(session?.line).not.toMatch(/domain=/i);
    expect(session?.cookie.maxAge).toBe(30 * 24 * 60 * 60);

    // Cookie CSRF: legivel por JS (sem HttpOnly), mas Secure + __Host-.
    const csrf = cookies.find((c) => c.cookie.name === '__Host-cc_csrf');
    expect(csrf?.cookie).toMatchObject({ secure: true, sameSite: 'lax', path: '/' });
    expect(csrf?.cookie.httpOnly).toBeFalsy();
  });

  it('dev (http://localhost): cc_session sem Secure e sem prefixo, ainda HttpOnly + Lax', async () => {
    const config = testConfig({ APP_ORIGIN: DEV_ORIGIN });
    const { app } = buildTestApp(testDb.db, { config });
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const login = await new TestClient(app, config).post('/api/auth/login', {
      email: account.email,
      password: account.password,
    });
    const names = setCookies(login).map((l) => parseSetCookie(l).name);
    expect(names).toContain('cc_session');
    expect(names).not.toContain('__Host-cc_session');
    const session = parseSetCookie(
      setCookies(login).find((l) => l.startsWith('cc_session=')) ?? '',
    );
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(session.secure).toBeFalsy();
  });

  it('o token de sessao so existe como SHA-256 no banco; o de convite tambem', async () => {
    const { client } = setup();
    const { token: inviteToken } = await createInvite(testDb.db, { email: 'hash@example.test' });
    const accept = await client.post('/api/auth/invites/accept', {
      token: inviteToken,
      password: TEST_PASSWORD,
      consents: TEST_SIGNUP_CONSENTS,
    });
    expect(accept.status).toBe(201);
    const sessionToken = client.sessionToken;
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const sessions = await testDb.sql<{ tokenHash: string }>(`SELECT * FROM "Session"`);
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.tokenHash).toBe(sha256(sessionToken ?? ''));

    // Varredura de todas as tabelas de identidade: nenhum token, senha ou e-mail de sessao em claro.
    for (const table of ['Session', 'Invite', 'Credential', 'AuditEvent', 'ConsentRecord']) {
      const dump = JSON.stringify((await testDb.sql(`SELECT * FROM "${table}"`)).rows);
      expect(dump, table).not.toContain(sessionToken);
      expect(dump, table).not.toContain(inviteToken);
      expect(dump, table).not.toContain(TEST_PASSWORD);
    }
    const invites = await testDb.sql<{ tokenHash: string }>(`SELECT "tokenHash" FROM "Invite"`);
    expect(invites.rows[0]?.tokenHash).toBe(sha256(inviteToken));
  });
});

describe('login', () => {
  it('sucesso: resposta minima conforme o DTO e auditoria sem PII', async () => {
    const { app, config } = setup();
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const client = new TestClient(app, config);
    const response = await client.post('/api/auth/login', {
      email: '  A@Example.TEST ',
      password: account.password,
    });
    expect(response.status).toBe(200);
    const body = loginResponseSchema.parse(response.body);
    expect(body.user.id).toBe(account.ownerId);
    const audit = await testDb.sql<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM "AuditEvent" WHERE "ownerId" = $1 ORDER BY at`,
      [account.ownerId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['auth.signup', 'auth.login']);
    expect(JSON.stringify(audit.rows)).not.toContain('example.test');
  });

  it('e-mail inexistente, senha errada e conta desativada: resposta identica', async () => {
    const { app, config } = setup();
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const disabled = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'd@example.test' },
    );
    await testDb.sql(`UPDATE "User" SET status = 'disabled' WHERE id = $1`, [disabled.ownerId]);

    const attempts = [
      { email: 'ninguem@example.test', password: 'qualquer senha longa' },
      { email: account.email, password: 'senha errada mas longa' },
      { email: disabled.email, password: disabled.password },
    ];
    const outcomes = [];
    for (const attempt of attempts) {
      const response = await new TestClient(app, config).post('/api/auth/login', attempt);
      expect(response.status).toBe(401);
      expect(setCookies(response).some((l) => l.includes('cc_session='))).toBe(false);
      const error = errorOf(response);
      outcomes.push({ status: response.status, code: error.code, message: error.message });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[0]?.code).toBe('INVALID_CREDENTIALS');
  });

  it('e-mail inexistente tambem executa a verificacao argon2 (tempo equalizado)', async () => {
    const { app, config } = setup();
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const time = async (email: string): Promise<number> => {
      const started = performance.now();
      await new TestClient(app, config).post('/api/auth/login', {
        email,
        password: 'senha errada mas longa',
      });
      return performance.now() - started;
    };
    await time('aquecimento@example.test');
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 4; i++) {
      unknown.push(await time(`ninguem${i}@example.test`));
      wrong.push(await time(account.email));
    }
    // Sem o hash ficticio, o caminho "inexistente" seria uma ordem de grandeza mais rapido.
    expect(Math.min(...unknown)).toBeGreaterThan(Math.min(...wrong) * 0.5);
  });

  it('rotacao: login com cookie anterior revoga a sessao antiga e emite token novo', async () => {
    const { app, config } = setup();
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const client = account.client;
    const oldToken = client.sessionToken;
    expect(oldToken).toBeDefined();

    const login = await client.post('/api/auth/login', {
      email: account.email,
      password: account.password,
    });
    expect(login.status).toBe(200);
    expect(client.sessionToken).toBeDefined();
    expect(client.sessionToken).not.toBe(oldToken);

    const stale = new TestClient(app, config);
    stale.setCookie(stale.sessionCookieName, oldToken ?? '');
    expect((await stale.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    const rows = await testDb.sql<{ revokedAt: Date | null }>(
      `SELECT "revokedAt" FROM "Session" ORDER BY "createdAt"`,
    );
    expect(rows.rows.map((r) => r.revokedAt !== null)).toEqual([true, false]);
  });

  it('limita sessoes ativas por usuario (as mais antigas sao revogadas)', async () => {
    const { app, config } = setup({ sessionPolicy: { maxActive: 2 } });
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const clients = [account.client];
    for (let i = 0; i < 3; i++) {
      const client = new TestClient(app, config);
      await client.post('/api/auth/login', { email: account.email, password: account.password });
      clients.push(client);
    }
    const statuses = await Promise.all(
      clients.map(async (c) => (await c.get('/api/auth/me')).status),
    );
    expect(statuses).toEqual([401, 401, 200, 200]);
  });
});

describe('logout e revogacao', () => {
  it('logout invalida a sessao (cookie antigo -> 401) e limpa o cookie', async () => {
    const { app, config } = setup();
    const account = await createTestAccount(
      { app, config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const client = account.client;
    const token = client.sessionToken ?? '';
    const response = await client.post('/api/auth/logout');
    expect(response.status).toBe(200);
    expect(logoutResponseSchema.parse(response.body)).toEqual({ revokedSessions: 1 });
    const cleared = setCookies(response)
      .map((l) => parseSetCookie(l))
      .find((c) => c.name === '__Host-cc_session');
    expect(cleared?.maxAge).toBe(0);
    expect(client.sessionToken).toBeUndefined();

    const replay = new TestClient(app, config);
    replay.setCookie(replay.sessionCookieName, token);
    expect((await replay.get('/api/auth/me')).status).toBe(401);
  });

  it('logout-all revoga todas as sessoes do usuario, e so as dele', async () => {
    const { app, config } = setup();
    const a = await createTestAccount({ app, config, db: testDb.db }, { email: 'a@example.test' });
    const b = await createTestAccount({ app, config, db: testDb.db }, { email: 'b@example.test' });
    const second = new TestClient(app, config);
    await second.post('/api/auth/login', { email: a.email, password: a.password });

    const response = await a.client.post('/api/auth/logout-all');
    expect(response.status).toBe(200);
    expect(logoutResponseSchema.parse(response.body).revokedSessions).toBe(2);
    expect((await second.get('/api/auth/me')).status).toBe(401);
    expect((await b.client.get('/api/auth/me')).status).toBe(200);
  });

  it('CSRF vale tambem para logout autenticado', async () => {
    const { app, config } = setup();
    const a = await createTestAccount({ app, config, db: testDb.db }, { email: 'a@example.test' });
    const response = await a.client.post('/api/auth/logout', undefined, { csrf: null });
    expect(response.status).toBe(403);
    expect((await a.client.get('/api/auth/me')).status).toBe(200);
  });
});

describe('cabecalhos e erros em fluxos reais', () => {
  it('respostas autenticadas nao sao cacheaveis', async () => {
    const { app, config } = setup();
    const a = await createTestAccount({ app, config, db: testDb.db }, { email: 'a@example.test' });
    const me = await a.client.get('/api/auth/me');
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['content-type']).toMatch(/application\/json/);
  });
});
