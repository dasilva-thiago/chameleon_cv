import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../src/testing';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.drop();
});

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

async function seed(label: string) {
  const user = await testDb.db.global.user.create({
    data: { email: `${label}-${randomUUID().slice(0, 8)}@example.test` },
  });
  const scoped = testDb.db.forOwner(user.id);
  const job = await scoped.jobPosting.create({
    data: { ownerId: user.id, description: 'Vaga', descriptionHash: hash('Vaga') },
  });
  const resume = await scoped.resume.create({
    data: { ownerId: user.id, jobId: job.id, name: 'Currículo' },
  });
  const content = { schemaVersion: 1 };
  const version = await scoped.resumeVersion.create({
    data: {
      ownerId: user.id,
      resumeId: resume.id,
      versionNumber: 1,
      language: 'pt-BR',
      content,
      contentHash: hash(JSON.stringify(content)),
    },
  });
  return { user, scoped, job, resume, version };
}

describe('ResumeVersion: approved versions are immutable in the database', () => {
  it('a draft can be edited and then approved once', async () => {
    const { scoped, version } = await seed('draft');
    const edited = await scoped.resumeVersion.update({
      where: { id: version.id },
      data: { content: { schemaVersion: 1, edited: true }, issueWarnings: 2 },
    });
    expect(edited.issueWarnings).toBe(2);
    const approved = await scoped.resumeVersion.update({
      where: { id: version.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
    expect(approved.status).toBe('approved');
  });

  it('after approval no UPDATE is accepted: content, status or anything else', async () => {
    const { scoped, version } = await seed('locked');
    await scoped.resumeVersion.update({
      where: { id: version.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
    await expect(
      scoped.resumeVersion.update({
        where: { id: version.id },
        data: { content: { schemaVersion: 1, x: 1 } },
      }),
    ).rejects.toThrow(/resume_version_approved/);
    await expect(
      scoped.resumeVersion.update({
        where: { id: version.id },
        data: { status: 'draft', approvedAt: null },
      }),
    ).rejects.toThrow(/resume_version_approved/);
    await expect(
      testDb.sql(`UPDATE "ResumeVersion" SET "issueErrors" = 5 WHERE id = $1`, [version.id]),
    ).rejects.toThrow(/resume_version_approved/);
    const stored = await scoped.resumeVersion.findFirst({ where: { id: version.id } });
    expect(stored?.content).toEqual({ schemaVersion: 1 });
  });

  it('the status and the approval date must agree', async () => {
    const { scoped, version } = await seed('agree');
    await expect(
      scoped.resumeVersion.update({ where: { id: version.id }, data: { status: 'approved' } }),
    ).rejects.toThrow(/ResumeVersion_shape_chk/);
    await expect(
      scoped.resumeVersion.update({ where: { id: version.id }, data: { approvedAt: new Date() } }),
    ).rejects.toThrow(/ResumeVersion_shape_chk/);
  });

  it('rejects malformed hashes, languages and version numbers', async () => {
    const { scoped, resume, user } = await seed('shape');
    const base = {
      ownerId: user.id,
      resumeId: resume.id,
      content: { schemaVersion: 1 },
      language: 'pt-BR',
      contentHash: hash('x'),
    };
    for (const bad of [
      { versionNumber: 2, contentHash: 'not-a-hash' },
      { versionNumber: 3, language: 'Português' },
      { versionNumber: 0 },
    ]) {
      await expect(scoped.resumeVersion.create({ data: { ...base, ...bad } })).rejects.toThrow();
    }
  });

  it('deleting the resume (or the job) removes even approved versions', async () => {
    const { scoped, version, resume, job } = await seed('cascade');
    await scoped.resumeVersion.update({
      where: { id: version.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
    await scoped.resume.deleteMany({ where: { id: resume.id } });
    expect(await scoped.resumeVersion.count({ where: { id: version.id } })).toBe(0);

    const second = await seed('cascade-job');
    await second.scoped.resumeVersion.update({
      where: { id: second.version.id },
      data: { status: 'approved', approvedAt: new Date() },
    });
    await second.scoped.jobPosting.deleteMany({ where: { id: second.job.id } });
    expect(await second.scoped.resume.count()).toBe(0);
    expect(await second.scoped.resumeVersion.count()).toBe(0);
    expect(job.id).not.toBe(second.job.id);
  });

  it('version numbers are unique per resume', async () => {
    const { scoped, resume, user } = await seed('unique');
    await expect(
      scoped.resumeVersion.create({
        data: {
          ownerId: user.id,
          resumeId: resume.id,
          versionNumber: 1,
          language: 'pt-BR',
          content: { schemaVersion: 1 },
          contentHash: hash('y'),
        },
      }),
    ).rejects.toThrow(/Unique|unique|duplicar/);
  });
});
