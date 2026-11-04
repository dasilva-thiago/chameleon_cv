import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OwnerScopeViolationError, PRIVATE_MODELS, UnscopedAccessError } from '../src';
import { createTestDb, type TestDb } from '../src/testing';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const inDays = (days: number): Date => new Date(Date.now() + days * 86_400_000);

let testDb: TestDb;
let a: { id: string };
let b: { id: string };
let sessionA: { id: string };
let sessionB: { id: string };

const sessionData = (ownerId: string, key: string) => ({
  ownerId,
  tokenHash: sha256(key),
  expiresAt: inDays(7),
  absoluteExpiresAt: inDays(30),
});

beforeAll(async () => {
  testDb = await createTestDb();
  const db = testDb.db;
  a = await db.global.user.create({ data: { email: 'a@example.test' } });
  b = await db.global.user.create({ data: { email: 'b@example.test' } });
  sessionA = await db.forOwner(a.id).session.create({ data: sessionData(a.id, 'a1') });
  await db.forOwner(a.id).session.create({ data: sessionData(a.id, 'a2') });
  sessionB = await db.forOwner(b.id).session.create({ data: sessionData(b.id, 'b1') });
  for (const owner of [a, b]) {
    await db.forOwner(owner.id).consentRecord.create({
      data: {
        ownerId: owner.id,
        purpose: 'profile_processing',
        granted: true,
        policyVersion: 'v1',
      },
    });
  }
});
afterAll(async () => {
  await testDb.drop();
});

const A = () => testDb.db.forOwner(a.id);
const B = () => testDb.db.forOwner(b.id);

describe('forOwner: leitura isolada entre dois donos', () => {
  it('findMany/count/aggregate/groupBy so enxergam as linhas do proprio dono', async () => {
    expect(await A().session.findMany()).toHaveLength(2);
    expect(await B().session.findMany()).toHaveLength(1);
    expect(await A().session.count()).toBe(2);
    expect((await A().session.aggregate({ _count: { _all: true } }))._count._all).toBe(2);
    const groups = await A().session.groupBy({ by: ['ownerId'], _count: { _all: true } });
    expect(groups).toEqual([{ ownerId: a.id, _count: { _all: 2 } }]);
    // filtro do chamador continua valendo junto com o escopo
    expect(await A().session.findMany({ where: { tokenHash: sha256('a1') } })).toHaveLength(1);
    expect(await A().session.findMany({ where: { tokenHash: sha256('b1') } })).toEqual([]);
  });

  it('findUnique/findFirst por id de outro dono nao encontram; OrThrow lanca', async () => {
    expect(await A().session.findUnique({ where: { id: sessionB.id } })).toBeNull();
    expect(await A().session.findFirst({ where: { id: sessionB.id } })).toBeNull();
    expect(await A().session.findUnique({ where: { tokenHash: sha256('b1') } })).toBeNull();
    await expect(A().session.findUniqueOrThrow({ where: { id: sessionB.id } })).rejects.toThrow();
    await expect(A().session.findFirstOrThrow({ where: { id: sessionB.id } })).rejects.toThrow();
    expect((await A().session.findUnique({ where: { id: sessionA.id } }))?.ownerId).toBe(a.id);
  });

  it('where com ownerId do outro dono (ou filtro que o inclua) nao vaza', async () => {
    await expect(A().session.findMany({ where: { ownerId: b.id } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    expect(await A().session.findMany({ where: { ownerId: { in: [a.id, b.id] } } })).toHaveLength(
      2,
    );
    expect(
      await A().session.findMany({ where: { OR: [{ id: sessionB.id }, { id: sessionA.id }] } }),
    ).toHaveLength(1);
    expect(await A().session.findMany({ where: { NOT: { ownerId: a.id } } })).toEqual([]);
  });

  it('relacoes carregadas a partir do modelo privado ficam no mesmo dono', async () => {
    const rows = await A().consentRecord.findMany({ include: { owner: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.owner.id).toBe(a.id);
  });
});

describe('forOwner: escrita isolada', () => {
  it('create injeta o ownerId (mesmo sem informa-lo) e recusa outro dono ou a relacao owner', async () => {
    // O tipo do Prisma exige ownerId; a extensao tambem o injeta quando omitido.
    const created = await A().auditEvent.create({
      data: { action: 'x.created', entityType: 'X' } as never,
    });
    expect(created.ownerId).toBe(a.id);
    await expect(
      A().auditEvent.create({ data: { ownerId: b.id, action: 'x', entityType: 'X' } }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(
      A().auditEvent.create({
        data: { action: 'x', entityType: 'X', owner: { connect: { id: b.id } } },
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
    expect(await B().auditEvent.count()).toBe(0);
  });

  it('createMany/createManyAndReturn escopam todas as linhas e abortam se alguma for de outro dono', async () => {
    const rows = await A().auditEvent.createManyAndReturn({
      data: [
        { action: 'm.1', entityType: 'M' },
        { action: 'm.2', entityType: 'M' },
      ] as never,
    });
    expect(rows.map((r) => r.ownerId)).toEqual([a.id, a.id]);
    const { count } = await A().auditEvent.createMany({
      data: [{ action: 'm.3', entityType: 'M' }] as never,
    });
    expect(count).toBe(1);
    await expect(
      A().auditEvent.createMany({
        data: [
          { action: 'm.4', entityType: 'M' },
          { ownerId: b.id, action: 'm.5', entityType: 'M' },
        ] as never,
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
    expect(await A().auditEvent.count({ where: { action: { in: ['m.4', 'm.5'] } } })).toBe(0);
    expect(await B().auditEvent.count()).toBe(0);
  });

  it('update/delete em linha de outro dono falham sem tocar a linha', async () => {
    await expect(
      A().session.update({ where: { id: sessionB.id }, data: { userAgent: 'hack' } }),
    ).rejects.toThrow();
    await expect(A().session.delete({ where: { id: sessionB.id } })).rejects.toThrow();
    const intact = await B().session.findUniqueOrThrow({ where: { id: sessionB.id } });
    expect(intact.userAgent).toBeNull();
  });

  it('updateMany/deleteMany so afetam o proprio dono', async () => {
    expect(
      (await A().session.updateMany({ where: { id: sessionB.id }, data: { userAgent: 'x' } }))
        .count,
    ).toBe(0);
    expect((await A().session.deleteMany({ where: { id: sessionB.id } })).count).toBe(0);
    expect((await A().session.updateMany({ where: {}, data: { userAgent: 'ua-a' } })).count).toBe(
      2,
    );
    expect(await B().session.count({ where: { userAgent: 'ua-a' } })).toBe(0);
  });

  it('update proprio funciona; ownerId nao pode ser alterado', async () => {
    const updated = await A().session.update({
      where: { id: sessionA.id },
      data: { lastSeenAt: new Date() },
    });
    expect(updated.ownerId).toBe(a.id);
    await expect(
      A().session.update({ where: { id: sessionA.id }, data: { ownerId: b.id } }),
    ).rejects.toThrow(OwnerScopeViolationError);
    await expect(A().session.updateMany({ data: { ownerId: b.id } })).rejects.toThrow(
      OwnerScopeViolationError,
    );
    expect(
      (await testDb.db.unsafeRaw.session.findUniqueOrThrow({ where: { id: sessionA.id } })).ownerId,
    ).toBe(a.id);
  });

  it('upsert escopa where e create; nao consegue sobrescrever linha de outro dono', async () => {
    const own = await A().consentRecord.findFirstOrThrow();
    const updated = await A().consentRecord.upsert({
      where: { id: own.id },
      create: { purpose: 'ai_processing', granted: true, policyVersion: 'v9' } as never,
      update: { policyVersion: 'v2' },
    });
    expect(updated.policyVersion).toBe('v2');

    const foreign = await B().consentRecord.findFirstOrThrow();
    // where escopado nao acha a linha de B -> cai em create, que colide com a PK e e rejeitado.
    await expect(
      A().consentRecord.upsert({
        where: { id: foreign.id },
        create: {
          id: foreign.id,
          purpose: 'ai_processing',
          granted: false,
          policyVersion: 'x',
        } as never,
        update: { policyVersion: 'hack' },
      }),
    ).rejects.toThrow();
    expect(
      (await B().consentRecord.findUniqueOrThrow({ where: { id: foreign.id } })).policyVersion,
    ).toBe('v1');
    await expect(
      A().consentRecord.upsert({
        where: { id: own.id },
        create: { purpose: 'ai_processing', granted: true, policyVersion: 'v' } as never,
        update: { ownerId: b.id },
      }),
    ).rejects.toThrow(OwnerScopeViolationError);
  });

  it('delete proprio funciona', async () => {
    const event = await A().auditEvent.create({
      data: { action: 'tmp', entityType: 'T' } as never,
    });
    await A().auditEvent.delete({ where: { id: event.id } });
    expect(await A().auditEvent.findUnique({ where: { id: event.id } })).toBeNull();
  });
});

describe('forOwner: transacoes', () => {
  it('$transaction interativa mantem o escopo', async () => {
    await A().$transaction(async (tx) => {
      expect(await tx.session.findMany({ where: { id: sessionB.id } })).toEqual([]);
      await expect(tx.session.findMany({ where: { ownerId: b.id } })).rejects.toThrow(
        OwnerScopeViolationError,
      );
    });
  });

  it('$transaction em lote mantem o escopo e faz rollback em erro', async () => {
    await expect(
      A().$transaction([
        A().auditEvent.create({ data: { action: 'tx.1', entityType: 'T' } as never }),
        A().auditEvent.create({ data: { ownerId: b.id, action: 'tx.2', entityType: 'T' } }),
      ]),
    ).rejects.toThrow(OwnerScopeViolationError);
    expect(await A().auditEvent.count({ where: { action: { startsWith: 'tx.' } } })).toBe(0);
  });
});

describe('modelo privado sem escopo lanca erro', () => {
  const unscopedOps: [string, (c: typeof testDb.db.global) => Promise<unknown>][] = [
    ['credential.findMany', (c) => c.credential.findMany()],
    ['session.findMany', (c) => c.session.findMany()],
    ['session.findUnique', (c) => c.session.findUnique({ where: { id: sessionA.id } })],
    ['session.count', (c) => c.session.count()],
    ['session.deleteMany', (c) => c.session.deleteMany()],
    ['session.update', (c) => c.session.update({ where: { id: sessionA.id }, data: {} })],
    ['consentRecord.create', (c) => c.consentRecord.create({ data: {} as never })],
    ['auditEvent.createMany', (c) => c.auditEvent.createMany({ data: [] })],
    [
      'auditEvent.upsert',
      (c) => c.auditEvent.upsert({ where: { id: 'x' }, create: {} as never, update: {} }),
    ],
  ];

  it.each(unscopedOps)('%s no cliente global lanca UnscopedAccessError', async (_name, run) => {
    await expect(run(testDb.db.global)).rejects.toThrow(UnscopedAccessError);
  });

  it('a mensagem orienta o uso de forOwner e cita modelo e operacao', async () => {
    await expect(testDb.db.global.session.findMany()).rejects.toThrow(
      /modelo privado "Session" \(findMany\).*forOwner\(ownerId\)\.session\.findMany/,
    );
  });

  it('todo modelo privado do registro lanca sem escopo (e funciona com escopo)', async () => {
    for (const model of PRIVATE_MODELS) {
      const key = (model.charAt(0).toLowerCase() + model.slice(1)) as 'session';
      await expect(testDb.db.global[key].count()).rejects.toThrow(UnscopedAccessError);
      await expect(testDb.db.forOwner(a.id)[key].count()).resolves.toEqual(expect.any(Number));
    }
  });

  it('modelos globais funcionam sem escopo', async () => {
    expect(await testDb.db.global.user.count()).toBe(2);
    expect(await testDb.db.global.invite.count()).toBe(0);
  });

  it('forOwner exige ownerId UUID valido', () => {
    for (const bad of ['', 'x', undefined as never, null as never]) {
      expect(() => testDb.db.forOwner(bad)).toThrow(OwnerScopeViolationError);
    }
  });

  it('o modelo global nao serve de porta para linhas privadas (include/select/where aninhado)', async () => {
    const attempts: [string, () => Promise<unknown>][] = [
      [
        'global include',
        () =>
          testDb.db.global.user.findUnique({ where: { id: a.id }, include: { sessions: true } }),
      ],
      ['global select', () => testDb.db.global.user.findMany({ select: { consentRecords: true } })],
      [
        'global where',
        () => testDb.db.global.user.findMany({ where: { credentials: { some: {} } } }),
      ],
      [
        'global nested',
        () =>
          testDb.db.global.invite.findMany({
            include: { usedBy: { include: { auditEvents: true } } },
          }),
      ],
      ['scoped include', () => A().user.findMany({ include: { sessions: true } })],
    ];
    for (const [, run] of attempts) {
      await expect(run()).rejects.toThrow(OwnerScopeViolationError);
    }
  });

  it('LACUNA documentada: o cliente bruto (unsafeRaw) nao tem protecao', async () => {
    expect(await testDb.db.unsafeRaw.session.count()).toBeGreaterThanOrEqual(3);
  });
});
