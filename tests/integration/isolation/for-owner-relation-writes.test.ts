import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listForeignKeys, quote, type ForeignKey } from './support/catalog';
import { assertLogsClean } from './support/logs';
import { createWorld, delegateName, type World } from './support/world';

/**
 * Escritas por RELACAO (`data: { profile: { connect: ... } }`) em `forOwner`. O README do db afirma
 * que "conectar a linha de outro dono falha no banco" (FK composta), mas em tabelas cuja unica FK
 * privada e `(profileId, ownerId)` o Prisma troca AS DUAS colunas: a linha de B muda de dono e passa
 * a pertencer ao perfil de A (nenhuma FK e violada). `assertDataKeepsOwner` so olha `data.ownerId` e
 * `data.owner`. Este teste GERA um caso por tabela com FK `(profileId, ownerId)` -> ProfessionalProfile.
 *
 * Invariante: depois de qualquer escrita de B, nenhuma linha de B pode ter mudado de dono e A nao pode
 * ter ganhado linhas.
 */
let world: World;
let profileFks: ForeignKey[];
beforeAll(async () => {
  world = await createWorld();
  profileFks = (await listForeignKeys(world.testDb)).filter(
    (fk) =>
      fk.refTable === 'ProfessionalProfile' &&
      fk.columns.length === 2 &&
      fk.columns[0] === 'profileId' &&
      fk.columns[1] === 'ownerId',
  );
}, 120_000);
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

it('guard: o catalogo tem tabelas com FK (profileId, ownerId) para o perfil', () => {
  expect(profileFks.length).toBeGreaterThanOrEqual(7);
});

describe('forOwner(B): update por relacao (connect) para o perfil de A nao pode transferir a linha', () => {
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
      await delegate
        .update({ where: { id: row.id }, data: { profile: { connect: { id: a.profileId } } } })
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
