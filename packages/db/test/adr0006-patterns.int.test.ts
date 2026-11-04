import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../src/testing';

/**
 * Spike S1.1a: os padroes do ADR-0006/ADR-0008 (PK compartilhada fato <-> tabela tipada, FK composta
 * (id, ownerId), FK composta opcional, CHECK e trigger manuais) validados no PostgreSQL real.
 * O DDL e o gerado pelo Prisma 7.10.1 para o schema do spike (veja o cabecalho do .sql). Roda em um
 * clone descartavel com as tabelas "Spike*"; nao toca o schema real. O agregado de perfil real (S1.1b)
 * herda estes padroes, e identity-schema.int.test.ts confere as invariantes no schema real.
 */
const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'adr0006-patterns.sql'),
  'utf8',
);

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
  await testDb.sql(FIXTURE);
});
afterAll(async () => {
  await testDb.drop();
});

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}
async function failure(promise: Promise<unknown>): Promise<PgError> {
  try {
    await promise;
  } catch (error) {
    return error as PgError;
  }
  throw new Error('esperava falha, mas a operacao passou');
}

interface World {
  a: string;
  b: string;
  profileA: string;
  profileB: string;
}
async function world(): Promise<World> {
  const [a, b, profileA, profileB] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await testDb.sql(`INSERT INTO "SpikeProfile" (id, "ownerId") VALUES ($1, $2), ($3, $4)`, [
    profileA,
    a,
    profileB,
    b,
  ]);
  return { a, b, profileA, profileB };
}
const addFact = (id: string, owner: string, profile: string, kind: 'experience' | 'skill') =>
  testDb.sql(`INSERT INTO "SpikeFact" (id, "ownerId", "profileId", kind) VALUES ($1, $2, $3, $4)`, [
    id,
    owner,
    profile,
    kind,
  ]);

describe('PK compartilhada fato <-> tabela tipada', () => {
  it('cria fato + experiencia com o mesmo id (duas linhas) e a cascata remove a tipada', async () => {
    const w = await world();
    const id = randomUUID();
    await addFact(id, w.a, w.profileA, 'experience');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      id,
      w.a,
    ]);
    await testDb.sql(`DELETE FROM "SpikeFact" WHERE id = $1`, [id]);
    const left = await testDb.sql(`SELECT 1 FROM "SpikeExperience" WHERE id = $1`, [id]);
    expect(left.rowCount).toBe(0);
  });

  it('tabela tipada sem fato correspondente e rejeitada', async () => {
    const w = await world();
    const error = await failure(
      testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
        randomUUID(),
        w.a,
      ]),
    );
    expect(error.code).toBe('23503');
    expect(error.constraint).toBe('SpikeExperience_id_ownerId_fkey');
  });

  it('a mesma linha tipada nao pode existir duas vezes para o mesmo fato (PK)', async () => {
    const w = await world();
    const id = randomUUID();
    await addFact(id, w.a, w.profileA, 'experience');
    const insert = () =>
      testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
        id,
        w.a,
      ]);
    await insert();
    expect((await failure(insert())).code).toBe('23505');
  });

  it('GAP documentado: o banco NAO impede kind inconsistente com a tabela tipada', async () => {
    // ProfileFact.kind = skill + linha em Experience passa no banco; a coerencia e da aplicacao
    // (ADR-0006, Consequencias) e fica coberta por teste de integracao no ProfileStore (S1.1b).
    const w = await world();
    const id = randomUUID();
    await addFact(id, w.a, w.profileA, 'skill');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      id,
      w.a,
    ]);
  });
});

describe('FK composta (id, ownerId) rejeita vinculo entre donos (ADR-0008, item 5d)', () => {
  it('fato do dono B apontando para o perfil do dono A', async () => {
    const w = await world();
    const error = await failure(addFact(randomUUID(), w.b, w.profileA, 'skill'));
    expect(error.code).toBe('23503');
    expect(error.constraint).toBe('SpikeFact_profileId_ownerId_fkey');
  });

  it('tabela tipada do dono B apontando para o fato do dono A', async () => {
    const w = await world();
    const id = randomUUID();
    await addFact(id, w.a, w.profileA, 'skill'); // fato de A sem linha tipada ainda
    const error = await failure(
      testDb.sql(`INSERT INTO "SpikeSkill" (id, "ownerId", name) VALUES ($1, $2, 'x')`, [id, w.b]),
    );
    expect(error.constraint).toBe('SpikeSkill_id_ownerId_fkey');
  });

  it('item do dono B apontando para a experiencia do dono A', async () => {
    const w = await world();
    const exp = randomUUID();
    await addFact(exp, w.a, w.profileA, 'experience');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      exp,
      w.a,
    ]);
    const error = await failure(
      testDb.sql(
        `INSERT INTO "SpikeItem" (id, "ownerId", "experienceId", text) VALUES ($1, $2, $3, 't')`,
        [randomUUID(), w.b, exp],
      ),
    );
    expect(error.code).toBe('23503');
    expect(error.constraint).toBe('SpikeItem_experienceId_ownerId_fkey');
  });

  it('mover um filho para outro dono por UPDATE tambem e rejeitado', async () => {
    const w = await world();
    const skill = randomUUID();
    await addFact(skill, w.a, w.profileA, 'skill');
    await testDb.sql(`INSERT INTO "SpikeSkill" (id, "ownerId", name) VALUES ($1, $2, 's')`, [
      skill,
      w.a,
    ]);
    const usage = randomUUID();
    await testDb.sql('INSERT INTO "SpikeUsage" (id, "ownerId", "skillId") VALUES ($1, $2, $3)', [
      usage,
      w.a,
      skill,
    ]);
    const error = await failure(
      testDb.sql('UPDATE "SpikeUsage" SET "ownerId" = $1 WHERE id = $2', [w.b, usage]),
    );
    expect(error.code).toBe('23503');
    expect(error.constraint).toBe('SpikeUsage_skillId_ownerId_fkey');
  });

  it('FK composta OPCIONAL: nula e aceita; preenchida de outro dono e rejeitada', async () => {
    const w = await world();
    const [skill, exp] = [randomUUID(), randomUUID()];
    await addFact(skill, w.a, w.profileA, 'skill');
    await testDb.sql(`INSERT INTO "SpikeSkill" (id, "ownerId", name) VALUES ($1, $2, 's')`, [
      skill,
      w.a,
    ]);
    await addFact(exp, w.a, w.profileA, 'experience');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      exp,
      w.a,
    ]);
    const usage = (owner: string, experienceId: string | null) =>
      testDb.sql(
        `INSERT INTO "SpikeUsage" (id, "ownerId", "skillId", "experienceId") VALUES ($1, $2, $3, $4)`,
        [randomUUID(), owner, skill, experienceId],
      );
    await usage(w.a, null); // sem fonte: MATCH SIMPLE desliga a FK
    await usage(w.a, exp); // mesma fonte e mesmo dono
    expect((await failure(usage(w.b, exp))).code).toBe('23503'); // dono B nem enxerga a skill de A
  });
});

describe('CHECK e trigger de migracao SQL manual', () => {
  it('CHECK rejeita duas fontes preenchidas', async () => {
    const w = await world();
    const [skill, exp] = [randomUUID(), randomUUID()];
    await addFact(skill, w.a, w.profileA, 'skill');
    await testDb.sql(`INSERT INTO "SpikeSkill" (id, "ownerId", name) VALUES ($1, $2, 's')`, [
      skill,
      w.a,
    ]);
    await addFact(exp, w.a, w.profileA, 'experience');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      exp,
      w.a,
    ]);
    const error = await failure(
      testDb.sql(
        `INSERT INTO "SpikeUsage" (id, "ownerId", "skillId", "experienceId", "projectId") VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), w.a, skill, exp, randomUUID()],
      ),
    );
    expect(error.code).toBe('23514');
    expect(error.constraint).toBe('SpikeUsage_single_source_chk');
  });

  it('trigger de imutabilidade bloqueia UPDATE/DELETE e abre excecao em transacao com allow_purge', async () => {
    const w = await world();
    const [exp, item] = [randomUUID(), randomUUID()];
    await addFact(exp, w.a, w.profileA, 'experience');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      exp,
      w.a,
    ]);
    await testDb.sql(
      `INSERT INTO "SpikeItem" (id, "ownerId", "experienceId", text) VALUES ($1, $2, $3, 'fixo')`,
      [item, w.a, exp],
    );

    const update = await failure(
      testDb.sql(`UPDATE "SpikeItem" SET text = 'x' WHERE id = $1`, [item]),
    );
    expect(update.code).toBe('23000');
    expect(update.message).toContain('imutavel');
    const del = await failure(testDb.sql(`DELETE FROM "SpikeItem" WHERE id = $1`, [item]));
    expect(del.code).toBe('23000');

    // excecao controlada (exclusao de conta): SET LOCAL em transacao
    await testDb.sql(
      `DO $$ BEGIN
         PERFORM set_config('chameleon.allow_purge', 'on', true);
         DELETE FROM "SpikeItem" WHERE id = '${item}';
       END $$`,
    );
    expect((await testDb.sql(`SELECT 1 FROM "SpikeItem" WHERE id = $1`, [item])).rowCount).toBe(0);
  });

  it('a excecao allow_purge nao vaza para fora da transacao', async () => {
    const w = await world();
    const [exp, item] = [randomUUID(), randomUUID()];
    await addFact(exp, w.a, w.profileA, 'experience');
    await testDb.sql(`INSERT INTO "SpikeExperience" (id, "ownerId", title) VALUES ($1, $2, 'x')`, [
      exp,
      w.a,
    ]);
    await testDb.sql(
      `INSERT INTO "SpikeItem" (id, "ownerId", "experienceId", text) VALUES ($1, $2, $3, 'fixo')`,
      [item, w.a, exp],
    );
    await testDb.sql(`DO $$ BEGIN PERFORM set_config('chameleon.allow_purge', 'on', true); END $$`);
    expect((await failure(testDb.sql(`DELETE FROM "SpikeItem" WHERE id = $1`, [item]))).code).toBe(
      '23000',
    );
  });
});
