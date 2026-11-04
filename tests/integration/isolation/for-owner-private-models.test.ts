import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listColumns, listForeignKeys, quote, type ForeignKey } from './support/catalog';
import { assertLogsClean } from './support/logs';
import {
  OwnerScopeViolationError,
  PRIVATE_MODELS,
  UnscopedAccessError,
  type PrivateModelName,
} from './support/workspace';
import { createWorld, delegateName, type World } from './support/world';

/**
 * ADR-0008 item 2 + 5(a): `forOwner` em TODOS os modelos privados do registro (`PRIVATE_MODELS`, que
 * e checado contra o schema por packages/db/test/private-models.test.ts). Um bloco por modelo,
 * gerado em tempo de execucao: um modelo novo no registro ganha estes testes sem editar este arquivo
 * (e, sem linhas nas fixtures, falha no guard de cobertura de dados).
 *
 * "Vitima" X = o dono com mais linhas do modelo; "invasor" = outro dono, escopado por forOwner.
 */
let world: World;
let foreignKeys: ForeignKey[];
beforeAll(async () => {
  world = await createWorld();
  foreignKeys = await listForeignKeys(world.testDb);
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

type Delegate = Record<string, (args?: unknown) => Promise<unknown>>;
const delegateOf = (client: unknown, model: string): Delegate =>
  (client as Record<string, Delegate>)[delegateName(model)]!;

interface Victim {
  ownerId: string;
  rowId: string;
  row: Record<string, unknown>;
  rowCount: number;
}

async function pickVictim(model: PrivateModelName): Promise<Victim | null> {
  const { rows } = await world.testDb.sql<{ owner: string; n: string }>(
    `SELECT "ownerId"::text AS owner, count(*) AS n FROM ${quote(model)} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 1`,
  );
  const top = rows[0];
  if (!top) return null;
  const one = await world.testDb.sql<{ row: Record<string, unknown> }>(
    `SELECT to_jsonb(t) AS row FROM ${quote(model)} t WHERE t."ownerId" = $1::uuid ORDER BY t."id" LIMIT 1`,
    [top.owner],
  );
  const row = one.rows[0]?.row;
  if (!row) return null;
  return { ownerId: top.owner, rowId: String(row.id), row, rowCount: Number(top.n) };
}

/** Um dono diferente da vitima: o invasor. */
const attackerFor = (victim: Victim) =>
  world.all.find((actor) => actor.ownerId !== victim.ownerId) ?? world.a;

/** Dados validos (para o Prisma) de um campo escalar qualquer do modelo, so para tentar um UPDATE. */
async function writableData(model: PrivateModelName): Promise<Record<string, unknown> | null> {
  const fkColumns = new Set(
    foreignKeys.filter((fk) => fk.table === model).flatMap((fk) => fk.columns),
  );
  for (const column of await listColumns(world.testDb, model)) {
    if (['id', 'ownerId'].includes(column.name) || fkColumns.has(column.name)) continue;
    switch (column.dataType) {
      case 'text':
      case 'character varying':
        return { [column.name]: 'tentativa-de-escrita' };
      case 'integer':
        return { [column.name]: 1 };
      case 'boolean':
        return { [column.name]: true };
      case 'timestamp with time zone':
        return { [column.name]: new Date(0) };
      case 'jsonb':
        return { [column.name]: {} };
      case 'USER-DEFINED': {
        const { rows } = await world.testDb.sql<{ enumlabel: string }>(
          `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`,
          [column.udtName],
        );
        if (rows[0]) return { [column.name]: rows[0].enumlabel };
        break;
      }
      default:
        break;
    }
  }
  return null;
}

const rowOf = async (model: string, id: string): Promise<unknown> =>
  (
    await world.testDb.sql(
      `SELECT to_jsonb(t) AS row FROM ${quote(model)} t WHERE t."id" = $1::uuid`,
      [id],
    )
  ).rows[0];

const countOf = async (model: string): Promise<number> =>
  Number(
    (
      (await world.testDb.sql<{ n: string }>(`SELECT count(*) AS n FROM ${quote(model)}`))
        .rows[0] ?? { n: '-1' }
    ).n,
  );

describe('guard: o registro de modelos privados e os dados das fixtures', () => {
  it('o registro tem os modelos esperados e TODO modelo privado tem linhas no mundo de teste', async () => {
    expect(PRIVATE_MODELS.length).toBeGreaterThanOrEqual(30);
    const empty: string[] = [];
    for (const model of PRIVATE_MODELS) if ((await countOf(model)) === 0) empty.push(model);
    expect(empty, 'modelos privados sem nenhuma linha (adicione dados ao mundo de teste)').toEqual(
      [],
    );
  });

  it('forOwner exige UUID e o cliente sem escopo nao le nem escreve modelo privado algum', async () => {
    expect(() => world.testDb.db.forOwner('nao-e-uuid')).toThrow(OwnerScopeViolationError);
    expect(() => world.testDb.db.forOwner('')).toThrow(OwnerScopeViolationError);
    for (const model of PRIVATE_MODELS) {
      const global = delegateOf(world.testDb.db.global, model);
      await expect(global.findMany!(), model).rejects.toBeInstanceOf(UnscopedAccessError);
      await expect(global.count!(), model).rejects.toBeInstanceOf(UnscopedAccessError);
      await expect(global.deleteMany!({ where: {} }), model).rejects.toBeInstanceOf(
        UnscopedAccessError,
      );
    }
  });
});

describe.each([...PRIVATE_MODELS])('forOwner em %s', (model) => {
  it('leitura: o invasor nunca ve linhas da vitima (lista, findFirst, findUnique, count)', async () => {
    const victim = await pickVictim(model);
    expect(victim, `${model}: sem linhas`).not.toBeNull();
    const v = victim!;
    const attacker = attackerFor(v);
    const scoped = world.testDb.db.forOwner(attacker.ownerId);
    const d = delegateOf(scoped, model);

    // controle positivo: a vitima enxerga as proprias linhas (todas), entao "vazio" nao e artefato.
    const own = (await delegateOf(world.testDb.db.forOwner(v.ownerId), model).findMany!()) as {
      ownerId: string;
    }[];
    expect(own).toHaveLength(v.rowCount);
    // controle negativo do proprio teste: sem escopo (unsafeRaw) a linha da vitima e visivel.
    const unscoped = delegateOf(world.testDb.db.unsafeRaw, model);
    expect(await unscoped.findFirst!({ where: { id: v.rowId } })).not.toBeNull();

    const listed = (await d.findMany!()) as { ownerId: string; id: string }[];
    expect(listed.every((row) => row.ownerId === attacker.ownerId)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(v.rowId);
    expect(await d.findFirst!({ where: { id: v.rowId } })).toBeNull();
    expect(await d.findUnique!({ where: { id: v.rowId } })).toBeNull();
    expect(await d.count!({ where: { id: v.rowId } })).toBe(0);
    expect(await d.findFirst!({ where: { id: { in: [v.rowId] } } })).toBeNull();
    await expect(d.findFirstOrThrow!({ where: { id: v.rowId } })).rejects.toMatchObject({
      code: 'P2025',
    });
  });

  it('leitura com ownerId alheio no filtro e REJEITADA (nunca retorna a linha)', async () => {
    const v = (await pickVictim(model))!;
    const d = delegateOf(world.testDb.db.forOwner(attackerFor(v).ownerId), model);
    for (const op of ['findMany', 'findFirst', 'count', 'deleteMany'] as const) {
      await expect(
        d[op]!({ where: { ownerId: v.ownerId } }),
        `${model}.${op}`,
      ).rejects.toBeInstanceOf(OwnerScopeViolationError);
    }
    await expect(
      d.findUnique!({ where: { id: v.rowId, ownerId: v.ownerId } }),
    ).rejects.toBeInstanceOf(OwnerScopeViolationError);
  });

  it('escrita: update/updateMany/delete/deleteMany de linha alheia nao tem efeito (nem erro com dado alheio)', async () => {
    const v = (await pickVictim(model))!;
    const attacker = attackerFor(v);
    const d = delegateOf(world.testDb.db.forOwner(attacker.ownerId), model);
    const before = await rowOf(model, v.rowId);
    expect(before).toBeTruthy();
    const totalBefore = await countOf(model);

    const data = await writableData(model);
    expect(data, `${model}: sem coluna escalar para testar UPDATE`).not.toBeNull();
    const result = (await d.updateMany!({ where: { id: v.rowId }, data })) as { count: number };
    expect(result.count).toBe(0);
    await expect(d.update!({ where: { id: v.rowId }, data })).rejects.toMatchObject({
      code: 'P2025',
    });
    expect(((await d.deleteMany!({ where: { id: v.rowId } })) as { count: number }).count).toBe(0);
    await expect(d.delete!({ where: { id: v.rowId } })).rejects.toMatchObject({ code: 'P2025' });

    expect(await rowOf(model, v.rowId)).toEqual(before);
    expect(await countOf(model)).toBe(totalBefore);
  });

  it('ownerId e imutavel e nao pode ser informado como relacao: update/upsert que o alteram sao rejeitados', async () => {
    const v = (await pickVictim(model))!;
    const attacker = attackerFor(v);
    const d = delegateOf(world.testDb.db.forOwner(attacker.ownerId), model);
    const before = await rowOf(model, v.rowId);
    // tenta "roubar" a linha da vitima mudando o dono, e "doar" uma linha propria
    await expect(
      d.updateMany!({ where: { id: v.rowId }, data: { ownerId: attacker.ownerId } }),
    ).rejects.toBeInstanceOf(OwnerScopeViolationError);
    await expect(
      d.update!({ where: { id: v.rowId }, data: { ownerId: attacker.ownerId } }),
    ).rejects.toBeInstanceOf(OwnerScopeViolationError);
    await expect(
      d.upsert!({
        where: { id: v.rowId },
        update: { ownerId: v.ownerId },
        create: { ownerId: attacker.ownerId },
      }),
    ).rejects.toBeInstanceOf(OwnerScopeViolationError);
    expect(await rowOf(model, v.rowId)).toEqual(before);
  });

  it('criacao com ownerId alheio e rejeitada (create, createMany, createManyAndReturn, upsert, relacao owner)', async () => {
    const v = (await pickVictim(model))!;
    const attacker = attackerFor(v);
    const d = delegateOf(world.testDb.db.forOwner(attacker.ownerId), model);
    const totalBefore = await countOf(model);
    const foreignData = { ownerId: v.ownerId };
    const cases: [string, () => Promise<unknown>][] = [
      ['create', () => d.create!({ data: foreignData })],
      ['createMany', () => d.createMany!({ data: [foreignData] })],
      ['createManyAndReturn', () => d.createManyAndReturn!({ data: [foreignData] })],
      [
        'createMany misto',
        () => d.createMany!({ data: [{ ownerId: attacker.ownerId }, foreignData] }),
      ],
      ['upsert', () => d.upsert!({ where: { id: v.rowId }, update: {}, create: foreignData })],
      [
        'create com relacao owner',
        () => d.create!({ data: { owner: { connect: { id: v.ownerId } } } }),
      ],
    ];
    for (const [name, run] of cases) {
      await expect(run(), `${model}.${name}`).rejects.toBeInstanceOf(OwnerScopeViolationError);
    }
    expect(await countOf(model)).toBe(totalBefore);
  });
});
