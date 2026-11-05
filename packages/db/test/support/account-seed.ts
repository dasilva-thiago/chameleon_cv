import { createHash, randomUUID } from 'node:crypto';
import { cloneJson, type ImportReport } from '@chameleon/contracts';
import { listProfileCanaries, type ProfileId } from '@chameleon/test-fixtures';
import { createProfileStore, type ProfileStore } from '../../src/profile-store';
import type { TestDb } from '../../src/testing';
import { fixtureDocument } from './profile-docs';
import { testSnapshot } from './snapshot';

/** Everything seeded for one owner, with the secrets/PII values the tests look for. */
export interface SeededOwner {
  ownerId: string;
  email: string;
  profileId: string;
  revisionIds: string[];
  importRecordId: string;
  /** Fixture canaries that live inside the profile document. */
  canaries: readonly string[];
  /** Secret values that must never be exported. */
  secrets: { passwordHash: string; sessionTokenHash: string; usedInviteTokenHash: string };
  /** Value placed in `AuditEvent.metadata` and `ConsentRecord`/import fields. */
  auditCanary: string;
  inviteIds: { used: string; open: string };
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function importReport(source: ImportReport['source_format'], canary: string): ImportReport {
  return {
    source_format: source,
    source_schema_version: '2.0.0',
    target_schema_version: '2.1.0',
    mode: 'lenient',
    steps: [{ id: 'parse', from: null, to: 'object', description: 'Parse', changes: 1 }],
    warnings: [],
    errors: [],
    unmapped: [{ path: 'profile.extra', value: { note: canary }, reason: 'lenient' }],
    id_map: { 'LOCAL-1': randomUUID() },
  };
}

export function makeStore(testDb: TestDb): ProfileStore {
  return createProfileStore(testDb.db, { snapshot: testSnapshot });
}

/**
 * Creates a complete owner: user, credential, session, consent, audit event, profile (fixture), two
 * revisions, an applied markdown import, one invitation accepted by the user and one open invitation
 * addressed to the same e-mail.
 */
export async function seedOwner(
  testDb: TestDb,
  store: ProfileStore,
  label: string,
  fixture: ProfileId,
): Promise<SeededOwner> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const user = await testDb.db.global.user.create({ data: { email, displayName: label } });
  const ownerId = user.id;
  const scoped = testDb.db.forOwner(ownerId);

  const passwordHash = `$argon2id$v=19$m=19456,t=2,p=1$SECRET-${label}-${randomUUID()}`;
  const sessionTokenHash = sha256(`session-${label}-${randomUUID()}`);
  const usedInviteTokenHash = sha256(`invite-used-${label}-${randomUUID()}`);
  const openInviteTokenHash = sha256(`invite-open-${label}-${randomUUID()}`);
  const auditCanary = `AUDIT-CANARY-${label}-${randomUUID().slice(0, 8)}`;

  await scoped.credential.create({ data: { ownerId, kind: 'password', passwordHash } });
  const now = new Date();
  await scoped.session.create({
    data: {
      ownerId,
      tokenHash: sessionTokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      absoluteExpiresAt: new Date(now.getTime() + 7_200_000),
      userAgent: 'test-agent',
    },
  });
  await scoped.consentRecord.create({
    data: { ownerId, purpose: 'profile_processing', granted: true, policyVersion: 'v-test' },
  });
  await scoped.auditEvent.create({
    data: {
      ownerId,
      action: 'test.event',
      entityType: 'profile',
      correlationId: `corr-${label}`,
      metadata: { marker: auditCanary },
    },
  });

  const used = await testDb.db.global.invite.create({
    data: {
      email,
      tokenHash: usedInviteTokenHash,
      expiresAt: new Date(now.getTime() + 86_400_000),
      usedAt: now,
      usedByUserId: ownerId,
    },
  });
  const open = await testDb.db.global.invite.create({
    data: {
      email, // a second invite addressed to the same e-mail (still open)
      tokenHash: openInviteTokenHash,
      expiresAt: new Date(now.getTime() + 86_400_000),
    },
  });

  const document = fixtureDocument(fixture);
  const applied = await store.applyImport(ownerId, {
    document,
    report: importReport('markdown', auditCanary),
  });
  // A real edit, so the second revision is a new snapshot (an unchanged hash would reuse the first).
  const edited = cloneJson(document);
  edited.profile.identity = { ...edited.profile.identity, preferred_name: `Edited ${label}` };
  const saved = await store.saveProfileDocument(ownerId, edited, {
    onMissing: 'keep',
    revision: 'manual_save',
  });
  const second = saved.revision;
  if (!second || second.reused) throw new Error('second revision was not created');

  // A saved job posting whose text carries the audit canary (it must be exported, and purged, with the account).
  const jobText = `Job posting text ${auditCanary}`;
  await testDb.db.forOwner(ownerId).jobPosting.create({
    data: {
      ownerId,
      description: jobText,
      descriptionHash: createHash('sha256').update(jobText).digest('hex'),
    },
  });

  return {
    ownerId,
    email,
    profileId: applied.save.profileId,
    revisionIds: [applied.revision.revision.id, second.revision.id],
    importRecordId: applied.importRecord.id,
    canaries: listProfileCanaries(fixture),
    secrets: { passwordHash, sessionTokenHash, usedInviteTokenHash },
    auditCanary,
    inviteIds: { used: used.id, open: open.id },
  };
}

/** Row counts of every table that has an "ownerId" column, for one owner (catalog-driven). */
export async function ownerRowCounts(
  testDb: TestDb,
  ownerId: string,
): Promise<Record<string, number>> {
  const { rows: tables } = await testDb.sql<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'ownerId' ORDER BY table_name`,
  );
  const counts: Record<string, number> = {};
  for (const { table_name } of tables) {
    const { rows } = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "${table_name.replaceAll('"', '""')}" WHERE "ownerId" = $1`,
      [ownerId],
    );
    counts[table_name] = Number(rows[0]?.n);
  }
  return counts;
}

/** Whole-table dump of one owner (rows as JSON) to prove another owner's data did not change. */
export async function ownerDump(testDb: TestDb, ownerId: string): Promise<string> {
  const counts = await ownerRowCounts(testDb, ownerId);
  const parts: unknown[] = [];
  for (const table of Object.keys(counts)) {
    const { rows } = await testDb.sql(
      `SELECT to_jsonb(t) AS row FROM "${table.replaceAll('"', '""')}" t WHERE "ownerId" = $1 ORDER BY id`,
      [ownerId],
    );
    parts.push([table, rows]);
  }
  return JSON.stringify(parts);
}
