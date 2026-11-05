import { describe, expect, it } from 'vitest';
import { OwnerScopeViolationError } from '../src/errors';
import {
  MAX_GLOBAL_ARGS_DEPTH,
  assertGlobalModelArgs,
  findForbiddenGlobalKey,
  forbiddenGlobalKeys,
  scopeGlobalModelArgs,
  type RelationFields,
} from '../src/for-owner';

/**
 * Pure tests for the global-model guard (S1.5a, findings F2/F13). The database-backed regression
 * tests (probe repros) are in `global-model-guard.int.test.ts`.
 */
const A = '0197a1a4-5fd2-737e-8c2c-471c8423221a';
const B = '0197a1a4-5fd2-7bbb-8c2c-471c8423221b';

const RELATIONS: RelationFields = new Map<string, ReadonlySet<string>>([
  [
    'User',
    new Set([
      'credentials',
      'sessions',
      'consentRecords',
      'auditEvents',
      'invitesUsed',
      'profiles',
    ]),
  ],
  ['Invite', new Set(['usedBy'])],
]);
const FORBIDDEN = forbiddenGlobalKeys(RELATIONS);

describe('forbiddenGlobalKeys', () => {
  it('contains every relation of every global model, global-to-global ones included', () => {
    for (const key of ['credentials', 'sessions', 'profiles', 'invitesUsed', 'usedBy']) {
      expect(FORBIDDEN.has(key), key).toBe(true);
    }
    expect(FORBIDDEN.has('email')).toBe(false);
  });

  it('keeps the hand-written private relation list even if the runtime model omits it', () => {
    const keys = forbiddenGlobalKeys(
      new Map<string, ReadonlySet<string>>([
        ['User', new Set()],
        ['Invite', new Set()],
      ]),
    );
    expect(keys.has('sessions')).toBe(true);
  });

  it('fails closed when a global model is missing from the data model', () => {
    expect(() => forbiddenGlobalKeys(new Map([['User', new Set<string>()]]))).toThrow(
      OwnerScopeViolationError,
    );
  });
});

describe('findForbiddenGlobalKey', () => {
  it.each([
    ['include', { include: { sessions: true } }, 'sessions'],
    ['select', { select: { consentRecords: true } }, 'consentRecords'],
    ['where', { where: { credentials: { some: {} } } }, 'credentials'],
    [
      'where in AND/OR/NOT',
      { where: { AND: [{ OR: [{ NOT: { auditEvents: { none: {} } } }] }] } },
      'auditEvents',
    ],
    ['orderBy relation count', { orderBy: { sessions: { _count: 'asc' } } }, 'sessions'],
    ['nested write', { data: { credentials: { create: {} } } }, 'credentials'],
    ['global-to-global', { include: { usedBy: true } }, 'usedBy'],
    ['_count: true in include', { include: { _count: true } }, '_count'],
    ['_count in select', { select: { email: true, _count: { select: { x: true } } } }, '_count'],
    ['_count deep inside include', { include: { a: { include: { _count: true } } } }, '_count'],
  ])('rejects %s', (_label, args, key) => {
    expect(findForbiddenGlobalKey(args, FORBIDDEN)).toBe(key);
  });

  it('allows the scalar _count of aggregate/groupBy and plain filters', () => {
    expect(findForbiddenGlobalKey({ _count: { _all: true } }, FORBIDDEN)).toBeUndefined();
    expect(
      findForbiddenGlobalKey(
        { by: ['status'], _count: { _all: true }, having: { status: { _count: { gt: 0 } } } },
        FORBIDDEN,
      ),
    ).toBeUndefined();
    expect(
      findForbiddenGlobalKey(
        { where: { email: { equals: 'a@b.c' }, id: { in: [A, B] } } },
        FORBIDDEN,
      ),
    ).toBeUndefined();
  });

  it('finds a forbidden key far deeper than the former 16-level limit', () => {
    let args: unknown = { sessions: true };
    for (let i = 0; i < 12; i++) args = { include: { wrapper: args } }; // 24 levels deep
    expect(findForbiddenGlobalKey(args, FORBIDDEN)).toBe('sessions');
  });

  it('throws (fails closed) when the depth limit is exceeded', () => {
    let args: unknown = { email: true };
    for (let i = 0; i < MAX_GLOBAL_ARGS_DEPTH + 5; i++) args = { NOT: args };
    expect(() => findForbiddenGlobalKey(args, FORBIDDEN)).toThrow(OwnerScopeViolationError);
  });

  it('throws on a self-referencing argument object instead of looping', () => {
    const cyclic: Record<string, unknown> = { where: {} };
    (cyclic.where as Record<string, unknown>).AND = cyclic;
    expect(() => findForbiddenGlobalKey(cyclic, FORBIDDEN)).toThrow(OwnerScopeViolationError);
  });

  it('ignores primitives, Date and binary values', () => {
    expect(findForbiddenGlobalKey('sessions', FORBIDDEN)).toBeUndefined();
    expect(
      findForbiddenGlobalKey({ at: new Date(), raw: new Uint8Array(100_000) }, FORBIDDEN),
    ).toBeUndefined();
    expect(findForbiddenGlobalKey(undefined, FORBIDDEN)).toBeUndefined();
  });
});

describe('assertGlobalModelArgs', () => {
  it('throws OwnerScopeViolationError naming the relation', () => {
    expect(() =>
      assertGlobalModelArgs('User', 'findMany', { include: { sessions: true } }, FORBIDDEN),
    ).toThrow(/traverses the relation "sessions"/);
  });

  it('rejects unknown operations on global models', () => {
    for (const op of ['findRaw', 'aggregateRaw', '$queryRaw', 'whatever']) {
      expect(() => assertGlobalModelArgs('User', op, {}, FORBIDDEN)).toThrow(
        OwnerScopeViolationError,
      );
    }
  });

  it.each([
    'findMany',
    'findUnique',
    'count',
    'aggregate',
    'groupBy',
    'create',
    'upsert',
    'update',
  ])('accepts %s without relations', (op) => {
    expect(() =>
      assertGlobalModelArgs('User', op, { where: { email: 'x' } }, FORBIDDEN),
    ).not.toThrow();
  });
});

describe('scopeGlobalModelArgs: User inside forOwner', () => {
  it('injects id = ownerId into reads and filters', () => {
    expect(scopeGlobalModelArgs('User', 'findMany', {}, A)).toEqual({ where: { id: A } });
    expect(scopeGlobalModelArgs('User', 'findUnique', { where: { email: 'x' } }, A)).toEqual({
      where: { email: 'x', id: A },
    });
    expect(scopeGlobalModelArgs('User', 'count', undefined, A)).toEqual({ where: { id: A } });
  });

  it('rejects another id in unique and plain where, intersects composite filters', () => {
    expect(() => scopeGlobalModelArgs('User', 'findUnique', { where: { id: B } }, A)).toThrow(
      OwnerScopeViolationError,
    );
    expect(() => scopeGlobalModelArgs('User', 'findMany', { where: { id: B } }, A)).toThrow(
      OwnerScopeViolationError,
    );
    const composite = { where: { id: { in: [A, B] } } };
    expect(scopeGlobalModelArgs('User', 'findMany', composite, A)).toEqual({
      where: { AND: [composite.where, { id: A }] },
    });
  });

  it('scopes updates and deletes and refuses to change User.id', () => {
    expect(scopeGlobalModelArgs('User', 'updateMany', { data: { displayName: 'n' } }, A)).toEqual({
      where: { id: A },
      data: { displayName: 'n' },
    });
    expect(scopeGlobalModelArgs('User', 'deleteMany', {}, A)).toEqual({ where: { id: A } });
    expect(() =>
      scopeGlobalModelArgs('User', 'update', { where: { id: A }, data: { id: B } }, A),
    ).toThrow(OwnerScopeViolationError);
    expect(() =>
      scopeGlobalModelArgs(
        'User',
        'upsert',
        { where: { id: A }, create: {}, update: { id: B } },
        A,
      ),
    ).toThrow(OwnerScopeViolationError);
  });

  it('creates only the owner row', () => {
    expect(scopeGlobalModelArgs('User', 'create', { data: { email: 'x' } }, A)).toEqual({
      data: { email: 'x', id: A },
    });
    expect(scopeGlobalModelArgs('User', 'create', { data: { id: A, email: 'x' } }, A)).toEqual({
      data: { id: A, email: 'x' },
    });
    expect(() =>
      scopeGlobalModelArgs('User', 'create', { data: { id: B, email: 'x' } }, A),
    ).toThrow(OwnerScopeViolationError);
    expect(() =>
      scopeGlobalModelArgs(
        'User',
        'createMany',
        { data: [{ email: 'x' }, { id: B, email: 'y' }] },
        A,
      ),
    ).toThrow(OwnerScopeViolationError);
    expect(
      scopeGlobalModelArgs(
        'User',
        'upsert',
        { where: { id: A }, create: { email: 'x' }, update: {} },
        A,
      ),
    ).toMatchObject({ where: { id: A }, create: { email: 'x', id: A } });
  });

  it('rejects unknown operations', () => {
    expect(() => scopeGlobalModelArgs('User', 'findRaw', {}, A)).toThrow(OwnerScopeViolationError);
  });
});

describe('scopeGlobalModelArgs: Invite inside forOwner', () => {
  it('allows the acceptance flow (claim by tokenHash, then mark usedByUserId)', () => {
    const claim = {
      where: { tokenHash: 'h', usedAt: null },
      data: { usedAt: new Date(0) },
    };
    expect(scopeGlobalModelArgs('Invite', 'updateMany', claim, A)).toEqual(claim);
    expect(
      scopeGlobalModelArgs(
        'Invite',
        'update',
        { where: { tokenHash: 'h' }, data: { usedByUserId: A } },
        A,
      ),
    ).toEqual({ where: { tokenHash: 'h' }, data: { usedByUserId: A } });
    expect(
      scopeGlobalModelArgs(
        'Invite',
        'update',
        { where: { id: B }, data: { usedAt: new Date(0) } },
        A,
      ),
    ).toBeDefined();
  });

  it.each([
    'findMany',
    'findUnique',
    'findFirst',
    'count',
    'aggregate',
    'groupBy',
    'create',
    'createMany',
    'upsert',
    'delete',
    'deleteMany',
  ])('rejects %s (use db.global.invite)', (op) => {
    expect(() =>
      scopeGlobalModelArgs('Invite', op, { where: { tokenHash: 'h' }, data: {} }, A),
    ).toThrow(/Use db\.global\.invite/);
  });

  it('rejects usedByUserId of another owner, nested relation writes and other columns', () => {
    const base = { where: { tokenHash: 'h' } };
    expect(() =>
      scopeGlobalModelArgs('Invite', 'update', { ...base, data: { usedByUserId: B } }, A),
    ).toThrow(OwnerScopeViolationError);
    expect(() =>
      scopeGlobalModelArgs('Invite', 'update', { ...base, data: { usedByUserId: null } }, A),
    ).toThrow(OwnerScopeViolationError);
    expect(() =>
      scopeGlobalModelArgs(
        'Invite',
        'update',
        { ...base, data: { usedBy: { update: { displayName: 'x' } } } },
        A,
      ),
    ).toThrow(OwnerScopeViolationError);
    for (const column of ['email', 'tokenHash', 'expiresAt', 'createdAt', 'id']) {
      expect(() =>
        scopeGlobalModelArgs('Invite', 'update', { ...base, data: { [column]: 'x' } }, A),
      ).toThrow(OwnerScopeViolationError);
    }
  });

  it('requires the where to target one invite and data to be an object', () => {
    for (const where of [
      undefined,
      {},
      { usedAt: null },
      { email: 'x' },
      { tokenHash: { not: 'x' } },
    ]) {
      expect(() =>
        scopeGlobalModelArgs('Invite', 'updateMany', { where, data: { usedAt: new Date() } }, A),
      ).toThrow(OwnerScopeViolationError);
    }
    expect(() =>
      scopeGlobalModelArgs('Invite', 'update', { where: { tokenHash: 'h' } }, A),
    ).toThrow(OwnerScopeViolationError);
  });

  it('fails closed for a global model without a policy', () => {
    expect(() => scopeGlobalModelArgs('Mystery', 'findMany', {}, A)).toThrow(
      OwnerScopeViolationError,
    );
  });
});
