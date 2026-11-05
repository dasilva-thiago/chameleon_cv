import { apiErrorBodySchema } from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInvite } from '../src/auth/invites';
import { hasGrantedConsent } from '../src/consent';
import {
  buildTestApp,
  createTestAccount,
  TEST_PASSWORD,
  TEST_POLICY_VERSION,
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

const errorOf = (response: TestResponse) => apiErrorBodySchema.parse(response.body).error;
const entry = (overrides: Record<string, unknown> = {}) => ({
  purpose: 'profile_processing',
  granted: true,
  policyVersion: TEST_POLICY_VERSION,
  ...overrides,
});

let inviteSeq = 0;

async function accept(
  consents: unknown,
  options: { config?: ReturnType<typeof testConfig> } = {},
): Promise<{ response: TestResponse; token: string; client: TestClient }> {
  const built = buildTestApp(testDb.db, options.config ? { config: options.config } : {});
  const client = new TestClient(built.app, built.config);
  const { token } = await createInvite(testDb.db, {
    email: `consent-${(inviteSeq += 1)}@example.test`,
  });
  const response = await client.post('/api/auth/invites/accept', {
    token,
    password: TEST_PASSWORD,
    ...(consents === undefined ? {} : { consents }),
  });
  return { response, token, client };
}

const userCount = async (): Promise<number> =>
  (await testDb.sql(`SELECT id FROM "User"`)).rows.length;

describe('consent at invite acceptance (F5, LGPD)', () => {
  it('missing or empty consents -> 400 VALIDATION_ERROR and no account', async () => {
    for (const consents of [undefined, []]) {
      const { response } = await accept(consents);
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(errorOf(response).details)).toContain('consents');
    }
    expect(await userCount()).toBe(0);
  });

  it('profile_processing not granted -> 400 CONSENT_REQUIRED and the invite stays usable', async () => {
    const { response, token, client } = await accept([entry({ granted: false })]);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('CONSENT_REQUIRED');
    expect(await userCount()).toBe(0);
    const retry = await client.post('/api/auth/invites/accept', {
      token,
      password: TEST_PASSWORD,
      consents: [entry()],
    });
    expect(retry.status).toBe(201);
  });

  it('unknown policy version (any client string) -> 400 CONSENT_INVALID', async () => {
    for (const policyVersion of ['v1', '9999', 'policy-2026-11', '2026-11.2']) {
      const { response } = await accept([entry({ policyVersion })]);
      expect(response.status, policyVersion).toBe(400);
      expect(errorOf(response).code, policyVersion).toBe('CONSENT_INVALID');
    }
    expect(await userCount()).toBe(0);
  });

  it('ai_processing:* at signup is rejected (the international-transfer notice was not shown)', async () => {
    for (const consents of [
      [entry({ purpose: 'ai_processing:anthropic' })],
      [entry(), entry({ purpose: 'ai_processing:anthropic' })],
      [entry({ purpose: 'ai_processing:openai', granted: false })],
    ]) {
      const { response } = await accept(consents);
      expect(response.status).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    }
    expect(await userCount()).toBe(0);
    expect((await testDb.sql(`SELECT id FROM "ConsentRecord"`)).rows).toHaveLength(0);
  });

  it('stored record: purpose and grant are fixed by the server, only the version comes from the client', async () => {
    const { response } = await accept([entry()]);
    expect(response.status).toBe(201);
    const rows = await testDb.sql(`SELECT purpose, granted, "policyVersion" FROM "ConsentRecord"`);
    expect(rows.rows).toEqual([
      { purpose: 'profile_processing', granted: true, policyVersion: TEST_POLICY_VERSION },
    ]);
  });

  it('PROFILE_POLICY_VERSIONS configures the accepted versions (the whole list counts)', async () => {
    const config = testConfig({ PROFILE_POLICY_VERSIONS: '2027-01.0,2026-11.1' });
    const next = await accept([entry({ policyVersion: '2027-01.0' })], { config });
    expect(next.response.status).toBe(201);
    await testDb.truncateAll();
    expect((await accept([entry()], { config })).response.status).toBe(201);
    await testDb.truncateAll();
    const only = testConfig({ PROFILE_POLICY_VERSIONS: '2027-01.0' });
    const stale = await accept([entry()], { config: only });
    expect(errorOf(stale.response).code).toBe('CONSENT_INVALID');
  });
});

describe('hasGrantedConsent (gate for Phase 2 routes)', () => {
  it('a fresh account has profile_processing granted and no other purpose', async () => {
    const built = buildTestApp(testDb.db);
    const a = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const scoped = testDb.db.forOwner(a.ownerId);
    expect(await hasGrantedConsent(scoped, a.ownerId, 'profile_processing')).toBe(true);
    expect(await hasGrantedConsent(scoped, a.ownerId, 'ai_processing:anthropic')).toBe(false);
  });

  it('the latest record wins (a later withdrawal beats a grant, a new grant beats a withdrawal)', async () => {
    const built = buildTestApp(testDb.db);
    const a = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'a@example.test' },
    );
    const scoped = testDb.db.forOwner(a.ownerId);
    const record = (granted: boolean, recordedAt: Date) =>
      scoped.consentRecord.create({
        data: {
          ownerId: a.ownerId,
          purpose: 'profile_processing',
          granted,
          policyVersion: TEST_POLICY_VERSION,
          recordedAt,
        },
      });
    await record(false, new Date(Date.now() + 60_000));
    expect(await hasGrantedConsent(scoped, a.ownerId, 'profile_processing')).toBe(false);
    await record(true, new Date(Date.now() + 120_000));
    expect(await hasGrantedConsent(scoped, a.ownerId, 'profile_processing')).toBe(true);
  });

  it("cannot read another owner's consent: a mismatched ownerId fails closed", async () => {
    const built = buildTestApp(testDb.db);
    const ctx = { app: built.app, config: built.config, db: testDb.db };
    const a = await createTestAccount(ctx, { email: 'a@example.test' });
    const b = await createTestAccount(ctx, { email: 'b@example.test' });
    await testDb.sql(`DELETE FROM "ConsentRecord" WHERE "ownerId" = $1`, [b.ownerId]);
    const scopedB = testDb.db.forOwner(b.ownerId);
    expect(await hasGrantedConsent(scopedB, b.ownerId, 'profile_processing')).toBe(false);
    // A's grant is unreachable through B's scoped client: the scope fails closed.
    await expect(hasGrantedConsent(scopedB, a.ownerId, 'profile_processing')).rejects.toThrow(
      /ownerId/,
    );
  });
});
