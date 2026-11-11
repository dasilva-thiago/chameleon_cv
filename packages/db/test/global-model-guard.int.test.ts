import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OwnerScopeViolationError } from '../src/errors';
import { createTestDb, type TestDb } from '../src/testing';

/**
 * Regression tests for the S1.5a findings (F2/F13) against a real database. Several cases are the
 * review probes turned into tests: `_count` leaks, deep include chains, nested writes through
 * `Invite.usedBy`, and raw SQL on the scoped client.
 */
let testDb: TestDb;
let a: { id: string };
let b: { id: string };
let inviteB: { id: string; tokenHash: string };

const FAKE_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const hash = (c: string): string => c.repeat(64);
const A = () => testDb.db.forOwner(a.id);
const GLOBAL = () => testDb.db.global;

async function addSession(ownerId: string, tokenHash: string): Promise<void> {
  await testDb.db.forOwner(ownerId).session.create({
    data: {
      ownerId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 7_200_000),
    },
  });
}

const displayNameOf = async (id: string) =>
  (await GLOBAL().user.findUnique({ where: { id } }))?.displayName;

beforeAll(async () => {
  testDb = await createTestDb();
  a = await GLOBAL().user.create({ data: { email: 'a@example.test', displayName: 'A' } });
  b = await GLOBAL().user.create({ data: { email: 'b@example.test', displayName: 'B' } });
  await addSession(a.id, hash('a'));
  await addSession(b.id, hash('b'));
  await addSession(b.id, hash('c'));
  inviteB = await GLOBAL().invite.create({
    data: {
      email: 'b@example.test',
      tokenHash: hash('e'),
      expiresAt: new Date(Date.now() + 3_600_000),
      usedAt: new Date(),
      usedByUserId: b.id,
    },
  });
});

afterAll(async () => testDb.drop());

describe('F2(a): _count cannot leak counts of private rows', () => {
  const attempts: [string, () => Promise<unknown>][] = [
    ['global include _count: true', () => GLOBAL().user.findMany({ include: { _count: true } })],
    [
      'global select _count',
      () =>
        GLOBAL().user.findMany({ select: { email: true, _count: { select: { sessions: true } } } }),
    ],
    [
      'forOwner(A).user select _count',
      () => A().user.findMany({ select: { email: true, _count: true } }),
    ],
    ['forOwner(A).user include _count', () => A().user.findMany({ include: { _count: true } })],
    [
      '_count through the invite -> user chain',
      () => GLOBAL().invite.findMany({ include: { usedBy: { include: { _count: true } } } }),
    ],
    [
      'global findUnique include _count',
      () => GLOBAL().user.findUnique({ where: { id: b.id }, include: { _count: true } }),
    ],
  ];

  it.each(attempts)('%s is rejected', async (_name, run) => {
    await expect(run()).rejects.toThrow(OwnerScopeViolationError);
  });

  it('the scalar _count of aggregate/groupBy keeps working', async () => {
    const agg = await GLOBAL().user.aggregate({ _count: { _all: true } });
    expect(agg._count._all).toBe(2);
    const groups = await GLOBAL().user.groupBy({ by: ['status'], _count: { _all: true } });
    expect(groups).toEqual([{ status: 'active', _count: { _all: 2 } }]);
  });
});

describe('F2(b): deep relation chains fail closed', () => {
  /** invite -> usedBy -> (invitesUsed -> usedBy)* -> sessions, `pairs` repetitions. */
  const chain = (pairs: number) => {
    let userInc: Record<string, unknown> = {
      sessions: { select: { tokenHash: true, ownerId: true } },
    };
    for (let i = 0; i < pairs; i++) {
      userInc = { invitesUsed: { include: { usedBy: { include: userInc } } } };
    }
    return { usedBy: { include: userInc } };
  };

  it.each([1, 3, 5, 9, 20])('a %i-pair chain ending in sessions is rejected', async (pairs) => {
    const tokenOfB = hash('b');
    const run = () => GLOBAL().invite.findMany({ include: chain(pairs) });
    await expect(run()).rejects.toThrow(OwnerScopeViolationError);
    // The same chain through the scoped client's global model.
    await expect(A().invite.findMany({ include: chain(pairs) })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    // Nothing of B's session leaked in the error either.
    await run().catch((error: Error) => expect(error.message).not.toContain(tokenOfB));
  });

  it('a chain deeper than the walk limit throws instead of being treated as safe', async () => {
    let args: Record<string, unknown> = { email: true };
    for (let i = 0; i < 60; i++) args = { NOT: args };
    await expect(GLOBAL().user.findMany({ where: args })).rejects.toThrow(/nested deeper/);
    await expect(A().user.findMany({ where: args })).rejects.toThrow(OwnerScopeViolationError);
  });

  it('relation filters in where/orderBy at any depth are rejected', async () => {
    await expect(
      GLOBAL().invite.findMany({
        where: { AND: [{ OR: [{ usedBy: { is: { sessions: { some: {} } } } }] }] },
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(
      GLOBAL().user.findMany({ orderBy: { sessions: { _count: 'desc' } } }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(
      GLOBAL().user.findMany({ select: { invitesUsed: { select: { usedBy: true } } } }),
    ).rejects.toThrow(OwnerScopeViolationError);
  });

  it('cyclic global-to-global traversal is forbidden even without private relations', async () => {
    await expect(GLOBAL().invite.findMany({ include: { usedBy: true } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    await expect(GLOBAL().user.findMany({ include: { invitesUsed: true } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
  });
});

describe('F2(c): global models are scoped inside forOwner', () => {
  it('the probe repro (invite.update -> usedBy.update) cannot change another user', async () => {
    const attempt = A().invite.update({
      where: { id: inviteB.id },
      data: { usedBy: { update: { displayName: 'changed-by-A' } } },
    });
    await expect(attempt).rejects.toThrow(OwnerScopeViolationError);
    expect(await displayNameOf(b.id)).toBe('B');
  });

  it('deep nested writes into private models via Invite are rejected at every depth', async () => {
    const build = (hops: number) => {
      let userData: Record<string, unknown> = {
        credentials: { create: { kind: 'password', passwordHash: FAKE_HASH } },
      };
      for (let i = 0; i < hops; i++) {
        userData = {
          invitesUsed: {
            update: { where: { id: inviteB.id }, data: { usedBy: { update: userData } } },
          },
        };
      }
      return { usedBy: { update: userData } };
    };
    for (const hops of [0, 2, 3, 4, 10]) {
      await expect(
        A().invite.update({ where: { id: inviteB.id }, data: build(hops) }),
      ).rejects.toThrow(OwnerScopeViolationError);
      await expect(
        GLOBAL().invite.update({ where: { id: inviteB.id }, data: build(hops) }),
      ).rejects.toThrow(OwnerScopeViolationError);
    }
    expect(await testDb.db.forOwner(b.id).credential.count()).toBe(0);
  });

  it('forOwner(A).user only sees and changes A', async () => {
    expect((await A().user.findMany({ select: { email: true } })).map((u) => u.email)).toEqual([
      'a@example.test',
    ]);
    expect(await A().user.count()).toBe(1);
    expect(
      await A()
        .user.findUnique({ where: { id: b.id } })
        .catch((e: unknown) => e),
    ).toBeInstanceOf(OwnerScopeViolationError);
    expect(await A().user.findUnique({ where: { email: 'b@example.test' } })).toBeNull();

    const changed = await A().user.updateMany({ data: { displayName: 'A2' } });
    expect(changed.count).toBe(1);
    expect(await displayNameOf(a.id)).toBe('A2');
    expect(await displayNameOf(b.id)).toBe('B');

    await expect(
      A().user.update({ where: { id: b.id }, data: { displayName: 'x' } }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(
      A().user.update({ where: { email: 'b@example.test' }, data: { displayName: 'x' } }),
    ).rejects.toThrow(/Record to update not found|not found/i);
    expect(await displayNameOf(b.id)).toBe('B');
    await A().user.update({ where: { id: a.id }, data: { displayName: 'A' } });
  });

  it('forOwner(A).user.deleteMany never touches B', async () => {
    const c = await GLOBAL().user.create({ data: { email: `c-${randomUUID()}@example.test` } });
    const deleted = await testDb.db.forOwner(c.id).user.deleteMany();
    expect(deleted.count).toBe(1);
    expect(await GLOBAL().user.count()).toBe(2);
  });

  it('forOwner cannot create or re-key a user other than its owner', async () => {
    await expect(
      A().user.create({ data: { id: b.id, email: 'dup@example.test' } }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(A().user.update({ where: { id: a.id }, data: { id: b.id } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    await expect(
      A().user.update({
        where: { id: a.id },
        data: { credentials: { create: { kind: 'password', passwordHash: FAKE_HASH } } },
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
  });

  it('forOwner only accepts the invite acceptance writes', async () => {
    await expect(A().invite.findMany()).rejects.toThrow(/Use db\.global\.invite/);
    await expect(A().invite.findUnique({ where: { id: inviteB.id } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    await expect(A().invite.delete({ where: { id: inviteB.id } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    await expect(
      A().invite.update({
        where: { id: inviteB.id },
        data: { usedByUserId: a.id, email: 'x@example.test' },
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(
      A().invite.update({ where: { id: inviteB.id }, data: { usedByUserId: b.id } }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(A().invite.updateMany({ data: { usedAt: new Date() } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
  });

  it('the signup flow used by apps/api still works through forOwner(newOwnerId)', async () => {
    const newOwner = randomUUID();
    const tokenHash = hash('f');
    const now = new Date();
    await GLOBAL().invite.create({
      data: { email: 'new@example.test', tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const user = await testDb.db.forOwner(newOwner).$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      expect(claimed.count).toBe(1);
      const created = await tx.user.create({
        data: { id: newOwner, email: 'new@example.test', displayName: 'New' },
      });
      await tx.invite.update({ where: { tokenHash }, data: { usedByUserId: newOwner } });
      await tx.credential.create({
        data: { ownerId: newOwner, kind: 'password', passwordHash: FAKE_HASH },
      });
      return created;
    });
    expect(user.id).toBe(newOwner);
    const invite = await GLOBAL().invite.findUnique({ where: { tokenHash } });
    expect(invite?.usedByUserId).toBe(newOwner);
    expect(await testDb.db.forOwner(newOwner).credential.count()).toBe(1);
  });

  it('db.global keeps serving the auth lookups (by email, by tokenHash, updateMany)', async () => {
    expect((await GLOBAL().user.findUnique({ where: { email: 'a@example.test' } }))?.id).toBe(a.id);
    expect((await GLOBAL().invite.findUnique({ where: { tokenHash: hash('e') } }))?.id).toBe(
      inviteB.id,
    );
    expect(
      (
        await GLOBAL().invite.updateMany({
          where: { email: 'nobody@example.test', usedAt: null },
          data: { usedAt: new Date() },
        })
      ).count,
    ).toBe(0);
  });
});

describe('F2: nested writes through db.global cannot reach private models', () => {
  it.each([
    [
      'credentials create',
      { credentials: { create: { kind: 'password', passwordHash: FAKE_HASH } } },
    ],
    ['sessions deleteMany', { sessions: { deleteMany: {} } }],
    ['auditEvents set', { auditEvents: { set: [] } }],
    ['profileBases connect', { profileBases: { connect: { id: randomUUID() } } }],
  ])('user.update with %s is rejected and changes nothing', async (_name, data) => {
    await expect(
      GLOBAL().user.update({ where: { id: b.id }, data: data as never }),
    ).rejects.toThrow(OwnerScopeViolationError);
    expect(await testDb.db.forOwner(b.id).session.count()).toBe(2);
    expect(await testDb.db.forOwner(b.id).credential.count()).toBe(0);
  });

  it('user.create with a nested private create is rejected', async () => {
    await expect(
      GLOBAL().user.create({
        data: {
          email: 'nested@example.test',
          sessions: {
            create: {
              tokenHash: hash('9'),
              expiresAt: new Date(),
              absoluteExpiresAt: new Date(),
            },
          },
        },
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
    expect(await GLOBAL().user.findUnique({ where: { email: 'nested@example.test' } })).toBeNull();
  });
});

describe('raw operations are blocked at the client level', () => {
  type Raw = Record<string, (...args: unknown[]) => Promise<unknown>>;
  const clients: [string, () => Raw][] = [
    ['global', () => GLOBAL() as unknown as Raw],
    ['forOwner', () => A() as unknown as Raw],
  ];

  describe.each(clients)('%s client', (_label, client) => {
    it.each([
      ['$queryRawUnsafe', ['SELECT "ownerId" FROM "Session"']],
      ['$executeRawUnsafe', ['DELETE FROM "Session"']],
    ])('%s throws OwnerScopeViolationError and runs nothing', async (op, args) => {
      await expect(client()[op]!(...args)).rejects.toThrow(OwnerScopeViolationError);
      expect(await testDb.db.forOwner(b.id).session.count()).toBe(2);
    });

    // Prisma itself throws (synchronously) before any extension runs: the provider is PostgreSQL and
    // the `typedSql` preview feature is off. The assertion pins that neither can ever execute.
    it('$runCommandRaw (MongoDB only) is inert on this provider', async () => {
      await expect(
        Promise.resolve().then(() => client().$runCommandRaw!({ ping: 1 })),
      ).rejects.toThrow(/does not support \$runCommandRaw/);
    });

    it('tagged $queryRaw / $executeRaw throw too', async () => {
      const c = client() as unknown as {
        $queryRaw: (s: TemplateStringsArray) => Promise<unknown>;
        $executeRaw: (s: TemplateStringsArray) => Promise<unknown>;
      };
      await expect(c.$queryRaw`SELECT 1`).rejects.toThrow(OwnerScopeViolationError);
      await expect(c.$executeRaw`DELETE FROM "Session"`).rejects.toThrow(OwnerScopeViolationError);
    });

    it('$queryRawTyped is inert without the typedSql preview feature', async () => {
      const c = client() as unknown as Record<string, (sql: unknown) => Promise<unknown>>;
      await expect(
        Promise.resolve().then(() => c.$queryRawTyped!({ name: 'x', sql: 'SELECT 1' })),
      ).rejects.toThrow(/typedSql/);
    });
  });

  it('raw SQL is also blocked inside interactive transactions', async () => {
    await expect(
      A().$transaction(async (tx) => (tx as unknown as Raw).$queryRawUnsafe!('SELECT 1')),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(
      GLOBAL().$transaction(async (tx) => (tx as unknown as Raw).$executeRawUnsafe!('SELECT 1')),
    ).rejects.toThrow(OwnerScopeViolationError);
  });

  it('unsafeRaw stays the only escape hatch', async () => {
    const rows = await testDb.db.unsafeRaw.$queryRawUnsafe<{ n: bigint }[]>(
      'SELECT count(*)::bigint AS n FROM "Session"',
    );
    expect(Number(rows[0]!.n)).toBe(3);
  });
});
