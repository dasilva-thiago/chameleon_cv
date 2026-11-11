import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, OwnerScopeViolationError, PurgeIncompleteError } from '../src';
import { createTestDb, type TestDb } from '../src/testing';
import { ownerDump, ownerRowCounts, seedOwner, type SeededOwner } from './support/account-seed';

/**
 * Account deletion (S2.3a, ADR-0014): `db.purgeAccount(ownerId)` deletes everything of one owner in one
 * transaction with a transaction-local `chameleon.allow_purge`, verifies the result from the catalog and
 * touches nobody else. Revisions are immutable for every other path.
 */
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
}, 120_000);
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll(); // each test seeds its own owners; no leftovers from earlier tests
});

const total = (counts: Record<string, number>): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);
const IMMUTABLE = 'ProfileBaseRevision_immutable';

async function twoOwners(): Promise<{ a: SeededOwner; b: SeededOwner }> {
  const a = await seedOwner(testDb, 'purge-a');
  const b = await seedOwner(testDb, 'purge-b');
  return { a, b };
}

const accountDeletionRows = async () =>
  (
    await testDb.sql<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(d) AS row FROM "AccountDeletion" d`,
    )
  ).rows;

describe('purgeAccount: removes everything of one owner and nothing of the others', () => {
  it('deletes every owner-scoped table row (incl. immutable revisions), the user and its invitations', async () => {
    const { a, b } = await twoOwners();
    const beforeA = await ownerRowCounts(testDb, a.ownerId);
    const beforeB = await ownerRowCounts(testDb, b.ownerId);
    const dumpB = await ownerDump(testDb, b.ownerId);
    expect(beforeA.ProfileBaseRevision).toBe(2);
    expect(beforeA.ProfileBase).toBe(1);
    expect(beforeA.Credential).toBe(1);
    expect(beforeA.Session).toBe(1);
    expect(beforeA.ConsentRecord).toBe(1);
    expect(beforeA.AuditEvent).toBe(1);
    expect(Object.values(beforeA).filter((n) => n > 0).length).toBeGreaterThan(8);

    const result = await testDb.db.purgeAccount(a.ownerId);

    expect(result.purged).toBe(true);
    expect(result.tables).toEqual(beforeA);
    // owner rows + 2 invitations (used by the user, open for the same e-mail) + the user itself
    expect(result.rowsDeleted).toBe(total(beforeA) + 2 + 1);

    const afterA = await ownerRowCounts(testDb, a.ownerId);
    expect(Object.keys(afterA).sort()).toEqual(Object.keys(beforeA).sort());
    expect(
      Object.values(afterA).every((n) => n === 0),
      JSON.stringify(afterA),
    ).toBe(true);
    const users = await testDb.sql(`SELECT 1 FROM "User" WHERE id = $1`, [a.ownerId]);
    expect(users.rowCount).toBe(0);
    const invites = await testDb.sql(`SELECT 1 FROM "Invite" WHERE id = ANY($1::uuid[])`, [
      [a.inviteIds.used, a.inviteIds.open],
    ]);
    expect(invites.rowCount).toBe(0);

    // B: not one row changed (counts, full row content, user, invitations, document).
    expect(await ownerRowCounts(testDb, b.ownerId)).toEqual(beforeB);
    expect(await ownerDump(testDb, b.ownerId)).toBe(dumpB);
    const bUser = await testDb.sql(`SELECT 1 FROM "User" WHERE id = $1`, [b.ownerId]);
    expect(bUser.rowCount).toBe(1);
    const bInvites = await testDb.sql(`SELECT 1 FROM "Invite" WHERE id = ANY($1::uuid[])`, [
      [b.inviteIds.used, b.inviteIds.open],
    ]);
    expect(bInvites.rowCount).toBe(2);
    const loadedB = await testDb.db.forOwner(b.ownerId).profileBase.findFirst();
    for (const canary of b.canaries) expect(JSON.stringify(loadedB), canary).toContain(canary);
    expect(await testDb.db.forOwner(a.ownerId).profileBase.findFirst()).toBeNull();
  });

  it('A canaries are gone from every column of every table (full-database sweep)', async () => {
    const { a, b } = await twoOwners();
    await testDb.db.purgeAccount(a.ownerId);
    const needles = [a.ownerId, a.email, a.auditCanary, ...Object.values(a.secrets), ...a.canaries];
    const { rows: tables } = await testDb.sql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
    );
    for (const { table_name } of tables) {
      const { rows } = await testDb.sql<{ doc: string }>(
        `SELECT coalesce(string_agg(to_jsonb(t)::text, E'\\n'), '') AS doc FROM "${table_name}" t`,
      );
      const doc = rows[0]?.doc ?? '';
      for (const needle of needles) {
        expect(doc.includes(needle), `${table_name} still contains ${needle.slice(0, 24)}`).toBe(
          false,
        );
      }
    }
    // sanity of the sweep itself: B's data is still found
    const bDump = await ownerDump(testDb, b.ownerId);
    expect(bDump).toContain(b.auditCanary);
  });

  it('records one minimal deletion row that does not reference the owner', async () => {
    const { a } = await twoOwners();
    const before = (await accountDeletionRows()).length;
    const result = await testDb.db.purgeAccount(a.ownerId);
    const rows = await accountDeletionRows();
    expect(rows).toHaveLength(before + 1);
    const row = rows.map((r) => r.row).find((r) => r.id === result.deletionId);
    expect(row).toBeDefined();
    expect(Object.keys(row!).sort()).toEqual(['deletedAt', 'id', 'rowsDeleted']);
    expect(row!.rowsDeleted).toBe(result.rowsDeleted);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(a.ownerId);
    expect(text).not.toContain(a.email);
  });

  it('is idempotent: an unknown or already purged owner purges nothing and records nothing', async () => {
    const { a } = await twoOwners();
    await testDb.db.purgeAccount(a.ownerId);
    const recorded = (await accountDeletionRows()).length;
    const again = await testDb.db.purgeAccount(a.ownerId);
    expect(again).toEqual({ purged: false, deletionId: null, rowsDeleted: 0, tables: {} });
    const stranger = await testDb.db.purgeAccount(randomUUID());
    expect(stranger.purged).toBe(false);
    expect((await accountDeletionRows()).length).toBe(recorded);
  });

  it('rejects a non-UUID owner id before touching the database', async () => {
    for (const bad of ['', 'not-a-uuid', 'x\'; DROP TABLE "User"; --', undefined, null, 42]) {
      await expect(testDb.db.purgeAccount(bad as never)).rejects.toThrow(OwnerScopeViolationError);
    }
  });

  it('the AccountDeletion record is append-only', async () => {
    const { a } = await twoOwners();
    const result = await testDb.db.purgeAccount(a.ownerId);
    await expect(
      testDb.sql(`UPDATE "AccountDeletion" SET "rowsDeleted" = 0 WHERE id = $1`, [
        result.deletionId,
      ]),
    ).rejects.toThrow('AccountDeletion_append_only');
    await expect(
      testDb.sql(`DELETE FROM "AccountDeletion" WHERE id = $1`, [result.deletionId]),
    ).rejects.toThrow('AccountDeletion_append_only');
  });

  it('a forOwner client cannot read or write AccountDeletion (fail closed)', async () => {
    const { a } = await twoOwners();
    await expect(
      (
        testDb.db.forOwner(a.ownerId) as never as {
          accountDeletion: { findMany(): Promise<unknown> };
        }
      ).accountDeletion.findMany(),
    ).rejects.toThrow(OwnerScopeViolationError);
  });
});

describe('purge flag handling (chameleon.allow_purge)', () => {
  it('revisions are immutable on every other path, with or without the purge having run', async () => {
    const { a, b } = await twoOwners();
    const scoped = testDb.db.forOwner(a.ownerId);
    await expect(scoped.profileBaseRevision.deleteMany({})).rejects.toThrow(IMMUTABLE);
    await expect(
      testDb.db.unsafeRaw
        .$executeRaw`DELETE FROM "ProfileBaseRevision" WHERE "ownerId" = ${a.ownerId}::uuid`,
    ).rejects.toThrow(IMMUTABLE);
    await expect(
      testDb.db.unsafeRaw.$executeRaw`DELETE FROM "User" WHERE id = ${a.ownerId}::uuid`,
    ).rejects.toThrow(IMMUTABLE);
    await expect(testDb.db.global.user.delete({ where: { id: a.ownerId } })).rejects.toThrow(
      IMMUTABLE,
    );
    expect((await ownerRowCounts(testDb, a.ownerId)).ProfileBaseRevision).toBe(2);

    await testDb.db.purgeAccount(a.ownerId);

    // After a purge, B's revisions are still protected on the same client/pool.
    await expect(
      testDb.db.unsafeRaw
        .$executeRaw`DELETE FROM "ProfileBaseRevision" WHERE "ownerId" = ${b.ownerId}::uuid`,
    ).rejects.toThrow(IMMUTABLE);
    await expect(testDb.db.forOwner(b.ownerId).profileBaseRevision.deleteMany({})).rejects.toThrow(
      IMMUTABLE,
    );
    expect((await ownerRowCounts(testDb, b.ownerId)).ProfileBaseRevision).toBe(2);
  });

  it('the flag is transaction-local: not visible on the same pooled connection afterwards', async () => {
    // A single-connection pool guarantees that the next statement reuses the purge connection.
    const single = createDb({ connectionString: testDb.url, maxConnections: 1 });
    try {
      const { a, b } = await twoOwners();
      const read = async (): Promise<string | null> => {
        const rows = await single.unsafeRaw.$queryRaw<
          { flag: string | null }[]
        >`SELECT current_setting('chameleon.allow_purge', true) AS flag`;
        return rows[0]?.flag ?? null;
      };
      expect([null, '', 'off']).toContain(await read());

      const result = await single.purgeAccount(a.ownerId);
      expect(result.purged).toBe(true);

      expect([null, '', 'off']).toContain(await read());
      // Same connection: an immutable-revision delete of B must still fail.
      await expect(
        single.unsafeRaw
          .$executeRaw`DELETE FROM "ProfileBaseRevision" WHERE "ownerId" = ${b.ownerId}::uuid`,
      ).rejects.toThrow(IMMUTABLE);
      await expect(single.forOwner(b.ownerId).profileBaseRevision.deleteMany({})).rejects.toThrow(
        IMMUTABLE,
      );
      // ... and also after a purge that found nothing / failed validation.
      await single.purgeAccount(randomUUID());
      expect([null, '', 'off']).toContain(await read());
      await expect(single.purgeAccount('nope')).rejects.toThrow();
      expect([null, '', 'off']).toContain(await read());
    } finally {
      await single.$disconnect();
    }
  });
});

describe('purge verification is catalog-driven and atomic', () => {
  it('a table added later with an "ownerId" column is swept and counted without code changes', async () => {
    const { a } = await twoOwners();
    await testDb.sql(
      `CREATE TABLE "FutureThing" (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE)`,
    );
    try {
      await testDb.sql(`INSERT INTO "FutureThing" VALUES ($1, $2), ($3, $2)`, [
        randomUUID(),
        a.ownerId,
        randomUUID(),
      ]);
      const result = await testDb.db.purgeAccount(a.ownerId);
      expect(result.tables.FutureThing).toBe(2);
      const left = await testDb.sql(`SELECT 1 FROM "FutureThing" WHERE "ownerId" = $1`, [
        a.ownerId,
      ]);
      expect(left.rowCount).toBe(0);
    } finally {
      await testDb.sql(`DROP TABLE "FutureThing"`);
    }
  });

  it('if any row would remain (table without cascade to User) the whole purge rolls back', async () => {
    const { a } = await twoOwners();
    const recorded = (await accountDeletionRows()).length;
    await testDb.sql(`CREATE TABLE "StrayOwned" (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL)`);
    try {
      await testDb.sql(`INSERT INTO "StrayOwned" VALUES ($1, $2)`, [randomUUID(), a.ownerId]);
      const before = await ownerDump(testDb, a.ownerId);
      const failure = await testDb.db.purgeAccount(a.ownerId).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(PurgeIncompleteError);
      expect((failure as PurgeIncompleteError).remaining).toEqual({ StrayOwned: 1 });
      expect((failure as PurgeIncompleteError).message).not.toContain(a.email);

      // Atomic: nothing was deleted, nothing recorded, the flag did not stick.
      expect(await ownerDump(testDb, a.ownerId)).toBe(before);
      expect((await accountDeletionRows()).length).toBe(recorded);
      const user = await testDb.sql(`SELECT 1 FROM "User" WHERE id = $1`, [a.ownerId]);
      expect(user.rowCount).toBe(1);
      await expect(
        testDb.sql(`DELETE FROM "ProfileBaseRevision" WHERE "ownerId" = $1`, [a.ownerId]),
      ).rejects.toThrow(IMMUTABLE);

      // Once the stray row is gone the same purge succeeds.
      await testDb.sql(`DELETE FROM "StrayOwned" WHERE "ownerId" = $1`, [a.ownerId]);
      expect((await testDb.db.purgeAccount(a.ownerId)).purged).toBe(true);
    } finally {
      await testDb.sql(`DROP TABLE "StrayOwned"`);
    }
  });

  it('FK/trigger interplay: a revision referenced by the base and by a resume goes away with its owner', async () => {
    const { a } = await twoOwners();
    // Without the flag a revision can never be deleted (immutable), referenced or not.
    const alone = await testDb
      .sql(`DELETE FROM "ProfileBaseRevision" WHERE id = '${a.revisionIds[1]}'`)
      .then(
        () => null,
        (error: Error) => error,
      );
    expect(String(alone?.message)).toMatch(/ProfileBaseRevision_immutable/);
    // The purge removes the revisions together with the base and the resume versions that point to them.
    const result = await testDb.db.purgeAccount(a.ownerId);
    expect(result.tables.ProfileBaseRevision).toBe(2);
    expect(result.tables.ProfileBase).toBe(1);
    expect(result.tables.ResumeVersion).toBe(1);
  });
});
