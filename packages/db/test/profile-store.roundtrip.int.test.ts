import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createProfileStore, type ProfileStore } from '../src/profile-store';
import { createTestDb, type TestDb } from '../src/testing';
import { expectedAfterStore, fixtureDocument, V2_FIXTURE_IDS } from './support/profile-docs';
import { testSnapshot } from './support/snapshot';

let testDb: TestDb;
let store: ProfileStore;

beforeAll(async () => {
  testDb = await createTestDb();
  store = createProfileStore(testDb.db, { snapshot: testSnapshot });
});
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll();
});

const makeUser = async (email: string) =>
  testDb.db.global.user.create({ data: { email, displayName: 'Teste' } });

describe('ProfileStore: round-trip documento -> banco -> documento (todas as fixtures v2)', () => {
  it('ha fixtures v2 para exercitar', () => {
    expect(V2_FIXTURE_IDS.length).toBeGreaterThanOrEqual(12);
  });

  for (const id of V2_FIXTURE_IDS) {
    it(`${id}: o documento lido e IGUAL ao canonico`, async () => {
      const user = await makeUser(`${id}@example.test`);
      const document = fixtureDocument(id);
      const saved = await store.saveProfileDocument(user.id, document);
      expect(saved.profileCreated).toBe(true);
      expect(saved.summary.totals.unchanged).toBe(0);

      const loaded = await store.loadProfileDocument(user.id);
      expect(loaded?.profileId).toBe(saved.profileId);
      expect(loaded?.document).toEqual(expectedAfterStore(document));
    });
  }
});
