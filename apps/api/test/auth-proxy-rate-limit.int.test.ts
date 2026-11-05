import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountDelayFor, type AccountDelayRule } from '../src/auth/rate-limits';
import { buildTestApp, createTestAccount, TestClient, testConfig } from './helpers';

/**
 * F1: login rate limits and the proxy contract. A simulated proxy hop is an `X-Forwarded-For`
 * header sent to an app configured with TRUST_PROXY=1 (supertest connects from the loopback
 * address, which plays the role of the proxy).
 */
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

const WINDOW = 15 * 60_000;
const huge = { windowMs: WINDOW, max: 100_000 };
const WRONG = 'a wrong password, long enough';

const attempt = (client: TestClient, email: string, ip: string, password = WRONG) =>
  client.post('/api/auth/login', { email, password }, { headers: { 'X-Forwarded-For': ip } });

describe('per-IP limits behind a proxy hop (TRUST_PROXY=1)', () => {
  it('keys by the client address the proxy reports, so clients do not share a budget', async () => {
    const built = buildTestApp(testDb.db, {
      config: testConfig({ TRUST_PROXY: '1' }),
      rateLimits: { loginPerIpEmail: huge, loginPerIp: { windowMs: WINDOW, max: 3 } },
    });
    const client = new TestClient(built.app, built.config);
    const statuses = async (ip: string) => {
      const out: number[] = [];
      for (let i = 0; i < 4; i++)
        out.push((await attempt(client, `x${i}@example.test`, ip)).status);
      return out;
    };
    // The attacking client exhausts ITS budget (4th attempt -> 429)...
    expect(await statuses('203.0.113.7')).toEqual([401, 401, 401, 429]);
    // ...and a different client behind the same proxy is unaffected (no shared lockout).
    expect(await statuses('198.51.100.9')).toEqual([401, 401, 401, 429]);
    const victim = await attempt(client, 'victim@example.test', '192.0.2.44');
    expect(victim.status).toBe(401);
  });

  it('TRUST_PROXY=0 ignores X-Forwarded-For (a spoofed header cannot mint new budgets)', async () => {
    const built = buildTestApp(testDb.db, {
      config: testConfig({ TRUST_PROXY: '0' }),
      rateLimits: { loginPerIpEmail: huge, loginPerIp: { windowMs: WINDOW, max: 3 } },
    });
    const client = new TestClient(built.app, built.config);
    const out: number[] = [];
    for (let i = 0; i < 5; i++) {
      out.push((await attempt(client, `x${i}@example.test`, `203.0.113.${i + 1}`)).status);
    }
    expect(out).toEqual([401, 401, 401, 429, 429]);
  });
});

describe('per-account progressive delay (independent of IP)', () => {
  const rule = (sleeps: number[]): AccountDelayRule => ({
    windowMs: WINDOW,
    freeAttempts: 2,
    baseDelayMs: 10,
    maxDelayMs: 40,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });

  it('delay schedule: free attempts, doubling, hard ceiling, disabled at 0', () => {
    const r = rule([]);
    expect([1, 2, 3, 4, 5, 6, 50].map((n) => accountDelayFor(r, n))).toEqual([
      0, 0, 10, 20, 40, 40, 40,
    ]);
    expect(accountDelayFor({ ...r, maxDelayMs: 0 }, 99)).toBe(0);
  });

  it('with a forged X-Forwarded-For per attempt (per-IP limits bypassed) guessing one account is slowed but never blocked', async () => {
    const sleeps: number[] = [];
    // TRUST_PROXY=1 with no proxy overwriting the header: the client controls req.ip.
    const built = buildTestApp(testDb.db, {
      config: testConfig({ TRUST_PROXY: '1' }),
      rateLimits: { loginPerIpEmail: huge, loginPerIp: huge, loginAccountDelay: rule(sleeps) },
    });
    const ctx = { app: built.app, config: built.config, db: testDb.db };
    const victim = await createTestAccount(ctx, { email: 'victim@example.test' });
    const bystander = await createTestAccount(ctx, { email: 'bystander@example.test' });

    const client = new TestClient(built.app, built.config);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      statuses.push((await attempt(client, victim.email, `203.0.113.${i + 1}`)).status);
    }
    // Every attempt still gets a real answer (401), never a 429 lockout...
    expect(statuses).toEqual(Array<number>(8).fill(401));
    // ...but from the 3rd attempt on each one waits, up to the ceiling and no more.
    expect(sleeps).toEqual([10, 20, 40, 40, 40, 40]);

    // The victim's own correct login is slowed (<= ceiling) yet succeeds: no account lockout.
    sleeps.length = 0;
    const own = await attempt(
      new TestClient(built.app, built.config),
      victim.email,
      '192.0.2.1',
      victim.password,
    );
    expect(own.status).toBe(200);
    expect(sleeps).toEqual([40]);

    // Another account is untouched: no delay, correct login works.
    sleeps.length = 0;
    const other = await attempt(
      new TestClient(built.app, built.config),
      bystander.email,
      '192.0.2.2',
      bystander.password,
    );
    expect(other.status).toBe(200);
    expect(sleeps).toEqual([]);
  });

  it('the key is the normalized e-mail: case/whitespace variants share one counter', async () => {
    const sleeps: number[] = [];
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIpEmail: huge, loginPerIp: huge, loginAccountDelay: rule(sleeps) },
    });
    const client = new TestClient(built.app, built.config);
    for (const email of ['Alvo@Example.test', ' alvo@example.test ', 'ALVO@EXAMPLE.TEST']) {
      await attempt(client, email, '203.0.113.1');
    }
    expect(sleeps).toEqual([10]);
  });

  it('successful logins are refunded, so normal use never accumulates delay', async () => {
    const sleeps: number[] = [];
    const built = buildTestApp(testDb.db, {
      rateLimits: { loginPerIpEmail: huge, loginPerIp: huge, loginAccountDelay: rule(sleeps) },
    });
    const account = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'real@example.test' },
    );
    for (let i = 0; i < 6; i++) {
      const response = await attempt(
        new TestClient(built.app, built.config),
        account.email,
        '192.0.2.3',
        account.password,
      );
      expect(response.status).toBe(200);
    }
    expect(sleeps).toEqual([]);
  });
});
