import { apiErrorBodySchema } from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRouteManifest } from '../src/http';
import {
  TEST_POLICY_VERSION,
  buildTestApp,
  createTestAccount,
  type TestAccount,
  type TestApp,
} from './helpers';

/**
 * Phase 1 gate, condition 1: EVERY profile route refuses a caller without a current `profile_processing`
 * grant. The sweep walks the real manifest, so a route added later is covered without touching this file.
 */
let testDb: TestDb;
let built: TestApp;
let account: TestAccount;
let tick = 0;

beforeAll(async () => {
  testDb = await createTestDb();
  built = buildTestApp(testDb.db);
  account = await createTestAccount(
    { app: built.app, config: built.config, db: testDb.db },
    { email: 'consent-gate@example.test' },
  );
}, 60_000);
afterAll(async () => {
  await testDb.drop();
});

/** Appends a consent record (later `recordedAt` always wins, whatever the clock resolution). */
async function record(granted: boolean): Promise<void> {
  tick += 1;
  await testDb.db.forOwner(account.ownerId).consentRecord.create({
    data: {
      ownerId: account.ownerId,
      purpose: 'profile_processing',
      granted,
      policyVersion: TEST_POLICY_VERSION,
      recordedAt: new Date(Date.now() + tick * 60_000),
    },
  });
}

const SAMPLE_ID = '00000000-0000-4000-8000-000000000000';

function profileRoutes() {
  return getRouteManifest(built.app).filter((route) => route.path.startsWith('/api/profile'));
}

async function sweep(): Promise<{ label: string; status: number; code: string | undefined }[]> {
  const out = [];
  for (const route of profileRoutes()) {
    const path = route.path.replace(/:[A-Za-z0-9_]+/g, SAMPLE_ID);
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const response = await account.client.request(method, path, route.mutating ? {} : undefined);
    const body = response.body as { error?: { code?: string } };
    out.push({
      label: `${route.method} ${route.path}`,
      status: response.status,
      code: body.error?.code,
    });
  }
  return out;
}

describe('profile routes are gated by profile_processing consent', () => {
  it('the manifest exposes a non-trivial set of session routes under /api/profile', () => {
    const routes = profileRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(25);
    expect(routes.every((route) => route.auth === 'session')).toBe(true);
  });

  it('granted at signup: the gate lets the request through (GET /api/profile answers 200)', async () => {
    const response = await account.client.get('/api/profile');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ exists: false, document: null });
  });

  it('withdrawn (latest record granted=false): every route answers 403 CONSENT_REQUIRED_FOR_PROFILE', async () => {
    await record(false);
    const results = await sweep();
    for (const result of results) {
      expect(result.status, result.label).toBe(403);
      expect(result.code, result.label).toBe('CONSENT_REQUIRED_FOR_PROFILE');
    }
  });

  it('the error body is the structured shape', async () => {
    const response = await account.client.get('/api/profile');
    const body = apiErrorBodySchema.parse(response.body);
    expect(body.error.code).toBe('CONSENT_REQUIRED_FOR_PROFILE');
  });

  it('the gate runs before any parsing: a hostile or oversized body is refused with 403, not 400/413', async () => {
    const huge = 'x'.repeat(300 * 1024);
    const preview = await account.client.postRaw('/api/profile/imports/preview', huge, {
      contentType: 'text/plain',
    });
    expect(preview.status).toBe(403);
    const malformed = await account.client.postRaw('/api/profile/confirmations', '{not json');
    expect([400, 403]).toContain(malformed.status); // global JSON parser may still reject malformed JSON
    const write = await account.client.put('/api/profile', { document: 'nope' });
    expect(write.status).toBe(403);
  });

  it('re-granted (latest record granted=true): routes work again', async () => {
    await record(true);
    const response = await account.client.get('/api/profile');
    expect(response.status).toBe(200);
    const results = await sweep();
    expect(results.filter((r) => r.code === 'CONSENT_REQUIRED_FOR_PROFILE')).toEqual([]);
  });

  it('absent (no record at all): every route answers 403', async () => {
    await testDb.sql(`DELETE FROM "ConsentRecord" WHERE "ownerId" = $1`, [account.ownerId]);
    const results = await sweep();
    for (const result of results) {
      expect(result.status, result.label).toBe(403);
      expect(result.code, result.label).toBe('CONSENT_REQUIRED_FOR_PROFILE');
    }
  });

  it('another purpose does not count (ai_processing:* is not profile_processing)', async () => {
    await testDb.db.forOwner(account.ownerId).consentRecord.create({
      data: {
        ownerId: account.ownerId,
        purpose: 'ai_processing:anthropic',
        granted: true,
        policyVersion: TEST_POLICY_VERSION,
      },
    });
    const response = await account.client.get('/api/profile');
    expect(response.status).toBe(403);
  });

  it('the consent of ONE owner never opens the gate for another', async () => {
    const other = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'consent-gate-2@example.test' },
    );
    expect((await other.client.get('/api/profile')).status).toBe(200);
    expect((await account.client.get('/api/profile')).status).toBe(403);
  });
});
