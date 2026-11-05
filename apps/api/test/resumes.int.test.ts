import {
  createResumeResponseSchema,
  jobResponseSchema,
  listResumesResponseSchema,
  resumeResponseSchema,
  resumeVersionResponseSchema,
  type JobDetail,
  type ResumeContent,
  type ResumeVersionDetail,
} from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  TEST_POLICY_VERSION,
  buildTestApp,
  createTestAccount,
  createTwoAccounts,
  type TestAccount,
} from './helpers';

let testDb: TestDb;
let built: ReturnType<typeof buildTestApp>;
let a: TestAccount;
let b: TestAccount;
const ids: Record<string, string> = {};

const confirmed = { status: 'confirmed' };
const profileDocument = {
  schema_version: '2.1.0',
  profile: {
    identity: { full_name: 'Ana Teste', city: 'Curitiba' },
    positioning: { professional_headline: 'Pessoa desenvolvedora backend' },
    contact_points: [
      { id: 'email-1', kind: 'email', value: 'ana@example.test', visibility: 'public' },
      { id: 'phone-1', kind: 'phone', value: '+55 41 99999-0000', visibility: 'private' },
    ],
    statements: [
      { id: 'sum-1', kind: 'short_summary', text: 'Backend com foco em APIs.', meta: confirmed },
    ],
    experiences: [
      {
        id: 'exp-1',
        official_title: 'Desenvolvedora Backend',
        organization_name: 'Acme',
        start_date: '2022-03',
        end_date: 'present',
        meta: confirmed,
        items: [
          {
            id: 'item-ok',
            kind: 'achievement',
            text: 'Criou APIs REST em Node.js.',
            meta: confirmed,
          },
          {
            id: 'item-pending',
            kind: 'achievement',
            text: 'Reduziu custos em 40%.',
            meta: { status: 'needs_review' },
          },
        ],
      },
    ],
    skills: [
      { id: 'skill-node', name: 'Node.js', meta: confirmed },
      { id: 'skill-tf', name: 'Terraform', meta: { status: 'needs_review' } },
    ],
    skill_usages: [
      {
        id: 'usage-1',
        skill_id: 'skill-node',
        usage_context: 'professional_experience',
        experience_id: 'exp-1',
        meta: confirmed,
      },
    ],
    education: [
      {
        id: 'edu-1',
        course_name: 'Sistemas de Informação',
        institution: 'UFPR',
        start_date: '2019',
        completion_date: '2023',
        meta: confirmed,
      },
    ],
  },
};

const JOB_TEXT = 'Vaga\n\nRequisitos\n- Experiência com Node.js\n- Kubernetes em produção\n';

async function seedProfile(client: TestAccount['client']): Promise<void> {
  const preview = await client.post('/api/profile/imports/preview', {
    text: JSON.stringify(profileDocument),
  });
  expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(201);
  const importId = (preview.body as { importRecord: { id: string } }).importRecord.id;
  const applied = await client.post(`/api/profile/imports/${importId}/apply`, { mode: 'merge' });
  expect(applied.status).toBe(200);
  const idMap = (applied.body as { importRecord: { idMap: Record<string, string> } }).importRecord
    .idMap;
  Object.assign(ids, idMap);
  const toConfirm = Object.entries(idMap)
    .filter(([local]) => !['item-pending', 'skill-tf'].includes(local))
    .map(([, uuid]) => uuid);
  const done = await client.post('/api/profile/confirmations', { recordIds: toConfirm });
  expect(done.status).toBe(200);
}

beforeAll(async () => {
  testDb = await createTestDb();
  built = buildTestApp(testDb.db);
  ({ a, b } = await createTwoAccounts({ app: built.app, config: built.config, db: testDb.db }));
  await seedProfile(a.client);
}, 90_000);
afterAll(async () => {
  await testDb.drop();
});

async function newJob(client = a.client): Promise<JobDetail> {
  const response = await client.post('/api/jobs', {
    description: JOB_TEXT,
    title: 'Dev',
    company: 'Acme',
  });
  expect(response.status).toBe(201);
  return jobResponseSchema.parse(response.body).job;
}

async function generate(client = a.client, job?: JobDetail) {
  const target = job ?? (await newJob(client));
  const response = await client.post(`/api/jobs/${target.id}/resumes`, {});
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
  return { job: target, ...createResumeResponseSchema.parse(response.body) };
}

const versionUrl = (resumeId: string, versionId: string): string =>
  `/api/resumes/${resumeId}/versions/${versionId}`;

const parseVersion = (body: unknown): ResumeVersionDetail =>
  resumeVersionResponseSchema.parse(body).version;

const bullets = (content: ResumeContent) =>
  content.sections.flatMap((section) => section.entries.flatMap((entry) => entry.bullets));

describe('resume generation', () => {
  it('creates version 1 (draft) from confirmed facts only, with provenance on every item', async () => {
    const { resume, version, notes, job } = await generate();
    expect(resume.versions).toHaveLength(1);
    expect(version).toMatchObject({ versionNumber: 1, status: 'draft', approvedAt: null });
    expect(notes).toEqual([]);

    const { content } = version;
    expect(content.header).toMatchObject({
      name: 'Ana Teste',
      headline: 'Pessoa desenvolvedora backend',
    });
    expect(content.header.contacts.map((c) => c.value)).toEqual(['ana@example.test']);
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/99999|40%|Terraform/);
    expect(bullets(content).map((b) => b.text)).toEqual(
      expect.arrayContaining(['Criou APIs REST em Node.js.', 'Node.js']),
    );
    for (const section of content.sections) {
      for (const entry of section.entries) {
        expect(entry.sourceIds.length).toBeGreaterThan(0);
        for (const bullet of entry.bullets) expect(bullet.sourceIds.length).toBeGreaterThan(0);
      }
    }
    expect(version.issues).toEqual([]);
    expect(version.profileRevisionId).not.toBeNull();
    expect(version.analysisId).not.toBeNull();

    const reread = jobResponseSchema.parse((await a.client.get(`/api/jobs/${job.id}`)).body).job;
    expect(reread.status).toBe('analyzed');
    const revision = await testDb.sql<{ reason: string }>(
      `SELECT reason FROM "ProfileRevision" WHERE id = $1`,
      [version.profileRevisionId],
    );
    expect(revision.rows[0]?.reason).toMatch(/pre_generation|import/);
  });

  it('uses the owner review of the analysis: an excluded record does not appear', async () => {
    const job = await newJob();
    const analysis = await a.client.post(`/api/jobs/${job.id}/analysis`, {});
    expect(analysis.status).toBe(201);
    const review = await a.client.patch(`/api/jobs/${job.id}/analysis/review`, {
      review: { excludedRecordIds: [ids['item-ok']], pinnedRecordIds: [], notes: {} },
    });
    expect(review.status).toBe(200);
    const { version } = await generate(a.client, job);
    expect(JSON.stringify(version.content)).not.toContain('Criou APIs REST');
  });

  it('lists, reads and renames the resume; versions come newest first', async () => {
    const { job, resume, version } = await generate();
    const list = listResumesResponseSchema.parse(
      (await a.client.get(`/api/jobs/${job.id}/resumes`)).body,
    );
    expect(list.resumes.map((r) => r.id)).toEqual([resume.id]);
    expect(list.resumes[0]?.versions[0]).not.toHaveProperty('content');

    const renamed = await a.client.patch(`/api/resumes/${resume.id}`, {
      name: 'Versão para a Acme',
    });
    expect(resumeResponseSchema.parse(renamed.body).resume.name).toBe('Versão para a Acme');
    const newer = await a.client.post(`/api/resumes/${resume.id}/versions`, {
      fromVersionId: version.id,
    });
    expect(newer.status).toBe(201);
    const got = resumeResponseSchema.parse((await a.client.get(`/api/resumes/${resume.id}`)).body);
    expect(got.resume.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
  });

  it('without a profile the generation is refused', async () => {
    const empty = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'sem-perfil-cv@example.test' },
    );
    const job = await newJob(empty.client);
    const response = await empty.client.post(`/api/jobs/${job.id}/resumes`, {});
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('PROFILE_REQUIRED');
  });
});

describe('editing a draft', () => {
  it('edited and added text can never claim to be generated, and the hash follows the content', async () => {
    const { resume, version } = await generate();
    const content = structuredClone(version.content);
    const entry = content.sections.find((s) => s.kind === 'experience')?.entries[0];
    if (!entry?.bullets[0]) throw new Error('no bullet');
    entry.bullets[0].text = 'Criou APIs REST em Node.js para o time de pagamentos.';
    // the client lies: keeps "generated" on the edited text and on a brand-new bullet
    entry.bullets.push({
      id: 'extra-1',
      text: 'Mais um item',
      sourceIds: entry.sourceIds,
      origin: 'generated',
    });
    const response = await a.client.put(versionUrl(resume.id, version.id), { content });
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
    const saved = parseVersion(response.body);
    const savedEntry = saved.content.sections.find((s) => s.kind === 'experience')?.entries[0];
    expect(savedEntry?.bullets[0]?.origin).toBe('edited');
    expect(savedEntry?.bullets.find((b) => b.id === 'extra-1')?.origin).toBe('added');
    expect(saved.contentHash).not.toBe(version.contentHash);
    // unchanged bullets keep their origin
    expect(bullets(saved.content).filter((b) => b.origin === 'generated').length).toBeGreaterThan(
      0,
    );
  });

  it('missing / unknown sources are blocking errors, unsupported terms are warnings', async () => {
    const { resume, version } = await generate();
    const content = structuredClone(version.content);
    const entry = content.sections.find((s) => s.kind === 'experience')?.entries[0];
    if (!entry) throw new Error('no entry');
    entry.bullets[0]!.sourceIds = [];
    entry.bullets.push({
      id: 'x-1',
      text: 'Operou Kubernetes em produção com 12 pessoas.',
      sourceIds: [ids['exp-1']!],
      origin: 'added',
    });
    entry.bullets.push({
      id: 'x-2',
      text: 'Item fantasma',
      sourceIds: ['00000000-0000-4000-8000-000000000000'],
      origin: 'added',
    });
    const saved = parseVersion(
      (await a.client.put(versionUrl(resume.id, version.id), { content })).body,
    );
    const codes = saved.issues.map((i) => `${i.severity}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'error:NO_SOURCE',
        'error:UNKNOWN_SOURCE',
        'warning:UNSUPPORTED_TERM',
      ]),
    );
    expect(saved.issueCounts.errors).toBeGreaterThanOrEqual(2);
    const summary = resumeResponseSchema.parse(
      (await a.client.get(`/api/resumes/${resume.id}`)).body,
    );
    expect(summary.resume.versions[0]?.issueCounts.errors).toBe(saved.issueCounts.errors);

    const approve = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(approve.status).toBe(409);
    const body = approve.body as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('RESUME_INVALID');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects content that breaks the contract', async () => {
    const { resume, version } = await generate();
    for (const mutate of [
      (c: ResumeContent) => {
        c.sections[0]!.entries[0]!.bullets[0]!.text = '';
      },
      (c: ResumeContent) => {
        c.header.name = 'a\u0000b';
      },
      (c: ResumeContent) => {
        (c as unknown as Record<string, unknown>).extra = 1;
      },
    ]) {
      const content = structuredClone(version.content);
      mutate(content);
      const response = await a.client.put(versionUrl(resume.id, version.id), { content });
      expect(response.status).toBe(400);
    }
  });
});

describe('approval and versions', () => {
  it('approves a valid draft, freezes it (API and database) and edits go through a new draft', async () => {
    const { resume, version } = await generate();
    const approve = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(approve.status, JSON.stringify(approve.body).slice(0, 300)).toBe(200);
    const approved = parseVersion(approve.body);
    expect(approved).toMatchObject({ status: 'approved' });
    expect(approved.approvedAt).not.toBeNull();

    const again = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(again.status).toBe(409);
    expect((again.body as { error: { code: string } }).error.code).toBe('VERSION_APPROVED');
    const put = await a.client.put(versionUrl(resume.id, version.id), {
      content: approved.content,
    });
    expect(put.status).toBe(409);
    expect((put.body as { error: { code: string } }).error.code).toBe('VERSION_APPROVED');
    await expect(
      testDb.sql(`UPDATE "ResumeVersion" SET "language" = 'en' WHERE id = $1`, [version.id]),
    ).rejects.toThrow(/resume_version_approved/);

    const copy = await a.client.post(`/api/resumes/${resume.id}/versions`, {
      fromVersionId: version.id,
    });
    expect(copy.status).toBe(201);
    const draft = parseVersion(copy.body);
    expect(draft).toMatchObject({ versionNumber: 2, status: 'draft', sourceVersionId: version.id });
    expect(draft.content).toEqual(approved.content);
    const edit = await a.client.put(versionUrl(resume.id, draft.id), { content: draft.content });
    expect(edit.status).toBe(200);
    // the approved one is untouched
    const still = parseVersion((await a.client.get(versionUrl(resume.id, version.id))).body);
    expect(still.contentHash).toBe(approved.contentHash);
  });

  it('a source that stopped being confirmed blocks approval of an older draft', async () => {
    const { resume, version } = await generate();
    const unconfirm = await a.client.patch(`/api/profile/records/${ids['item-ok']}/meta`, {
      status: 'needs_review',
    });
    expect(unconfirm.status, JSON.stringify(unconfirm.body).slice(0, 200)).toBe(200);
    const detail = parseVersion((await a.client.get(versionUrl(resume.id, version.id))).body);
    expect(detail.issues.some((i) => i.code === 'SOURCE_NOT_USABLE')).toBe(true);
    const approve = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(approve.status).toBe(409);
    // restore for the other tests
    const restore = await a.client.post('/api/profile/confirmations', {
      recordIds: [ids['item-ok']],
    });
    expect(restore.status).toBe(200);
  });

  it('deleting the resume removes every version, even approved ones', async () => {
    const { resume, version } = await generate();
    await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect((await a.client.delete(`/api/resumes/${resume.id}`)).status).toBe(200);
    const rows = await testDb.sql<{ n: string }>(
      `SELECT count(*) AS n FROM "ResumeVersion" WHERE "resumeId" = $1`,
      [resume.id],
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
    expect((await a.client.get(`/api/resumes/${resume.id}`)).status).toBe(404);
  });
});

describe('export (P4)', () => {
  async function approved() {
    const { resume, version, job } = await generate();
    const approve = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(approve.status).toBe(200);
    return { resume, version: parseVersion(approve.body), job };
  }
  const exportUrl = (resumeId: string, versionId: string, format: string): string =>
    `${versionUrl(resumeId, versionId)}/export?format=${format}`;

  it('refuses drafts and unknown formats', async () => {
    const { resume, version } = await generate();
    const draft = await a.client.get(exportUrl(resume.id, version.id, 'docx'));
    expect(draft.status).toBe(409);
    expect((draft.body as { error: { code: string } }).error.code).toBe('VERSION_NOT_APPROVED');
    const { resume: r2, version: v2 } = await approved();
    expect((await a.client.get(exportUrl(r2.id, v2.id, 'odt'))).status).toBe(400);
    expect((await a.client.get(`${versionUrl(r2.id, v2.id)}/export`)).status).toBe(400);
  });

  it('downloads the approved version as DOCX with safe headers and the approved text', async () => {
    const { resume, version } = await approved();
    const response = await a.client.request(
      'get',
      exportUrl(resume.id, version.id, 'docx'),
      undefined,
      {
        binary: true,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="Ana-Teste_Dev_Acme_\d{8}\.docx"$/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const bytes = response.body as Buffer;
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Ana Teste');
    expect(xml).toContain('Criou APIs REST em Node.js.');
    expect(xml).not.toMatch(/Terraform|40%|99999/);
  });

  it('downloads a PDF when a browser is available (503 otherwise) and records an audit event without content', async () => {
    const { resume, version } = await approved();
    const response = await a.client.request(
      'get',
      exportUrl(resume.id, version.id, 'pdf'),
      undefined,
      {
        binary: true,
      },
    );
    expect([200, 503]).toContain(response.status);
    if (response.status === 200) {
      expect(response.headers['content-type']).toContain('application/pdf');
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    } else {
      expect((response.body as { error: { code: string } }).error.code).toBe('EXPORT_UNAVAILABLE');
    }
    const rows = await testDb.sql<{ metadata: unknown }>(
      `SELECT metadata FROM "AuditEvent" WHERE action = 'resume.export'`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Criou APIs|Ana Teste/);
  }, 60_000);

  it('another account cannot export it (same 404 as a missing id)', async () => {
    const { resume, version } = await approved();
    const crossed = await b.client.get(exportUrl(resume.id, version.id, 'docx'));
    const ghost = '00000000-0000-4000-8000-000000000000';
    const absent = await b.client.get(exportUrl(ghost, ghost, 'docx'));
    expect(crossed.status).toBe(404);
    expect(crossed.status).toBe(absent.status);
  });
});

describe('access', () => {
  it('another account gets the same 404 for a foreign resume on every route', async () => {
    const { job, resume, version } = await generate();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const content = version.content;
    const routes = [
      ['get', `/api/jobs/${job.id}/resumes`, undefined],
      ['post', `/api/jobs/${job.id}/resumes`, {}],
      ['get', `/api/resumes/${resume.id}`, undefined],
      ['patch', `/api/resumes/${resume.id}`, { name: 'x' }],
      ['get', versionUrl(resume.id, version.id), undefined],
      ['put', versionUrl(resume.id, version.id), { content }],
      ['post', `${versionUrl(resume.id, version.id)}/approve`, {}],
      ['post', `/api/resumes/${resume.id}/versions`, { fromVersionId: version.id }],
      ['delete', `/api/resumes/${resume.id}`, undefined],
    ] as const;
    const strip = (res: { body: unknown }) => {
      const { requestId: _r, ...rest } = (res.body as { error: Record<string, unknown> }).error;
      return rest;
    };
    for (const [method, path, body] of routes) {
      const crossed = await b.client.request(method, path, body);
      const absent = await b.client.request(
        method,
        path.replaceAll(job.id, ghost).replaceAll(resume.id, ghost).replaceAll(version.id, ghost),
        body,
      );
      expect(crossed.status, `${method} ${path}`).toBe(404);
      expect(strip(crossed)).toEqual(strip(absent));
    }
    expect((await a.client.get(`/api/resumes/${resume.id}`)).status).toBe(200);
  });

  it('withdrawn profile consent blocks every resume route', async () => {
    const solo = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'sem-consentimento-cv@example.test' },
    );
    const job = await newJob(solo.client);
    await testDb.db.forOwner(solo.ownerId).consentRecord.create({
      data: {
        ownerId: solo.ownerId,
        purpose: 'profile_processing',
        granted: false,
        policyVersion: TEST_POLICY_VERSION,
        recordedAt: new Date(Date.now() + 60_000),
      },
    });
    for (const response of [
      await solo.client.get(`/api/jobs/${job.id}/resumes`),
      await solo.client.post(`/api/jobs/${job.id}/resumes`, {}),
    ]) {
      expect(response.status).toBe(403);
    }
  });

  it('audit events of resumes carry ids and counts, never resume text', async () => {
    const rows = await testDb.sql<{ metadata: unknown }>(
      `SELECT metadata FROM "AuditEvent" WHERE action LIKE 'resume.%'`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows.rows)).not.toMatch(/Criou APIs|Ana Teste|Acme/);
  });
});
