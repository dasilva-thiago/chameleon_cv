import { randomUUID, createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestedRelationWriteError } from '../src/errors';
import { relationFieldsOfClient } from '../src/for-owner';
import { PRIVATE_MODELS } from '../src/private-models';
import { createTestDb, type TestDb } from '../src/testing';

/**
 * Escritas por relacao em forOwner no banco REAL (defeito da S1.4): um `connect` para uma linha de A
 * trocava `(xId, ownerId)` da linha de B. Camada de aplicacao: rejeitar. Camada de banco:
 * `owner-immutable.int.test.ts`.
 */
let testDb: TestDb;
interface Owner {
  id: string;
  revisionId: string;
  baseId: string;
  jobId: string;
  resumeId: string;
  analysisId: string;
}
let a: Owner;
let b: Owner;

type Delegate = Record<string, (args: unknown) => Promise<unknown>>;
const delegates = (ownerId: string): Record<string, Delegate> =>
  testDb.db.forOwner(ownerId) as unknown as Record<string, Delegate>;
const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

async function makeOwner(label: string): Promise<Owner> {
  const user = await testDb.db.global.user.create({
    data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, displayName: label },
  });
  const ownerId = user.id;
  const scoped = testDb.db.forOwner(ownerId);
  // Escalares `xId` (formato unchecked): o caminho permitido.
  const revision = await scoped.profileBaseRevision.create({
    data: { ownerId, cvMarkdown: `# CV -- ${label}`, profileMarkdown: '', contentHash: sha(label) },
  });
  const base = await scoped.profileBase.create({
    data: {
      ownerId,
      cvMarkdown: `# CV -- ${label}`,
      profileMarkdown: '',
      contentHash: sha(label),
      revisionId: revision.id,
    },
  });
  const job = await scoped.jobPosting.create({
    data: { ownerId, description: `vaga ${label}`, descriptionHash: sha(`vaga ${label}`) },
  });
  const resume = await scoped.resume.create({ data: { ownerId, jobId: job.id, name: label } });
  const analysis = await scoped.jobAnalysis.create({
    data: {
      ownerId,
      jobId: job.id,
      descriptionHash: sha(`vaga ${label}`),
      profileHash: sha(label),
      engine: 'ai',
      engineVersion: 't',
      result: {},
    },
  });
  return {
    id: ownerId,
    revisionId: revision.id,
    baseId: base.id,
    jobId: job.id,
    resumeId: resume.id,
    analysisId: analysis.id,
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
        `SELECT (SELECT count(*) FROM "ProfileBase") + (SELECT count(*) FROM "ProfileBaseRevision")
              + (SELECT count(*) FROM "JobPosting") + (SELECT count(*) FROM "Resume")
              + (SELECT count(*) FROM "JobAnalysis") AS n`,
      )
    ).rows[0]!.n,
  );

beforeAll(async () => {
  testDb = await createTestDb();
  a = await makeOwner('a');
  b = await makeOwner('b');
}, 120_000);
afterAll(async () => {
  await testDb.drop();
});

describe('caso reportado: forOwner(B) nao transfere linha de B para uma linha de A', () => {
  // [tabela, id da linha de B, delegate, relacao, id do alvo de A]
  const cases: [string, () => string, string, string, () => string][] = [
    ['ProfileBase', () => b.baseId, 'profileBase', 'revision', () => a.revisionId],
    ['Resume', () => b.resumeId, 'resume', 'job', () => a.jobId],
    ['JobAnalysis', () => b.analysisId, 'jobAnalysis', 'job', () => a.jobId],
  ];

  it.each(cases)(
    '%s: update com connect lanca e a linha continua de B',
    async (table, rowId, key, relation, target) => {
      const delegate = delegates(b.id)[key]!;
      const before = await totalRows();
      await expect(
        delegate.update!({
          where: { id: rowId() },
          data: { [relation]: { connect: { id: target() } } },
        }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
      expect(await ownerOf(table, rowId())).toBe(b.id);
      expect(await totalRows()).toBe(before);
    },
  );

  it.each(cases)(
    '%s: upsert (update e create) com connect lanca',
    async (table, rowId, key, relation, target) => {
      const delegate = delegates(b.id)[key]!;
      const connect = { [relation]: { connect: { id: target() } } };
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

  it.each(cases)(
    '%s: updateMany com connect lanca',
    async (table, rowId, key, relation, target) => {
      await expect(
        delegates(b.id)[key]!.updateMany!({
          where: {},
          data: { [relation]: { connect: { id: target() } } },
        }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
      expect(await ownerOf(table, rowId())).toBe(b.id);
    },
  );

  it('create com connect: lanca na aplicacao e o Prisma tambem recusa por validacao (sem forOwner)', async () => {
    const data = { ownerId: b.id, name: 'x', job: { connect: { id: a.jobId } } };
    const before = await totalRows();
    await expect(delegates(b.id).resume!.create!({ data })).rejects.toBeInstanceOf(
      NestedRelationWriteError,
    );
    await expect(delegates(b.id).resume!.createMany!({ data: [data] })).rejects.toBeInstanceOf(
      NestedRelationWriteError,
    );
    // Rede do Prisma (nao e a defesa principal): mistura de ownerId escalar e relacao e invalida.
    await expect(
      (testDb.db.unsafeRaw.resume.create as unknown as (args: unknown) => Promise<unknown>)({
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
        const nested = { [relation]: { connect: { id: a.jobId } } };
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
    expect(attempts).toBeGreaterThan(50);
    expect(await totalRows()).toBe(before);
  });

  it('relacao to-many (set/disconnect/delete...) em modelo pai tambem lanca', async () => {
    const jobs = delegates(b.id).jobPosting!;
    for (const op of [
      { set: [{ id: randomUUID() }] },
      { disconnect: [{ id: randomUUID() }] },
      { deleteMany: {} },
      { create: [{ ownerId: b.id, name: 'x' }] },
    ]) {
      await expect(
        jobs.update!({ where: { id: b.jobId }, data: { resumes: op } }),
      ).rejects.toBeInstanceOf(NestedRelationWriteError);
    }
    expect(await ownerOf('Resume', b.resumeId)).toBe(b.id);
  });
});

describe('escalares xId (formato unchecked) continuam permitidos', () => {
  it('update/upsert do proprio dono funcionam', async () => {
    const resumes = delegates(b.id).resume!;
    await resumes.update!({ where: { id: b.resumeId }, data: { jobId: b.jobId, name: 'x' } });
    await resumes.upsert!({
      where: { id: b.resumeId },
      create: { ownerId: b.id, jobId: b.jobId, name: 'y' },
      update: { name: 'y', jobId: b.jobId },
    });
    const created = (await resumes.upsert!({
      where: { id: randomUUID() },
      create: { ownerId: b.id, jobId: b.jobId, name: 'novo' },
      update: {},
    })) as { id: string };
    expect(await ownerOf('Resume', created.id)).toBe(b.id);
    await resumes.updateMany!({ where: { id: created.id }, data: { name: 'z' } });
  });

  it('escalar apontando para a vaga de A e recusado pela FK composta (P2003) e nada muda', async () => {
    await expect(
      delegates(b.id).resume!.update!({ where: { id: b.resumeId }, data: { jobId: a.jobId } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    expect(await ownerOf('Resume', b.resumeId)).toBe(b.id);
  });

  it('forOwner(B) nao alcanca a linha de A (where escopado)', async () => {
    await expect(
      delegates(b.id).resume!.update!({ where: { id: a.resumeId }, data: { name: 'invasao' } }),
    ).rejects.toMatchObject({ code: 'P2025' });
    expect(await ownerOf('Resume', a.resumeId)).toBe(a.id);
  });
});
