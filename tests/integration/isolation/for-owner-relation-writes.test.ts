import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listForeignKeys, quote, type ForeignKey } from './support/catalog';
import { assertLogsClean } from './support/logs';
import { createWorld, delegateName, type World } from './support/world';

/**
 * Escritas por RELACAO (`data: { job: { connect: ... } }`) em `forOwner`. Numa FK composta `(xId, ownerId)`
 * o Prisma troca AS DUAS colunas: sem a defesa da camada de aplicacao, a linha de B mudaria de dono e passaria a
 * apontar para a linha de A (nenhuma FK violada). Este teste GERA um caso por FK composta privada do catalogo.
 *
 * Invariante: depois de qualquer escrita de B, nenhuma linha de B pode ter mudado de dono e A nao pode
 * ter ganhado linhas.
 */
let world: World;
let profileFks: ForeignKey[];
beforeAll(async () => {
  world = await createWorld();
  profileFks = (await listForeignKeys(world.testDb)).filter(
    (fk) => fk.columns.length === 2 && fk.columns[1] === 'ownerId',
  );
}, 120_000);

/** Nome da relacao Prisma da FK: `jobId` -> `job`; `profileRevisionId` -> `revision`. */
const relationOf = (column: string): string =>
  column === 'profileRevisionId' ? 'revision' : column.replace(/Id$/, '');
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

type Delegate = Record<string, (args: unknown) => Promise<unknown>>;

const countOwned = async (table: string, ownerId: string): Promise<number> =>
  Number(
    (
      await world.testDb.sql<{ n: string }>(
        `SELECT count(*) AS n FROM ${quote(table)} WHERE "ownerId" = $1::uuid`,
        [ownerId],
      )
    ).rows[0]?.n,
  );

it('guard: o catalogo tem FKs compostas (xId, ownerId) entre tabelas privadas', () => {
  expect(profileFks.length).toBeGreaterThanOrEqual(5);
});

describe('forOwner(B): update por relacao (connect) para uma linha de A nao pode transferir a linha', () => {
  it('nenhuma tabela troca o dono da linha de B nem entrega linha ao perfil de A', async () => {
    const { a, b, testDb } = world;
    const scoped = testDb.db.forOwner(b.ownerId) as unknown as Record<string, Delegate>;
    const moved: string[] = [];
    let attempted = 0;

    for (const fk of profileFks) {
      const row = (
        await testDb.sql<{ id: string }>(
          `SELECT id::text FROM ${quote(fk.table)} WHERE "ownerId" = $1::uuid LIMIT 1`,
          [b.ownerId],
        )
      ).rows[0];
      if (!row) continue;
      attempted += 1;
      const aBefore = await countOwned(fk.table, a.ownerId);
      const bBefore = await countOwned(fk.table, b.ownerId);

      const delegate = scoped[delegateName(fk.table)];
      if (!delegate?.update) throw new Error(`delegate ausente: ${fk.table}`);
      const target = (
        await testDb.sql<{ id: string }>(
          `SELECT id::text FROM ${quote(fk.refTable)} WHERE "ownerId" = $1::uuid LIMIT 1`,
          [a.ownerId],
        )
      ).rows[0];
      if (!target) throw new Error(`A sem linha em ${fk.refTable}`);
      await delegate
        .update({
          where: { id: row.id },
          data: { [relationOf(fk.columns[0] ?? '')]: { connect: { id: target.id } } },
        })
        .catch(() => undefined); // rejeitar (erro) e o comportamento desejado

      const owner = (
        await testDb.sql<{ owner: string | null }>(
          `SELECT "ownerId"::text AS owner FROM ${quote(fk.table)} WHERE id = $1::uuid`,
          [row.id],
        )
      ).rows[0]?.owner;
      if (owner !== b.ownerId) moved.push(`${fk.table} (linha ${row.id} agora de ${owner})`);
      if ((await countOwned(fk.table, a.ownerId)) !== aBefore) {
        expect(moved.some((m) => m.startsWith(fk.table))).toBe(true);
      }
      expect(
        (await countOwned(fk.table, b.ownerId)) + (await countOwned(fk.table, a.ownerId)),
      ).toBe(aBefore + bBefore);
    }
    expect(attempted).toBeGreaterThanOrEqual(5);
    expect(moved, 'linhas de B transferidas para o dono A via connect').toEqual([]);
  });
});
