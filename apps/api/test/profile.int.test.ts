import {
  listProfileRevisionsResponseSchema,
  profileBaseResponseSchema,
  profileRevisionResponseSchema,
  saveProfileBaseResponseSchema,
} from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_CV,
  BASE_PROFILE,
  TEST_POLICY_VERSION,
  buildTestApp,
  createTestAccount,
  createTwoAccounts,
  type TestAccount,
} from './helpers';

let testDb: TestDb;
let built: ReturnType<typeof buildTestApp>;
let a: TestAccount;
let b: TestAccount;

beforeAll(async () => {
  testDb = await createTestDb();
  built = buildTestApp(testDb.db);
  ({ a, b } = await createTwoAccounts({ app: built.app, config: built.config, db: testDb.db }));
}, 90_000);
afterAll(async () => {
  await testDb.drop();
});

const save = (cvMarkdown: string, profileMarkdown: string, client = a.client) =>
  client.put('/api/profile', { cvMarkdown, profileMarkdown });

describe('professional base', () => {
  it('starts empty, saves, and saving the same text is a no-op', async () => {
    expect(
      profileBaseResponseSchema.parse((await a.client.get('/api/profile')).body).base,
    ).toBeNull();
    const first = saveProfileBaseResponseSchema.parse((await save(BASE_CV, BASE_PROFILE)).body);
    expect(first.changed).toBe(true);
    expect(first.base.cvMarkdown).toBe(BASE_CV);
    const same = saveProfileBaseResponseSchema.parse((await save(BASE_CV, BASE_PROFILE)).body);
    expect(same.changed).toBe(false);
    expect(same.base.revisionId).toBe(first.base.revisionId);
    // Line endings do not make a new revision.
    const crlf = saveProfileBaseResponseSchema.parse(
      (await save(BASE_CV.replaceAll('\n', '\r\n'), BASE_PROFILE)).body,
    );
    expect(crlf.changed).toBe(false);
  });

  it('a change creates an immutable revision; old revisions can be read and restored', async () => {
    const changed = saveProfileBaseResponseSchema.parse(
      (await save(`${BASE_CV}\n- Novo item.\n`, BASE_PROFILE)).body,
    );
    expect(changed.changed).toBe(true);
    const list = listProfileRevisionsResponseSchema.parse(
      (await a.client.get('/api/profile/revisions')).body,
    );
    expect(list.revisions.length).toBeGreaterThanOrEqual(2);
    const oldest = list.revisions.at(-1)!;
    const detail = profileRevisionResponseSchema.parse(
      (await a.client.get(`/api/profile/revisions/${oldest.id}`)).body,
    );
    expect(detail.revision.cvMarkdown).toBe(BASE_CV);
    const restored = saveProfileBaseResponseSchema.parse(
      (await a.client.post(`/api/profile/revisions/${oldest.id}/restore`, {})).body,
    );
    expect(restored.base.cvMarkdown).toBe(BASE_CV);
    await expect(
      testDb.sql(`UPDATE "ProfileBaseRevision" SET "cvMarkdown" = 'x' WHERE id = $1`, [oldest.id]),
    ).rejects.toThrow(/ProfileBaseRevision_immutable/);
  });

  it('accepts a large base (own body limit) and rejects one over the contract limit', async () => {
    const big = `${BASE_CV}\n${'- Linha de experiência com acentuação e detalhes.\n'.repeat(700)}`;
    expect(big.length).toBeLessThan(40_000);
    expect((await save(big, BASE_PROFILE)).status).toBe(200);
    const tooBig = await save('x'.repeat(40_001), BASE_PROFILE);
    expect(tooBig.status).toBe(400);
    await save(BASE_CV, BASE_PROFILE);
  });

  it('another account sees only its own base and gets 404 for foreign revisions', async () => {
    expect(
      profileBaseResponseSchema.parse((await b.client.get('/api/profile')).body).base,
    ).toBeNull();
    const list = listProfileRevisionsResponseSchema.parse(
      (await a.client.get('/api/profile/revisions')).body,
    );
    const id = list.revisions[0]!.id;
    expect((await b.client.get(`/api/profile/revisions/${id}`)).status).toBe(404);
    expect((await b.client.post(`/api/profile/revisions/${id}/restore`, {})).status).toBe(404);
  });

  it('withdrawn profile consent blocks every route', async () => {
    const solo = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'sem-consentimento-base@example.test' },
    );
    await testDb.db.forOwner(solo.ownerId).consentRecord.create({
      data: {
        ownerId: solo.ownerId,
        purpose: 'profile_processing',
        granted: false,
        policyVersion: TEST_POLICY_VERSION,
        recordedAt: new Date(Date.now() + 60_000),
      },
    });
    expect((await solo.client.get('/api/profile')).status).toBe(403);
    expect((await save(BASE_CV, BASE_PROFILE, solo.client)).status).toBe(403);
  });

  it('audit events carry ids and sizes, never the text', async () => {
    const rows = await testDb.sql<{ metadata: unknown }>(
      `SELECT metadata FROM "AuditEvent" WHERE action LIKE 'profile.%'`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Ana Teste|Triagem|ninja/);
  });
});
