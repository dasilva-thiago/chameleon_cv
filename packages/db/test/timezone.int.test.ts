import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../src/testing';

/**
 * Fuso: o que o Prisma grava precisa coincidir com SQL cru, now() e @default(now()), e o app deve
 * funcionar em UTC mesmo que o cluster use outro TimeZone (ex.: America/Sao_Paulo).
 */
let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.drop();
});

describe('fuso das conexoes', () => {
  it('conexao do harness (SQL cru) e do app (Prisma) usam UTC', async () => {
    const raw = await testDb.sql<{ timezone: string }>(
      "SELECT current_setting('timezone') AS timezone",
    );
    expect(raw.rows[0]?.timezone).toBe('UTC');
    const viaPrisma = await testDb.db.unsafeRaw.$queryRawUnsafe<{ timezone: string }[]>(
      "SELECT current_setting('timezone') AS timezone",
    );
    expect(viaPrisma[0]?.timezone).toBe('UTC');
  });

  it('o banco clonado tem timezone=UTC por padrao (independe do cluster)', async () => {
    const { rows } = await testDb.sql<{ setting: string }>(
      `SELECT coalesce((SELECT split_part(s, '=', 2) FROM pg_db_role_setting r, unnest(r.setconfig) s
                          WHERE r.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
                            AND s LIKE 'TimeZone=%' LIMIT 1), 'nao-definido') AS setting`,
    );
    expect(rows[0]?.setting).toBe('UTC');
  });
});

describe('DateTime gravado pelo Prisma coincide com SQL cru', () => {
  it('12:00Z via Prisma = 12:00Z em SQL cru (timestamptz)', async () => {
    const user = await testDb.db.global.user.create({
      data: { email: `tz-${randomUUID().slice(0, 8)}@example.test` },
    });
    const instant = new Date('2026-01-15T12:00:00.000Z');
    const record = await testDb.db.forOwner(user.id).consentRecord.create({
      data: {
        ownerId: user.id,
        purpose: 'profile_processing',
        granted: true,
        policyVersion: 'v1',
        recordedAt: instant,
      },
    });
    expect(record.recordedAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');

    const { rows } = await testDb.sql<{ utc: string; epoch: string }>(
      `SELECT to_char("recordedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS utc,
              extract(epoch FROM "recordedAt")::text AS epoch
         FROM "ConsentRecord" WHERE "id" = $1`,
      [record.id],
    );
    expect(rows[0]?.utc).toBe('2026-01-15T12:00:00');
    expect(Number(rows[0]?.epoch)).toBe(instant.getTime() / 1000);
  });

  it('SQL cru em fuso de Sao Paulo grava o mesmo instante que o Prisma em UTC', async () => {
    const user = await testDb.db.global.user.create({
      data: { email: `tz-${randomUUID().slice(0, 8)}@example.test` },
    });
    const id = randomUUID();
    await testDb.sql(
      `INSERT INTO "ConsentRecord" ("id", "ownerId", "purpose", "granted", "policyVersion", "recordedAt")
         VALUES ($1, $2, 'profile_processing', true, 'v1', '2026-01-15 09:00:00-03')`,
      [id, user.id],
    );
    const row = await testDb.db.forOwner(user.id).consentRecord.findFirst({ where: { id } });
    expect(row?.recordedAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('now() / @default(now()) do banco concordam com o relogio do app (UTC)', async () => {
    const user = await testDb.db.global.user.create({
      data: { email: `tz-${randomUUID().slice(0, 8)}@example.test` },
    });
    const before = Date.now();
    const created = await testDb.db.forOwner(user.id).consentRecord.create({
      data: { ownerId: user.id, purpose: 'profile_processing', granted: true, policyVersion: 'v1' },
    });
    const after = Date.now();
    const defaulted = created.recordedAt.getTime();
    // tolerancia de relogio entre processo e servidor local: 5 s (nunca horas)
    expect(defaulted).toBeGreaterThan(before - 5_000);
    expect(defaulted).toBeLessThan(after + 5_000);

    const { rows } = await testDb.sql<{ diff: string }>(
      `SELECT abs(extract(epoch FROM now()) * 1000 - $1::float8)::text AS diff`,
      [Date.now()],
    );
    expect(Number(rows[0]?.diff)).toBeLessThan(5_000);
  });

  it('colunas @db.Date: 1o dia do periodo em UTC e sem deslocamento de dia', async () => {
    const user = await testDb.db.global.user.create({
      data: { email: `tz-${randomUUID().slice(0, 8)}@example.test` },
    });
    const profileId = randomUUID();
    const factId = randomUUID();
    const scoped = testDb.db.forOwner(user.id);
    await scoped.professionalProfile.create({
      data: { id: profileId, ownerId: user.id, schemaVersion: '2.1.0' },
    });
    await testDb
      .sql(
        `INSERT INTO "ProfileFact" ("id", "ownerId", "profileId", "kind", "updatedAt") VALUES ($1, $2, $3, 'education', now());
       INSERT INTO "Education" ("id", "ownerId", "startDate", "startPrecision") VALUES ($1, $2, '2004-01-01', 'year');`,
        [factId, user.id, profileId],
      )
      .catch(async () => {
        // statements multiplos nao aceitam parametros: refaz sem eles
        await testDb.sql(
          `INSERT INTO "ProfileFact" ("id", "ownerId", "profileId", "kind", "updatedAt") VALUES ('${factId}', '${user.id}', '${profileId}', 'education', now());
         INSERT INTO "Education" ("id", "ownerId", "startDate", "startPrecision") VALUES ('${factId}', '${user.id}', '2004-01-01', 'year');`,
        );
      });
    const row = await scoped.education.findFirst({ where: { id: factId } });
    expect(row?.startDate?.toISOString()).toBe('2004-01-01T00:00:00.000Z');
  });
});
