import { apiErrorBodySchema } from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInvite } from '../src/auth/invites';
import {
  buildTestApp,
  createTestAccount,
  TEST_PASSWORD,
  TEST_SIGNUP_CONSENTS,
  TestClient,
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

const HOUR = 60 * 60_000;

describe('rate limit de login (ADR-0009: 5 por 15 min por IP+e-mail)', () => {
  it('a 6a tentativa falha -> 429 com Retry-After e corpo estruturado', async () => {
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIpEmail: { windowMs: 15 * 60_000, max: 5 } },
    });
    const client = new TestClient(built.app, built.config);
    const attempt = () =>
      client.post('/api/auth/login', {
        email: 'alvo@example.test',
        password: 'senha errada longa',
      });

    for (let i = 1; i <= 5; i++) {
      expect((await attempt()).status, `tentativa ${i}`).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(apiErrorBodySchema.parse(blocked.body).error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('a chave nao depende de o e-mail existir; outro e-mail do mesmo IP nao e afetado', async () => {
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIpEmail: { windowMs: 15 * 60_000, max: 5 } },
    });
    const real = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'real@example.test' },
    );
    const client = new TestClient(built.app, built.config);
    // Mesmo comportamento para e-mail existente (senha errada) e inexistente.
    const statuses = async (email: string) => {
      const out: number[] = [];
      for (let i = 0; i < 6; i++) {
        out.push(
          (await client.post('/api/auth/login', { email, password: 'senha errada longa' })).status,
        );
      }
      return out;
    };
    expect(await statuses('inexistente@example.test')).toEqual([401, 401, 401, 401, 401, 429]);
    expect(await statuses(real.email)).toEqual([401, 401, 401, 401, 401, 429]);
    // E-mail diferente continua liberado.
    const other = await client.post('/api/auth/login', {
      email: 'outro@example.test',
      password: 'senha errada longa',
    });
    expect(other.status).toBe(401);
  });

  it('o bloqueio vale tambem para a senha correta (nao ha bypass pelo acerto)', async () => {
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIpEmail: { windowMs: 15 * 60_000, max: 3 } },
    });
    const account = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'real@example.test' },
    );
    const client = new TestClient(built.app, built.config);
    for (let i = 0; i < 3; i++) {
      await client.post('/api/auth/login', {
        email: account.email,
        password: 'errada errada errada',
      });
    }
    const right = await client.post('/api/auth/login', {
      email: account.email,
      password: account.password,
    });
    expect(right.status).toBe(429);
  });

  it('logins bem-sucedidos nao consomem o limite', async () => {
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIpEmail: { windowMs: 15 * 60_000, max: 2 } },
    });
    const account = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'real@example.test' },
    );
    for (let i = 0; i < 6; i++) {
      const client = new TestClient(built.app, built.config);
      const response = await client.post('/api/auth/login', {
        email: account.email,
        password: account.password,
      });
      expect(response.status, `login ${i}`).toBe(200);
    }
  });

  it('teto por IP somando e-mails diferentes (pulverizacao de senhas)', async () => {
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIp: { windowMs: 15 * 60_000, max: 4 } },
    });
    const client = new TestClient(built.app, built.config);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await client.post('/api/auth/login', {
            email: `alvo${i}@example.test`,
            password: 'senha errada longa',
          })
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 429, 429]);
  });
});

describe('rate limit de convite (ADR-0009: 10 por hora por IP; aqui 3)', () => {
  it('preview e aceite compartilham o limite por IP -> 429', async () => {
    const built = buildTestApp(testDb.db, {
      rateLimits: { invitePerIp: { windowMs: HOUR, max: 3 } },
    });
    const client = new TestClient(built.app, built.config);
    const { token } = await createInvite(testDb.db, { email: 'convite@example.test' });
    expect((await client.post('/api/auth/invites/preview', { token })).status).toBe(200);
    expect((await client.post('/api/auth/invites/preview', { token: 'C'.repeat(43) })).status).toBe(
      400,
    );
    expect(
      (
        await client.post('/api/auth/invites/accept', {
          token,
          password: TEST_PASSWORD,
          consents: TEST_SIGNUP_CONSENTS,
        })
      ).status,
    ).toBe(201);
    const blocked = await client.post('/api/auth/invites/preview', { token });
    expect(blocked.status).toBe(429);
    expect(apiErrorBodySchema.parse(blocked.body).error.code).toBe('RATE_LIMITED');
  });
});
