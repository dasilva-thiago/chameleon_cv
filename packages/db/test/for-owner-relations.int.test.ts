import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestedRelationWriteError } from '../src/errors';
import { relationFieldsOfClient } from '../src/for-owner';
import { PRIVATE_MODELS } from '../src/private-models';
import { createProfileStore, type ProfileStore } from '../src/profile-store';
import { createTestDb, type TestDb } from '../src/testing';
import { fixtureDocument } from './support/profile-docs';
import { testSnapshot } from './support/snapshot';

/**
 * Escritas por relacao em forOwner no banco REAL (defeito da S1.4): o `connect` para o perfil de A
 * trocava `(profileId, ownerId)` da linha de B. Camada de aplicacao: rejeitar. Camada de banco:
 * `owner-immutable.int.test.ts`.
 */
let testDb: TestDb;
let store: ProfileStore;
interface Owner {
  id: string;
  profileId: string;
  contactId: string;
  importId: string;
  factId: string;
}
let a: Owner;
let b: Owner;

type Delegate = Record<string, (args: unknown) => Promise<unknown>>;
const delegates = (ownerId: string): Record<string, Delegate> =>
  testDb.db.forOwner(ownerId) as unknown as Record<string, Delegate>;
const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);

async function makeOwner(label: string): Promise<Owner> {
  const user = await testDb.db.global.user.create({
    data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, displayName: label },
  });
  const saved = await store.saveProfileDocument(
    user.id,
    fixtureDocument('experienced-promotions-same-employer'),
  );
  const scoped = testDb.db.forOwner(user.id);
  // Escalares `xId` (formato unchecked): o caminho permitido.
  const contact = await scoped.contactPoint.create({
    data: {
      ownerId: user.id,
      profileId: saved.profileId,
      kind: 'email',
      value: `${label}@example.test`,
    },
  });
  const imp = await scoped.importRecord.create({
    data: {
      ownerId: user.id,
      profileId: saved.profileId,
      sourceFormat: 'object',
      targetSchemaVersion: '2.1.0',
    },
  });
  const fact = await testDb.sql<{ id: string }>(
    `SELECT id::text FROM "ProfileFact" WHERE "ownerId" = $1::uuid LIMIT 1`,
    [user.id],
  );
  return {
    id: user.id,
    profileId: saved.profileId,
    contactId: contact.id,
    importId: imp.id,
    factId: fact.rows[0]!.id,
  };
}

const ownerOf = async (table: string, id: string): Promise<string | undefined> =>
  (
    await testDb.sql<{ owner: string }>(
      `SELECT "ownerId"::text AS owner FROM "${table}" WHERE id = $1::uuid`,
      [id],
    )
  ).rows[0]?.owner;

const totalRows = async (): Promise<number> =>
  Number(
    (
      await testDb.sql<{ n: string }>(
        `SELECT (SELECT count(*) FROM "ContactPoint") + (SELECT count(*) FROM "ImportRecord")
              + (SELECT count(*) FROM "ProfileFact") + (SELECT count(*) FROM "ProfessionalProfile") AS n`,
      )
    ).rows[0]!.n,
  );

beforeAll(async () => {
  testDb = await createTestDb();
  store = createProfileStore(testDb.db, { snapshot: testSnapshot });
  a = await makeOwner('a');
  b = await makeOwner('b');
}, 120_000);
afterAll(async () => {
  await testDb.drop();
});

describe('caso reportado: forOwner(B) nao transfere linha de B para o perfil de A', () => {
  const cases: [string, () => string, () => string][] = [
    ['ContactPoint', () => b.contactId, () => 'contactPoint'],
    ['ImportRecord', () => b.importId, () => 'importRecord'],
    ['ProfileFact', () => b.factId, () => 'profileFact'],
  ];

  it.each(cases)(
    '%s: update com profile.connect lanca e a linha continua de B',
    async (table, rowId, key) => {
      const delegate = delegates(b.id)[key()]!;
      const before = await totalRows();
      await expect(
        delegate.update!({
          where: { id: rowId() },
          data: { profile: { connect: { id: a.profileId } } },
        }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
      expect(await ownerOf(table, rowId())).toBe(b.id);
      expect(await totalRows()).toBe(before);
    },
  );

  it.each(cases)(
    '%s: upsert (update e create) com profile.connect lanca',
    async (table, rowId, key) => {
      const delegate = delegates(b.id)[key()]!;
      const connect = { profile: { connect: { id: a.profileId } } };
      await expect(
        delegate.upsert!({ where: { id: rowId() }, create: { ownerId: b.id }, update: connect }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
      await expect(
        delegate.upsert!({
          where: { id: randomUUID() },
          create: { ownerId: b.id, ...connect },
          update: {},
        }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
      expect(await ownerOf(table, rowId())).toBe(b.id);
    },
  );

  it.each(cases)('%s: updateMany com profile.connect lanca', async (table, rowId, key) => {
    await expect(
      delegates(b.id)[key()]!.updateMany!({
        where: {},
        data: { profile: { connect: { id: a.profileId } } },
      }),
    ).rejects.toBeInstanceOf(NestedRelationWriteError);
    expect(await ownerOf(table, rowId())).toBe(b.id);
  });

  it('create com connect: lanca na aplicacao e o Prisma tambem recusa por validacao (sem forOwner)', async () => {
    const data = {
      ownerId: b.id,
      kind: 'email',
      value: 'x@example.test',
      profile: { connect: { id: a.profileId } },
    };
    const before = await totalRows();
    await expect(delegates(b.id).contactPoint!.create!({ data })).rejects.toBeInstanceOf(
      NestedRelationWriteError,
    );
    await expect(
      delegates(b.id).contactPoint!.createMany!({ data: [data] }),
    ).rejects.toBeInstanceOf(NestedRelationWriteError);
    // Rede do Prisma (nao e a defesa principal): mistura de ownerId escalar e relacao e invalida.
    await expect(
      (testDb.db.unsafeRaw.contactPoint.create as unknown as (args: unknown) => Promise<unknown>)({
        data,
      }),
    ).rejects.toMatchObject({ name: 'PrismaClientValidationError' });
    expect(await totalRows()).toBe(before);
  });
});

describe('matriz: todo modelo privado x toda relacao x toda escrita', () => {
  it('lanca NestedRelationWriteError sem tocar no banco', async () => {
    const relations = relationFieldsOfClient(testDb.db.unsafeRaw);
    const scoped = delegates(b.id);
    const before = await totalRows();
    let attempts = 0;
    for (const model of PRIVATE_MODELS) {
      const delegate = scoped[lowerFirst(model)];
      if (!delegate) throw new Error(`delegate ausente: ${model}`);
      for (const relation of relations.get(model)!) {
        if (relation === 'owner') continue; // `owner` tem erro proprio (ownerId e injetado)
        const nested = { [relation]: { connect: { id: a.profileId } } };
        const calls: [string, Promise<unknown>][] = [
          ['create', delegate.create!({ data: { ownerId: b.id, ...nested } })],
          ['createMany', delegate.createMany!({ data: [{ ownerId: b.id, ...nested }] })],
          ['update', delegate.update!({ where: { id: randomUUID() }, data: nested })],
          ['updateMany', delegate.updateMany!({ where: {}, data: nested })],
          [
            'upsert.update',
            delegate.upsert!({
              where: { id: randomUUID() },
              create: { ownerId: b.id },
              update: nested,
            }),
          ],
          [
            'upsert.create',
            delegate.upsert!({
              where: { id: randomUUID() },
              create: { ownerId: b.id, ...nested },
              update: {},
            }),
          ],
        ];
        for (const [op, call] of calls) {
          attempts += 1;
          await expect(call, `${model}.${relation} via ${op}`).rejects.toBeInstanceOf(
            NestedRelationWriteError,
          );
        }
      }
    }
    expect(attempts).toBeGreaterThan(100);
    expect(await totalRows()).toBe(before);
  });

  it('relacao to-many (set/disconnect/delete...) em modelo pai tambem lanca', async () => {
    const profile = delegates(b.id).professionalProfile!;
    for (const op of [
      { set: [{ id: randomUUID() }] },
      { disconnect: [{ id: randomUUID() }] },
      { deleteMany: {} },
      { create: [{ ownerId: b.id }] },
    ]) {
      await expect(
        profile.update!({ where: { id: b.profileId }, data: { contactPoints: op } }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
    }
    expect(await ownerOf('ContactPoint', b.contactId)).toBe(b.id);
  });
});

describe('escalares xId (formato unchecked) continuam permitidos', () => {
  it('update/upsert do proprio dono funcionam', async () => {
    const contacts = delegates(b.id).contactPoint!;
    await contacts.update!({
      where: { id: b.contactId },
      data: { profileId: b.profileId, label: 'x' },
    });
    await contacts.upsert!({
      where: { id: b.contactId },
      create: { ownerId: b.id, profileId: b.profileId, kind: 'email', value: 'y@example.test' },
      update: { label: 'y', profileId: b.profileId },
    });
    const created = (await contacts.upsert!({
      where: { id: randomUUID() },
      create: { ownerId: b.id, profileId: b.profileId, kind: 'phone', value: '+5511999990000' },
      update: {},
    })) as { id: string };
    expect(await ownerOf('ContactPoint', created.id)).toBe(b.id);
    await contacts.updateMany!({ where: { id: created.id }, data: { label: 'z' } });
  });

  it('escalar apontando para o perfil de A e recusado pela FK composta (P2003) e nada muda', async () => {
    await expect(
      delegates(b.id).contactPoint!.update!({
        where: { id: b.contactId },
        data: { profileId: a.profileId },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await ownerOf('ContactPoint', b.contactId)).toBe(b.id);
  });

  it('forOwner(B) nao alcanca a linha de A (where escopado)', async () => {
    await expect(
      delegates(b.id).contactPoint!.update!({
        where: { id: a.contactId },
        data: { label: 'invasao' },
      }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(await ownerOf('ContactPoint', a.contactId)).toBe(a.id);
  });
});

describe('regressao: o ProfileStore nao usa escrita aninhada', () => {
  it('save, reload, reimport e revisao continuam funcionando', async () => {
    const owner = await makeOwner('c');
    const document = fixtureDocument('career-changer-teacher-to-data');
    const saved = await store.saveProfileDocument(owner.id, document, {
      onMissing: 'archive',
      revision: 'manual_save',
    });
    const loaded = await store.loadProfileDocument(owner.id);
    expect(loaded?.profileId).toBe(saved.profileId);
    const again = await store.saveProfileDocument(owner.id, document, { onMissing: 'delete' });
    expect(again.profileId).toBe(saved.profileId);
    const revision = await store.createRevision(owner.id, { reason: 'pre_generation' });
    expect(revision.revision.id).toBeTruthy();
    expect((await store.listImportRecords(owner.id)).length).toBeGreaterThan(0);
  });
});
