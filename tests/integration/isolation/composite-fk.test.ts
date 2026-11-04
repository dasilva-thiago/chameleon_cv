import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  listForeignKeys,
  listTables,
  listTablesWithColumn,
  listUniqueKeys,
  quote,
  type ForeignKey,
} from './support/catalog';
import { assertLogsClean } from './support/logs';
import { lit, probe, type PgFailure } from './support/sql';
import { PRIVATE_MODELS } from './support/workspace';
import { createWorld, type World } from './support/world';

/**
 * ADR-0008 item 5(d): FK composta (xId, ownerId). Tudo aqui e GERADO a partir do catalogo do
 * PostgreSQL (pg_constraint / information_schema), entao tabelas e FKs futuras sao cobertas sem
 * editar este arquivo: um modelo novo com FK nao composta, ou sem dados nas fixtures para exercitar
 * uma FK, faz o teste falhar.
 */
const OWNER = 'ownerId';

let world: World;
let foreignKeys: ForeignKey[];
let privateTables: Set<string>;
beforeAll(async () => {
  world = await createWorld();
  foreignKeys = await listForeignKeys(world.testDb);
  privateTables = new Set(await listTablesWithColumn(world.testDb, OWNER));
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

const privateFks = (): ForeignKey[] =>
  foreignKeys.filter((fk) => privateTables.has(fk.refTable) && privateTables.has(fk.table));

describe('catalogo: o schema respeita o desenho de isolamento', () => {
  it('toda tabela com ownerId esta em PRIVATE_MODELS e vice-versa (sem tabela esquecida)', async () => {
    expect([...privateTables].sort()).toEqual([...PRIVATE_MODELS].sort());
    const all = await listTables(world.testDb);
    expect(all.filter((table) => !privateTables.has(table)).sort()).toEqual(['Invite', 'User']);
  });

  it('toda tabela privada tem UNIQUE (id, ownerId)', async () => {
    const uniques = await listUniqueKeys(world.testDb);
    for (const table of PRIVATE_MODELS) {
      const ok = uniques.some(
        (u) =>
          u.table === table &&
          u.columns.length === 2 &&
          u.columns.includes('id') &&
          u.columns.includes(OWNER),
      );
      expect(ok, `${table} sem UNIQUE(id, ownerId)`).toBe(true);
    }
  });

  it('toda FK entre tabelas privadas e composta e inclui ownerId nos dois lados, na mesma posicao', () => {
    const fks = privateFks();
    expect(fks.length).toBeGreaterThan(40); // guarda contra catalogo vazio
    for (const fk of fks) {
      expect(fk.columns, `${fk.name}: colunas`).toContain(OWNER);
      expect(fk.refColumns, `${fk.name}: colunas referenciadas`).toContain(OWNER);
      expect(fk.columns.indexOf(OWNER), fk.name).toBe(fk.refColumns.indexOf(OWNER));
      expect(fk.columns.length, fk.name).toBeGreaterThanOrEqual(2);
    }
  });

  it('nenhuma FK privada usa SET NULL / SET DEFAULT (anularia o ownerId)', () => {
    for (const fk of privateFks()) {
      expect(['n', 'd'], `${fk.name} (ON DELETE)`).not.toContain(fk.onDelete);
    }
  });

  it('FKs de tabelas privadas para fora do dominio privado so apontam para User(id), em cascata', () => {
    const outward = foreignKeys.filter(
      (fk) => privateTables.has(fk.table) && !privateTables.has(fk.refTable),
    );
    expect(outward.length).toBeGreaterThan(0);
    for (const fk of outward) {
      expect(fk.refTable, fk.name).toBe('User');
      expect(fk.columns, fk.name).toEqual([OWNER]);
      expect(fk.onDelete, `${fk.name} deve apagar com a conta`).toBe('c');
    }
  });
});

type Mode = 'update' | 'insert';

interface Attempt {
  failure: PgFailure | null;
  exercised: boolean;
  why?: string;
}

/**
 * Tenta violar `fk`: pega uma linha filha de um dono e aponta a FK para uma linha-pai de OUTRO dono.
 * `update` reaponta a linha existente; `insert` insere uma COPIA da linha com a FK trocada. Roda numa
 * transacao sempre desfeita (`probe`), com os gatilhos de USUARIO desligados na tabela filha
 * (coerencia ProfileFact.kind etc.) para provar que e a FK composta quem barra; os gatilhos
 * internos das FKs continuam ativos.
 */
async function crossOwnerAttempt(
  fk: ForeignKey,
  mode: Mode,
  preamble: string[] = [],
): Promise<Attempt> {
  const fkCols = fk.columns.filter((c) => c !== OWNER);
  const refCols = fk.refColumns.filter((c) => c !== OWNER);
  const notNull = fkCols.map((c) => `c.${quote(c)} IS NOT NULL`).join(' AND ');
  const children = await world.testDb.sql<{ ctid: string; owner: string }>(
    `SELECT c.ctid::text AS ctid, c."ownerId"::text AS owner FROM ${quote(fk.table)} c
      WHERE ${notNull} LIMIT 50`,
  );
  if (children.rows.length === 0)
    return { failure: null, exercised: false, why: 'sem linha filha' };

  let inconclusive: PgFailure | null = null;
  let tried = 0;
  for (const child of children.rows.slice(0, 5)) {
    // FK sobre a propria PK (PK compartilhada): o pai escolhido nao pode ter linha filha ainda.
    const avoid = fkCols.includes('id')
      ? ` AND NOT EXISTS (SELECT 1 FROM ${quote(fk.table)} x WHERE x."id" = p."id")`
      : '';
    const parents = await world.testDb.sql<Record<string, string>>(
      `SELECT ${refCols.map((c, i) => `p.${quote(c)}::text AS v${i}`).join(', ')}
         FROM ${quote(fk.refTable)} p WHERE p."ownerId" <> ${lit(child.owner)}::uuid${avoid} LIMIT 30`,
    );
    for (const foreign of parents.rows) {
      const values = refCols.map((_, i) => String(foreign[`v${i}`]));
      const disable = `ALTER TABLE ${quote(fk.table)} DISABLE TRIGGER USER`;
      let statement: string;
      if (mode === 'update') {
        const sets = fkCols.map((c, i) => `${quote(c)} = ${lit(values[i]!)}::uuid`);
        statement = `UPDATE ${quote(fk.table)} SET ${sets.join(', ')} WHERE ctid = ${lit(child.ctid)}::tid`;
      } else {
        const overrides: Record<string, string> = {};
        fkCols.forEach((c, i) => (overrides[c] = values[i]!));
        if (!fkCols.includes('id')) overrides.id = randomUUID();
        statement = `INSERT INTO ${quote(fk.table)}
          SELECT (jsonb_populate_record(NULL::${quote(fk.table)}, to_jsonb(c) || ${lit(JSON.stringify(overrides))}::jsonb)).*
            FROM ${quote(fk.table)} c WHERE c.ctid = ${lit(child.ctid)}::tid`;
      }
      tried += 1;
      const failure = await probe(world.testDb, [disable, ...preamble, statement]);
      // Conclusivo: aceito (defeito) ou barrado pela FK. Outro erro (ex.: unicidade da copia) e
      // inconclusivo: tenta outro pai/filho.
      if (failure === null || failure.code === '23503') return { failure, exercised: true };
      inconclusive = failure;
    }
  }
  if (tried === 0) return { failure: null, exercised: false, why: 'sem linha-pai de outro dono' };
  return { failure: inconclusive, exercised: true };
}

describe('FK composta no schema real: apontar para linha de OUTRO dono falha no banco', () => {
  it('UPDATE: toda FK composta entre tabelas privadas rejeita a linha-pai de outro dono (23503, mesma constraint)', async () => {
    const fks = privateFks();
    const unexercised: string[] = [];
    const wrong: string[] = [];
    let rejected = 0;
    for (const fk of fks) {
      const attempt = await crossOwnerAttempt(fk, 'update');
      if (!attempt.exercised) {
        unexercised.push(`${fk.table}.${fk.name} (${attempt.why})`);
        continue;
      }
      if (attempt.failure?.code === '23503' && attempt.failure.constraint === fk.name)
        rejected += 1;
      else wrong.push(`${fk.table}.${fk.name}: ${JSON.stringify(attempt.failure)}`);
    }
    expect(wrong, 'FKs que NAO barraram a referencia cruzada').toEqual([]);
    // Cobertura: toda FK privada precisa ter sido exercitada com dados reais das fixtures.
    expect(unexercised, 'FKs sem dados nas fixtures para exercitar').toEqual([]);
    expect(rejected).toBe(fks.length);
  }, 120_000);

  it('INSERT: copia da linha com a FK apontando para outro dono nunca e aceita', async () => {
    const fks = privateFks();
    const accepted: string[] = [];
    const unexercised: string[] = [];
    const other: string[] = [];
    let byFk = 0;
    for (const fk of fks) {
      const attempt = await crossOwnerAttempt(fk, 'insert');
      if (!attempt.exercised) unexercised.push(`${fk.table}.${fk.name}`);
      else if (attempt.failure === null) accepted.push(`${fk.table}.${fk.name}`);
      else if (attempt.failure.code === '23503') byFk += 1;
      else
        other.push(
          `${fk.table}.${fk.name}: ${attempt.failure.code} ${attempt.failure.constraint ?? ''}`,
        );
    }
    expect(accepted, 'INSERT cruzado ACEITO pelo banco').toEqual([]);
    expect(unexercised).toEqual([]);
    // Inconclusivos (a copia bateu antes numa unicidade, 23505): cobertos pelo teste de UPDATE acima.
    expect(
      other.filter((line) => !line.includes(': 23505 ')),
      'erro inesperado no INSERT cruzado',
    ).toEqual([]);
    expect(byFk + other.length).toBe(fks.length);
    expect(byFk, 'quase todas as FKs devem ser provadas tambem por INSERT').toBeGreaterThan(
      fks.length - 4,
    );
  }, 120_000);

  it('autoteste do detector: sem a FK composta, a referencia cruzada e ACEITA (o teste nao e vacuo)', async () => {
    for (const fk of privateFks().slice(0, 6)) {
      const drop = `ALTER TABLE ${quote(fk.table)} DROP CONSTRAINT ${quote(fk.name)}`;
      const attempt = await crossOwnerAttempt(fk, 'update', [drop]);
      expect(attempt.exercised, fk.name).toBe(true);
      expect(attempt.failure, `${fk.name}: sem a FK o UPDATE cruzado deveria passar`).toBeNull();
    }
    // e o banco real continua intacto (o probe sempre desfaz)
    const after = await listForeignKeys(world.testDb);
    expect(after.map((fk) => fk.name)).toEqual(foreignKeys.map((fk) => fk.name));
  }, 60_000);
});
