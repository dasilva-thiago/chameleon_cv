import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIVATE_MODELS } from '../src/private-models';
import { createProfileStore } from '../src/profile-store';
import { createTestDb, type TestDb } from '../src/testing';
import { fixtureDocument } from './support/profile-docs';
import { testSnapshot } from './support/snapshot';

/**
 * Trigger `<Tabela>_owner_immutable` (migracao `owner_immutable`): NENHUM UPDATE muda "ownerId", nem
 * por SQL cru. A lista de tabelas vem do catalogo, entao tabela futura (ex.: S3.0) sem o trigger
 * derruba o teste de catalogo.
 */
let testDb: TestDb;
let a: string;
let b: string;
const q = (name: string): string => `"${name.replaceAll('"', '""')}"`;

beforeAll(async () => {
  testDb = await createTestDb();
  const store = createProfileStore(testDb.db, { snapshot: testSnapshot });
  const mk = async (label: string): Promise<string> => {
    const user = await testDb.db.global.user.create({
      data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test`, displayName: label },
    });
    await store.saveProfileDocument(
      user.id,
      fixtureDocument('experienced-promotions-same-employer'),
    );
    // Linhas das tabelas de identidade/historico que o perfil nao cria sozinho.
    const scoped = testDb.db.forOwner(user.id);
    await scoped.consentRecord.create({
      data: { ownerId: user.id, purpose: 'profile_processing', granted: true, policyVersion: '1' },
    });
    await scoped.auditEvent.create({
      data: { ownerId: user.id, action: 'test.event', entityType: 'profile' },
    });
    await scoped.session.create({
      data: {
        ownerId: user.id,
        tokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() + 2 * 86_400_000),
      },
    });
    await testDb.sql(
      `INSERT INTO "Credential" (id, "ownerId", kind, "passwordHash", "updatedAt")
         VALUES ($1, $2, 'password', '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaA', now())`,
      [randomUUID(), user.id],
    );
    return user.id;
  };
  a = await mk('a');
  b = await mk('b');
}, 120_000);
afterAll(async () => {
  await testDb.drop();
});

async function tablesWithOwnerId(): Promise<string[]> {
  const { rows } = await testDb.sql<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'ownerId' AND NOT a.attisdropped
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
  );
  return rows.map((r) => r.relname);
}

describe('catalogo: toda tabela com "ownerId" tem o trigger de imutabilidade', () => {
  it('as tabelas do catalogo sao exatamente os modelos privados', async () => {
    expect(await tablesWithOwnerId()).toEqual([...PRIVATE_MODELS].sort());
  });

  it('cada uma tem BEFORE UPDATE FOR EACH ROW habilitado chamando chameleon_forbid_owner_change', async () => {
    const tables = await tablesWithOwnerId();
    const { rows } = await testDb.sql<{
      relname: string;
      tgname: string;
      tgenabled: string;
      tgtype: number;
      proname: string;
    }>(
      `SELECT c.relname, t.tgname, t.tgenabled, t.tgtype, p.proname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
          AND p.proname = 'chameleon_forbid_owner_change'`,
    );
    const byTable = new Map(rows.map((r) => [r.relname, r]));
    const missing = tables.filter((t) => !byTable.has(t));
    expect(missing, 'tabelas com "ownerId" SEM trigger owner_immutable').toEqual([]);
    for (const table of tables) {
      const trigger = byTable.get(table)!;
      expect(trigger.tgname).toBe(`${table}_owner_immutable`);
      expect(trigger.tgenabled).toBe('O'); // habilitado
      expect(trigger.tgtype & 1, 'FOR EACH ROW').toBe(1);
      expect(trigger.tgtype & 2, 'BEFORE').toBe(2);
      expect(trigger.tgtype & 16, 'UPDATE').toBe(16);
      expect(trigger.tgtype & (4 | 8), 'nem INSERT nem DELETE').toBe(0);
    }
  });

  it('chameleon_install_owner_immutable_triggers cobre tabela nova e e idempotente', async () => {
    const table = `ZzFuture_${randomUUID().slice(0, 6)}`;
    await testDb.sql(`CREATE TABLE ${q(table)} (id uuid PRIMARY KEY, "ownerId" uuid NOT NULL)`);
    const { rows: installed } = await testDb.sql<{
      chameleon_install_owner_immutable_triggers: string;
    }>('SELECT chameleon_install_owner_immutable_triggers()');
    expect(installed.map((r) => r.chameleon_install_owner_immutable_triggers)).toContain(table);
    await testDb.sql('SELECT chameleon_install_owner_immutable_triggers()'); // idempotente
    const id = randomUUID();
    await testDb.sql(`INSERT INTO ${q(table)} VALUES ($1, $2)`, [id, a]);
    await expect(
      testDb.sql(`UPDATE ${q(table)} SET "ownerId" = $1 WHERE id = $2`, [b, id]),
    ).rejects.toThrow(/owner_immutable/);
    await testDb.sql(`DROP TABLE ${q(table)}`);
  });
});

describe('UPDATE de "ownerId" por SQL cru e rejeitado em TODAS as tabelas privadas', () => {
  it('cada tabela com linha: a troca falha com owner_immutable e a linha continua do dono', async () => {
    const tables = await tablesWithOwnerId();
    const exercised: string[] = [];
    const empty: string[] = [];
    for (const table of tables) {
      const row = (
        await testDb.sql<{ id: string }>(
          `SELECT id::text FROM ${q(table)} WHERE "ownerId" = $1::uuid LIMIT 1`,
          [a],
        )
      ).rows[0];
      if (!row) {
        empty.push(table);
        continue;
      }
      exercised.push(table);
      await expect(
        testDb.sql(`UPDATE ${q(table)} SET "ownerId" = $1::uuid WHERE id = $2::uuid`, [b, row.id]),
        table,
      ).rejects.toThrow(/owner_immutable/);
      const after = await testDb.sql<{ owner: string }>(
        `SELECT "ownerId"::text AS owner FROM ${q(table)} WHERE id = $1::uuid`,
        [row.id],
      );
      expect(after.rows[0]!.owner, table).toBe(a);
    }
    // Nenhuma tabela pode ficar sem exercicio por falta de dado: o fixture precisa cobrir as que importam.
    expect(exercised.length).toBeGreaterThanOrEqual(20);
    // Tabelas sem linha ficam cobertas pelo teste de catalogo (trigger presente e BEFORE UPDATE ROW).
    expect(empty.length).toBeLessThan(tables.length);
  });

  it('inclui as tabelas cuja unica FK e para User (sem FK composta como segunda rede)', async () => {
    for (const table of [
      'Credential',
      'Session',
      'ConsentRecord',
      'AuditEvent',
      'ProfessionalProfile',
    ]) {
      const row = (
        await testDb.sql<{ id: string }>(
          `SELECT id::text FROM ${q(table)} WHERE "ownerId" = $1::uuid LIMIT 1`,
          [a],
        )
      ).rows[0];
      expect(row, table).toBeDefined();
      if (!row) continue;
      await expect(
        testDb.sql(`UPDATE ${q(table)} SET "ownerId" = $1::uuid WHERE id = $2::uuid`, [b, row.id]),
        table,
      ).rejects.toThrow(/owner_immutable/);
    }
  });

  it('UPDATE em massa que altera "ownerId" falha por inteiro (nenhuma linha muda)', async () => {
    const countByOwner = async (): Promise<string> =>
      JSON.stringify(
        (
          await testDb.sql(
            'SELECT "ownerId"::text AS owner, count(*) AS n FROM "ContactPoint" GROUP BY 1 ORDER BY 1',
          )
        ).rows,
      );
    const before = await countByOwner();
    await expect(testDb.sql('UPDATE "ContactPoint" SET "ownerId" = $1::uuid', [b])).rejects.toThrow(
      /owner_immutable/,
    );
    expect(await countByOwner()).toBe(before);
  });

  it('UPDATE sem mudar o valor de "ownerId" e de outras colunas continua permitido', async () => {
    await testDb.sql(`UPDATE "AuditEvent" SET "ownerId" = "ownerId" WHERE "ownerId" = $1::uuid`, [
      a,
    ]);
    await testDb.sql(
      `UPDATE "ProfessionalProfile" SET "updatedAt" = now() WHERE "ownerId" = $1::uuid`,
      [a],
    );
  });
});

describe('purge: DELETE nao e afetado pelo trigger', () => {
  it('excluir o User remove em cascata os dados do dono, sem flag nem excecao', async () => {
    const victim = randomUUID();
    await testDb.sql(`INSERT INTO "User" (id, email, "updatedAt") VALUES ($1, $2, now())`, [
      victim,
      `purge-${victim.slice(0, 8)}@example.test`,
    ]);
    await testDb.sql(
      `INSERT INTO "AuditEvent" (id, "ownerId", action, "entityType") VALUES ($1, $2, 'x', 'profile')`,
      [randomUUID(), victim],
    );
    await testDb.sql(`DELETE FROM "AuditEvent" WHERE "ownerId" = $1::uuid`, [victim]);
    await testDb.sql(`DELETE FROM "User" WHERE id = $1::uuid`, [victim]);
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "User" WHERE id = $1::uuid`,
      [victim],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});
