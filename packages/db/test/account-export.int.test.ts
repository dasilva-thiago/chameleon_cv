import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_EXPORT_REGISTRY,
  AccountNotFoundError,
  EXPORT_SECTIONS,
  exportAccountData,
  OwnerScopeViolationError,
  unclassifiedModels,
  type AccountExport,
  type ExportClassification,
} from '../src';
import { createTestDb, type TestDb } from '../src/testing';
import { seedOwner, type SeededOwner } from './support/account-seed';

/**
 * Account export (S2.3a, ADR-0014): everything the owner is entitled to, as plain JSON, nothing of
 * another owner and no secrets; every table is classified (included or excluded with a reason).
 */
let testDb: TestDb;
let a: SeededOwner;
let b: SeededOwner;
let exportA: AccountExport;

const run = (ownerId: string): Promise<AccountExport> => exportAccountData(testDb.db, ownerId);

beforeAll(async () => {
  testDb = await createTestDb();
}, 120_000);
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll();
  a = await seedOwner(testDb, 'export-a');
  b = await seedOwner(testDb, 'export-b');
  exportA = await run(a.ownerId);
});

describe('exportAccountData: content', () => {
  it("contains the owner's professional base, its revisions, jobs, consent and audit", () => {
    expect(exportA.format).toBe('chameleon.account-export');
    expect(exportA.version).toBe(2);
    expect(exportA.account).toMatchObject({
      id: a.ownerId,
      email: a.email,
      displayName: 'export-a',
    });

    expect(exportA.profileBase).toMatchObject({ id: a.baseId, revisionId: a.revisionIds[1] });
    expect(exportA.profileRevisions.map((r) => r.id).sort()).toEqual([...a.revisionIds].sort());
    for (const revision of exportA.profileRevisions) {
      expect(revision.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(revision.cvMarkdown).toContain('# CV --');
    }
    expect(exportA.jobs).toHaveLength(1);
    expect(exportA.jobAnalyses).toHaveLength(1);
    expect(exportA.resumeVersions).toHaveLength(1);

    expect(exportA.consents).toEqual([
      expect.objectContaining({
        purpose: 'profile_processing',
        granted: true,
        policyVersion: 'v-test',
      }),
    ]);
    expect(exportA.auditEvents).toEqual([
      expect.objectContaining({
        action: 'test.event',
        correlationId: 'corr-export-a',
        metadata: { marker: a.auditCanary },
      }),
    ]);
    expect(exportA.sessions).toHaveLength(1);
    expect(exportA.sessions[0]!.userAgent).toBe('test-agent');
    expect(exportA.credentials).toEqual([expect.objectContaining({ kind: 'password' })]);
    expect(exportA.invitations.map((i) => i.id)).toEqual([a.inviteIds.used]);
  });

  it('includes every canary of the owner fixture and none of another owner', () => {
    const text = JSON.stringify(exportA);
    expect(a.canaries.length).toBe(2);
    for (const canary of a.canaries) expect(text, canary).toContain(canary);
    for (const canary of b.canaries) expect(text, canary).not.toContain(canary);
    for (const needle of [b.ownerId, b.email, b.auditCanary, b.baseId, ...b.revisionIds]) {
      expect(text, needle).not.toContain(needle);
    }
    expect(text).not.toContain(b.inviteIds.used);
    expect(text).not.toContain(b.inviteIds.open);
  });

  it('the other owner gets their own export (and none of A)', async () => {
    const exportB = await run(b.ownerId);
    const text = JSON.stringify(exportB);
    for (const canary of b.canaries) expect(text, canary).toContain(canary);
    for (const canary of a.canaries) expect(text, canary).not.toContain(canary);
    expect(text).not.toContain(a.ownerId);
    expect(text).not.toContain(a.email);
    expect(text).not.toContain(a.auditCanary);
  });

  it('is plain JSON: serialising and parsing it changes nothing', () => {
    expect(JSON.parse(JSON.stringify(exportA))).toEqual(exportA);
    const dates = JSON.stringify(exportA).match(/"\d{4}-\d{2}-\d{2}T[^"]+"/g) ?? [];
    expect(dates.length).toBeGreaterThan(10);
  });

  it('never contains secrets: password hash, session token hash, invite token hashes', async () => {
    const text = JSON.stringify(exportA);
    expect(text).not.toContain('SECRET-'); // password hash canary
    expect(text).not.toContain('$argon2id$');
    for (const secret of Object.values(a.secrets)) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/passwordHash|tokenHash/);
    // The open invite addressed to the same e-mail has a token hash too: not exported, not listed.
    const open = await testDb.sql<{ tokenHash: string }>(
      `SELECT "tokenHash" FROM "Invite" WHERE id = $1`,
      [a.inviteIds.open],
    );
    expect(text).not.toContain(open.rows[0]!.tokenHash);
    expect(text).not.toContain(a.inviteIds.open);
  });

  it('a partial account exports empty sections, not errors', async () => {
    const bare = await testDb.db.global.user.create({
      data: { email: `bare-${randomUUID().slice(0, 8)}@example.test` },
    });
    const bareExport = await run(bare.id);
    expect(bareExport.account.id).toBe(bare.id);
    expect(bareExport.profileBase).toBeNull();
    for (const key of [
      'profileRevisions',
      'jobs',
      'jobAnalyses',
      'resumes',
      'resumeVersions',
      'consents',
      'auditEvents',
      'sessions',
      'credentials',
      'invitations',
    ] as const) {
      expect(bareExport[key], key).toEqual([]);
    }
  });

  it('rejects an unknown account and a non-UUID owner id', async () => {
    await expect(run(randomUUID())).rejects.toThrow(AccountNotFoundError);
    await expect(run('not-a-uuid')).rejects.toThrow(OwnerScopeViolationError);
  });

  it('uses the injected clock', async () => {
    const fixed = new Date('2030-01-02T03:04:05.000Z');
    const result = await exportAccountData(testDb.db, a.ownerId, { now: () => fixed });
    expect(result.generatedAt).toBe('2030-01-02T03:04:05.000Z');
  });
});

describe('export registry against the live catalog', () => {
  const registry = ACCOUNT_EXPORT_REGISTRY as Record<string, ExportClassification>;

  it('every table of the database is classified (a new table without classification fails here)', async () => {
    const { rows } = await testDb.sql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
    );
    expect(unclassifiedModels(rows.map((r) => r.table_name))).toEqual([]);
  });

  it('every table with an "ownerId" column is exported (excluded tables carry no owner data)', async () => {
    const { rows } = await testDb.sql<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'ownerId'`,
    );
    for (const { table_name } of rows) {
      expect(registry[table_name]?.status, `${table_name} holds owner data`).toBe('exported');
    }
  });

  it('every section of the registry is present in the export', () => {
    for (const section of EXPORT_SECTIONS) expect(exportA, section).toHaveProperty(section);
  });

  const SECTION_ROWS = {
    account: (e: AccountExport) => [e.account],
    credentials: (e: AccountExport) => e.credentials,
    sessions: (e: AccountExport) => e.sessions,
    invitations: (e: AccountExport) => e.invitations,
    consents: (e: AccountExport) => e.consents,
    auditEvents: (e: AccountExport) => e.auditEvents,
    profileBase: (e: AccountExport) => (e.profileBase === null ? [] : [e.profileBase]),
    profileRevisions: (e: AccountExport) => e.profileRevisions,
    jobs: (e: AccountExport) => e.jobs,
    jobAnalyses: (e: AccountExport) => e.jobAnalyses,
    resumes: (e: AccountExport) => e.resumes,
    resumeVersions: (e: AccountExport) => e.resumeVersions,
  } as const;

  it('table columns = exported fields + withheld columns + ownerId (a new column must be classified)', async () => {
    for (const [model, entry] of Object.entries(registry)) {
      if (entry.status !== 'exported') continue;
      const rows = SECTION_ROWS[entry.section](exportA);
      expect(rows.length, `${model} has no exported row in the fixture`).toBeGreaterThan(0);
      const exported = Object.keys(rows[0] as object);
      const { rows: columns } = await testDb.sql<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [model],
      );
      const withheld = 'withheld' in entry ? [...(entry.withheld ?? [])] : [];
      const accounted = new Set([...exported, ...withheld, 'ownerId']);
      expect(
        columns.map((c) => c.column_name).filter((c) => !accounted.has(c)),
        `${model}: columns neither exported nor declared withheld`,
      ).toEqual([]);
      for (const column of withheld) {
        expect(exported, `${model}.${column} is declared withheld but exported`).not.toContain(
          column,
        );
      }
    }
  });
});
