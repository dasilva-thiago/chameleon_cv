import { createHash, randomUUID } from 'node:crypto';
import type { TestDb } from '../../src/testing';

/** Everything seeded for one owner, with the secrets/PII values the tests look for. */
export interface SeededOwner {
  ownerId: string;
  email: string;
  baseId: string;
  revisionIds: string[];
  /** Canaries that live inside the professional base (CV and profile Markdown). */
  canaries: readonly string[];
  /** Secret values that must never be exported. */
  secrets: { passwordHash: string; sessionTokenHash: string; usedInviteTokenHash: string };
  /** Value placed in `AuditEvent.metadata`, the job text and the resume/analysis JSON. */
  auditCanary: string;
  inviteIds: { used: string; open: string };
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Creates a complete owner: user, credential, session, consent, audit event, the professional base with two
 * revisions, a job with an evaluation and a resume, one invitation accepted by the user and one open invitation
 * addressed to the same e-mail.
 */
export async function seedOwner(testDb: TestDb, label: string): Promise<SeededOwner> {
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

  // The professional base: two revisions (a real edit), the base pointing to the second.
  const cvCanary = `CV-CANARY-${label}-${randomUUID().slice(0, 8)}`;
  const profileCanary = `PROFILE-CANARY-${label}-${randomUUID().slice(0, 8)}`;
  const revisionIds: string[] = [];
  for (const version of [1, 2]) {
    const cvMarkdown = `# CV -- ${label}

## Experiência

### Empresa ${cvCanary} v${String(version)}
`;
    const profileMarkdown = `## Alvos
- ${profileCanary}
`;
    const revision = await scoped.profileBaseRevision.create({
      data: {
        ownerId,
        cvMarkdown,
        profileMarkdown,
        contentHash: sha256(cvMarkdown + profileMarkdown),
      },
    });
    revisionIds.push(revision.id);
  }
  const lastRevision = await scoped.profileBaseRevision.findFirstOrThrow({
    where: { id: revisionIds[1] },
  });
  const base = await scoped.profileBase.create({
    data: {
      ownerId,
      cvMarkdown: lastRevision.cvMarkdown,
      profileMarkdown: lastRevision.profileMarkdown,
      contentHash: lastRevision.contentHash,
      revisionId: lastRevision.id,
    },
  });

  // A saved job posting whose text carries the audit canary (it must be exported, and purged, with the account).
  const jobText = `Job posting text ${auditCanary}`;
  const jobHash = createHash('sha256').update(jobText).digest('hex');
  const job = await testDb.db.forOwner(ownerId).jobPosting.create({
    data: { ownerId, description: jobText, descriptionHash: jobHash },
  });
  const resume = await testDb.db.forOwner(ownerId).resume.create({
    data: { ownerId, jobId: job.id, name: 'Currículo de teste' },
  });
  const content = { schemaVersion: 2, note: auditCanary };
  await testDb.db.forOwner(ownerId).resumeVersion.create({
    data: {
      ownerId,
      resumeId: resume.id,
      versionNumber: 1,
      language: 'pt-BR',
      content,
      contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
      profileRevisionId: revisionIds[1] ?? null,
    },
  });
  await testDb.db.forOwner(ownerId).jobAnalysis.create({
    data: {
      ownerId,
      jobId: job.id,
      descriptionHash: jobHash,
      profileHash: createHash('sha256').update(`profile ${auditCanary}`).digest('hex'),
      engine: 'ai',
      engineVersion: 'test-1',
      result: { note: auditCanary },
    },
  });

  return {
    ownerId,
    email,
    baseId: base.id,
    revisionIds,
    canaries: [cvCanary, profileCanary],
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
