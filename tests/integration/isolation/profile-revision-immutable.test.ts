import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listTablesWithColumn, quote } from './support/catalog';
import { assertLogsClean } from './support/logs';
import { lit, probe } from './support/sql';
import {
  PRIVATE_MODELS,
  createTestAccount,
  loadProfileYaml,
  importProfile,
} from './support/workspace';
import { createWorld, type World } from './support/world';

/**
 * Criterio da Fase 1: "UPDATE em ProfileRevision falha (trigger)". ADR-0006/ADR-0014: a revisao e
 * imutavel; a unica excecao e DELETE dentro de uma transacao com `SET LOCAL chameleon.allow_purge = 'on'`
 * (exclusao de conta). Sem a flag, `DELETE FROM "User"` tambem falha (a cascata atinge a revisao).
 */
let world: World;
beforeAll(async () => {
  world = await createWorld();
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

const IMMUTABLE = 'ProfileRevision_immutable';

describe('ProfileRevision e imutavel', () => {
  it('UPDATE falha para toda coluna (SQL cru), e a linha nao muda', async () => {
    const { testDb, a } = world;
    const before = (
      await testDb.sql(`SELECT to_jsonb(r) AS row FROM "ProfileRevision" r WHERE id = $1`, [
        a.revisionId,
      ])
    ).rows;
    expect(before).toHaveLength(1);
    const assignments = [
      `"contentHash" = repeat('0', 64)`,
      `"snapshot" = '{}'::jsonb`,
      `"reason" = 'manual_save'`,
      `"revisionNumber" = 99`,
      `"createdAt" = now()`,
      `"ownerId" = "ownerId"`, // UPDATE "no-op": o trigger e por linha, nao por valor
    ];
    for (const assignment of assignments) {
      const failure = await testDb
        .sql(`UPDATE "ProfileRevision" SET ${assignment} WHERE id = ${lit(a.revisionId)}`)
        .then(
          () => null,
          (error: unknown) => error as { message?: string; code?: string; constraint?: string },
        );
      expect(failure, assignment).not.toBeNull();
      expect(failure?.message, assignment).toContain(IMMUTABLE);
      expect(failure?.code, assignment).toBe('23000'); // integrity_constraint_violation
      expect(failure?.constraint, assignment).toBe(IMMUTABLE);
    }
    const after = (
      await testDb.sql(`SELECT to_jsonb(r) AS row FROM "ProfileRevision" r WHERE id = $1`, [
        a.revisionId,
      ])
    ).rows;
    expect(after).toEqual(before);
  });

  it('DELETE falha (SQL cru e Prisma escopado); update/delete pelo Prisma tambem', async () => {
    const { testDb, a } = world;
    await expect(
      testDb.sql(`DELETE FROM "ProfileRevision" WHERE id = $1`, [a.revisionId]),
    ).rejects.toThrow(IMMUTABLE);
    const scoped = testDb.db.forOwner(a.ownerId);
    await expect(
      scoped.profileRevision.update({
        where: { id: a.revisionId },
        data: { contentHash: '0'.repeat(64) },
      }),
    ).rejects.toThrow(IMMUTABLE);
    await expect(
      scoped.profileRevision.updateMany({
        where: { id: a.revisionId },
        data: { reason: 'migration' },
      }),
    ).rejects.toThrow(IMMUTABLE);
    await expect(scoped.profileRevision.delete({ where: { id: a.revisionId } })).rejects.toThrow(
      IMMUTABLE,
    );
    await expect(
      scoped.profileRevision.deleteMany({ where: { id: a.revisionId } }),
    ).rejects.toThrow(IMMUTABLE);
    // upsert sobre revisao existente = update
    await expect(
      scoped.profileRevision.upsert({
        where: { id: a.revisionId },
        update: { reason: 'migration' },
        create: {} as never,
      }),
    ).rejects.toThrow();
    expect(await scoped.profileRevision.count({ where: { id: a.revisionId } })).toBe(1);
  });

  it('excluir o perfil (cascata) tambem e barrado: nao ha caminho de remocao sem a flag de purge', async () => {
    const { testDb, a } = world;
    await expect(
      testDb.sql(`DELETE FROM "ProfessionalProfile" WHERE id = $1`, [a.profileId]),
    ).rejects.toThrow(IMMUTABLE);
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "ProfessionalProfile" WHERE id = $1`,
      [a.profileId],
    );
    expect(rows[0]?.n).toBe('1');
  });
});

/** SQL que insere uma copia (id novo, numero alto) da revisao `baseId`: revisao sem ImportRecord apontando. */
const copyRevision = (baseId: string, newId: string): string =>
  `INSERT INTO "ProfileRevision"
     SELECT (jsonb_populate_record(NULL::"ProfileRevision",
       to_jsonb(r) || jsonb_build_object('id', ${lit(newId)}, 'revisionNumber', 9999))).*
       FROM "ProfileRevision" r WHERE r.id = ${lit(baseId)}`;

describe('purge: somente DELETE com SET LOCAL chameleon.allow_purge = on', () => {
  it('a flag so vale dentro da transacao: DELETE com a flag passa; o DELETE seguinte, sem ela, falha', async () => {
    const { testDb, b } = world;
    const target = randomUUID();
    const other = randomUUID();
    await testDb.sql(copyRevision(b.revisionId, target));
    await testDb.sql(copyRevision(b.revisionId, other).replace('9999', '9998'));

    // Transacao implicita (varios comandos numa string): SET LOCAL + DELETE.
    await testDb.sql(
      `SET LOCAL chameleon.allow_purge = 'on'; DELETE FROM "ProfileRevision" WHERE id = ${lit(target)}`,
    );
    expect(
      await testDb.db.forOwner(b.ownerId).profileRevision.count({ where: { id: target } }),
    ).toBe(0);

    // A flag nao vazou para a sessao/conexao: o proximo DELETE sem flag volta a falhar.
    const leftover = await testDb.sql<{ flag: string | null }>(
      `SELECT current_setting('chameleon.allow_purge', true) AS flag`,
    );
    expect([null, '', 'off']).toContain(leftover.rows[0]?.flag);
    await expect(
      testDb.sql(`DELETE FROM "ProfileRevision" WHERE id = ${lit(other)}`),
    ).rejects.toThrow(IMMUTABLE);
    expect(
      await testDb.db.forOwner(b.ownerId).profileRevision.count({ where: { id: other } }),
    ).toBe(1);
  });

  it('a flag nao libera UPDATE, e valores diferentes de "on" nao liberam DELETE', async () => {
    const { testDb, a } = world;
    const copy = randomUUID();
    const insert = copyRevision(a.revisionId, copy);
    for (const value of ['off', 'ON ', 'true', '1', 'yes', '']) {
      const failure = await probe(testDb, [
        insert,
        `SET LOCAL chameleon.allow_purge = ${lit(value)}`,
        `DELETE FROM "ProfileRevision" WHERE id = ${lit(copy)}`,
      ]);
      expect(failure?.message, `valor ${JSON.stringify(value)}`).toContain(IMMUTABLE);
    }
    const update = await probe(testDb, [
      insert,
      `SET LOCAL chameleon.allow_purge = 'on'`,
      `UPDATE "ProfileRevision" SET "reason" = 'migration' WHERE id = ${lit(copy)}`,
    ]);
    expect(update?.message).toContain(IMMUTABLE);
    // sanity do proprio probe: com a flag certa o DELETE e ACEITO (e tudo e desfeito pelo probe).
    const accepted = await probe(testDb, [
      insert,
      `SET LOCAL chameleon.allow_purge = 'on'`,
      `DELETE FROM "ProfileRevision" WHERE id = ${lit(copy)}`,
    ]);
    expect(accepted).toBeNull();
    expect(await testDb.db.forOwner(a.ownerId).profileRevision.count({ where: { id: copy } })).toBe(
      0,
    );
    expect(
      await testDb.db.forOwner(a.ownerId).profileRevision.count({ where: { id: a.revisionId } }),
    ).toBe(1);
  });

  it('revisao referenciada por ImportRecord nao pode ser removida isoladamente nem com a flag (FK NO ACTION)', async () => {
    const { testDb, a } = world;
    const failure = await probe(testDb, [
      `SET LOCAL chameleon.allow_purge = 'on'`,
      `DELETE FROM "ProfileRevision" WHERE id = ${lit(a.revisionId)}`,
    ]);
    expect(failure?.code).toBe('23503');
    expect(failure?.constraint).toBe('ImportRecord_revisionId_ownerId_fkey');
  });
});

describe('exclusao de conta (DELETE FROM "User")', () => {
  /** Conta descartavel com um perfil completo (revisoes, importacao...), para nao afetar A/B. */
  async function throwawayOwner() {
    const account = await createTestAccount(
      { app: world.app, config: world.config, db: world.testDb.db },
      { email: 'descartavel@example.test' },
    );
    const imported = importProfile(loadProfileYaml('student-no-employment'));
    if (!imported.ok || !imported.document) throw new Error('fixture nao importou');
    await world.store.applyImport(account.ownerId, {
      document: imported.document,
      report: imported.report,
    });
    return account;
  }

  async function rowsOf(ownerId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of await listTablesWithColumn(world.testDb, 'ownerId')) {
      const { rows } = await world.testDb.sql<{ n: string }>(
        `SELECT count(*) AS n FROM ${quote(table)} WHERE "ownerId" = $1`,
        [ownerId],
      );
      counts[table] = Number(rows[0]?.n);
    }
    return counts;
  }

  it('sem a flag falha por inteiro (nada e apagado, nem o usuario); com a flag apaga TUDO do dono e so dele', async () => {
    const { testDb } = world;
    const victim = await throwawayOwner();
    const beforeVictim = await rowsOf(victim.ownerId);
    const beforeA = await rowsOf(world.a.ownerId);
    const beforeB = await rowsOf(world.b.ownerId);
    expect(beforeVictim.ProfileRevision).toBeGreaterThan(0);
    expect(Object.values(beforeVictim).filter((n) => n > 0).length).toBeGreaterThan(10);

    // 1) SQL cru sem flag: falha por causa da ProfileRevision na cascata; atomico.
    await expect(
      testDb.sql(`DELETE FROM "User" WHERE id = ${lit(victim.ownerId)}`),
    ).rejects.toThrow(IMMUTABLE);
    expect(await rowsOf(victim.ownerId)).toEqual(beforeVictim);
    expect(
      (await testDb.sql(`SELECT 1 FROM "User" WHERE id = $1`, [victim.ownerId])).rowCount,
    ).toBe(1);

    // 2) Pelo cliente Prisma global (unico caminho da aplicacao hoje): tambem falha.
    // A aplicacao so exclui conta por `db.purgeAccount` (S2.3a, packages/db/src/account/purge.ts), que
    // liga a flag de purge dentro da propria transacao; o delete direto continua barrado.
    await expect(testDb.db.global.user.delete({ where: { id: victim.ownerId } })).rejects.toThrow(
      IMMUTABLE,
    );
    expect(await rowsOf(victim.ownerId)).toEqual(beforeVictim);

    // 3) Com a flag, na mesma transacao: o dono some por completo (FKs em cascata).
    await testDb.sql(
      `SET LOCAL chameleon.allow_purge = 'on'; DELETE FROM "User" WHERE id = ${lit(victim.ownerId)}`,
    );
    const afterVictim = await rowsOf(victim.ownerId);
    expect(
      Object.values(afterVictim).every((n) => n === 0),
      JSON.stringify(afterVictim),
    ).toBe(true);
    expect(Object.keys(afterVictim).sort()).toEqual([...PRIVATE_MODELS].sort());
    expect(
      (await testDb.sql(`SELECT 1 FROM "User" WHERE id = $1`, [victim.ownerId])).rowCount,
    ).toBe(0);

    // 4) Os demais donos nao perderam uma unica linha.
    expect(await rowsOf(world.a.ownerId)).toEqual(beforeA);
    expect(await rowsOf(world.b.ownerId)).toEqual(beforeB);
  });
});
