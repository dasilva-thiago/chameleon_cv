import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInvite } from '../src/auth/invites';
import { buildTestApp, TestClient } from './helpers';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.drop();
});

// Canarios unicos: nenhum pode aparecer em NENHUMA linha de log (ADR-0014, ADR-0008 item 5c).
const CANARY = {
  password: 'CANARY-PW-7c1e9f3a-senha-secreta',
  newPassword: 'CANARY-PW2-b5d2e8c4-outra-senha',
  email: 'canary.pessoa.7c1e9f3a@example.test',
  unknownEmail: 'canary.inexistente.4d6b2a91@example.test',
  displayName: 'CANARY-NOME-e03b77d2',
  query: 'CANARY-QUERY-91af03bc',
  jsonBody: 'CANARY-JSON-5e5a7d10',
  header: 'CANARY-HEADER-2c9ad4e6',
};

describe('logs nao contem segredos nem dados pessoais (canarios)', () => {
  it('fluxo completo: convite, aceite, login, falhas, JSON invalido, 401, 403, 404, logout', async () => {
    const { app, config, logs } = buildTestApp(testDb.db);
    const client = new TestClient(app, config);

    const { token: inviteToken } = await createInvite(testDb.db, { email: CANARY.email });
    await client.post('/api/auth/invites/preview', { token: inviteToken });
    const accepted = await client.post('/api/auth/invites/accept', {
      token: inviteToken,
      password: CANARY.password,
      displayName: CANARY.displayName,
      consents: [{ purpose: 'profile_processing', granted: true, policyVersion: 'v1' }],
    });
    expect(accepted.status).toBe(201);
    const sessionToken = client.sessionToken ?? '';
    const csrfToken = client.csrfToken ?? '';

    await client.post('/api/auth/logout');
    await client.post('/api/auth/login', { email: CANARY.email, password: CANARY.newPassword });
    await client.post('/api/auth/login', {
      email: CANARY.unknownEmail,
      password: CANARY.newPassword,
    });
    await client.post('/api/auth/login', { email: CANARY.email, password: CANARY.password });
    await client.postRaw(
      '/api/auth/login',
      `{"email":"${CANARY.email}","password":"${CANARY.jsonBody}",`,
    );
    await client.post(
      '/api/auth/login',
      { email: CANARY.email, password: CANARY.password },
      {
        csrf: null,
      },
    );
    await client.get(`/api/inexistente?email=${CANARY.email}&token=${CANARY.query}`);
    await client.get('/api/auth/me', { headers: { 'X-Custom': CANARY.header } });
    await client.post('/api/auth/invites/preview', {
      token: 'D'.repeat(43),
      extra: CANARY.jsonBody,
    });
    await client.post('/api/auth/logout-all');

    const output = logs.text();
    expect(output.length).toBeGreaterThan(0);
    // Varre todos os canarios, os tokens reais (sessao, CSRF, convite) e padroes de e-mail.
    for (const secret of [
      ...Object.values(CANARY),
      sessionToken,
      csrfToken,
      inviteToken,
      client.sessionToken ?? 'x-nao-definido',
    ]) {
      expect(output, `vazou: ${secret}`).not.toContain(secret);
    }
    expect(output).not.toMatch(/[A-Za-z0-9._+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    expect(output).not.toMatch(/argon2id/);
    expect(output).not.toMatch(/set-cookie|authorization|x-csrf-token/i);

    // Cada linha e JSON valido, com id de correlacao nas linhas de acesso.
    const access = logs.lines().filter((line) => line.msg === 'request completed');
    expect(access.length).toBeGreaterThan(5);
    for (const line of access) {
      expect(line.reqId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
      expect(Object.keys(line.req as object).sort()).toEqual(['method', 'path']);
      expect(String((line.req as { path: string }).path)).not.toContain('?');
    }
  });

  it('login falho registra evento sem identificar a conta', async () => {
    const { app, config, logs } = buildTestApp(testDb.db);
    await new TestClient(app, config).post('/api/auth/login', {
      email: CANARY.unknownEmail,
      password: CANARY.password,
    });
    const failed = logs.lines().find((l) => l.event === 'auth.login.failed');
    expect(failed).toBeDefined();
    expect(JSON.stringify(failed)).not.toContain('canary');
  });
});
