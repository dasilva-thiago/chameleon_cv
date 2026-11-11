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
import { createAiService } from '../src/ai/service';
import {
  BASE_CV,
  BASE_PROFILE,
  JOB_TEXT,
  TEST_POLICY_VERSION,
  buildTestApp,
  createTestAccount,
  createTwoAccounts,
  scriptedProvider,
  seedBase,
  type TestAccount,
} from './helpers';

let testDb: TestDb;
let built: ReturnType<typeof buildTestApp>;
let a: TestAccount;
let b: TestAccount;
const provider = scriptedProvider();

beforeAll(async () => {
  testDb = await createTestDb();
  const ai = createAiService({
    mode: 'auto',
    providers: [provider],
    limits: { totalDailyRequests: 1000, totalDailyTokens: 1_000_000 },
  });
  built = buildTestApp(testDb.db, { ai });
  ({ a, b } = await createTwoAccounts({ app: built.app, config: built.config, db: testDb.db }));
  await seedBase(a.client);
  for (const account of [a, b]) {
    expect((await account.client.put('/api/ai/consent', { granted: true })).status).toBe(200);
  }
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
  it('evaluates the job, tailors with AI and checks the result against the base', async () => {
    const { resume, version, notes } = await generate();
    expect(version).toMatchObject({ versionNumber: 1, status: 'draft', language: 'pt-BR' });
    expect(version.profileRevisionId).not.toBeNull();
    expect(version.analysisId).not.toBeNull();
    const { content } = version;
    expect(content.header).toMatchObject({
      name: 'Ana Teste',
      headline: 'Desenvolvedora Backend Júnior | Node.js · PostgreSQL',
    });
    // Contacts come from the base (the AI never saw them).
    expect(content.header.contacts.map((c) => c.value)).toContain('ana.contato@example.test');
    const exp = content.sections.find((s) => s.kind === 'experience')!;
    expect(exp.entries[0]).toMatchObject({ heading: 'Suporte Técnico', period: '2025 - Atual' });
    expect(bullets(content).every((bullet) => bullet.origin === 'generated')).toBe(true);
    expect(version.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(version.coverage).toEqual({
      percent: 67,
      present: ['Node.js', 'APIs REST'],
      missing: ['Kubernetes'],
    });
    expect(notes.join(' ')).toContain('Adaptado com IA');
    expect(resume.versions).toHaveLength(1);
    // The AI never received contact details.
    for (const request of provider.requests) {
      expect(JSON.stringify(request.messages)).not.toMatch(/ana\.contato@example\.test|99999-0000/);
    }
  });

  it('a second resume for the same job reuses the evaluation (no new evaluation call)', async () => {
    const job = await newJob();
    await generate(a.client, job);
    const evaluations = provider.calls('evaluate');
    await generate(a.client, job);
    expect(provider.calls('evaluate')).toBe(evaluations);
  });

  it('lists, reads and renames the resume; versions come newest first', async () => {
    const { job, resume } = await generate();
    const list = listResumesResponseSchema.parse(
      (await a.client.get(`/api/jobs/${job.id}/resumes`)).body,
    );
    expect(list.resumes.map((r) => r.id)).toContain(resume.id);
    const renamed = await a.client.patch(`/api/resumes/${resume.id}`, { name: 'Para a Acme' });
    expect(renamed.status).toBe(200);
    expect(resumeResponseSchema.parse(renamed.body).resume.name).toBe('Para a Acme');
  });

  it('without a base the generation is refused with PROFILE_REQUIRED', async () => {
    const job = await newJob(b.client);
    const response = await b.client.post(`/api/jobs/${job.id}/resumes`, {});
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('PROFILE_REQUIRED');
  });

  it('if the tailoring call fails, the resume is the base without tailoring (no error)', async () => {
    const job = await newJob();
    // Evaluate first (so only the tailoring call fails).
    expect((await a.client.post(`/api/jobs/${job.id}/analysis`, {})).status).toBe(201);
    provider.answers.tailor = { nothing: true };
    try {
      const { version, notes } = await generate(a.client, job);
      expect(notes.join(' ')).toContain('sem adaptação');
      expect(version.content.header.headline).toBe('Desenvolvedora de Software');
      expect(version.issues.filter((i) => i.severity === 'error')).toEqual([]);
    } finally {
      delete provider.answers.tailor;
    }
  });
});

describe('editing a draft: the career-ops checks', () => {
  it('edited and added text can never claim to be generated', async () => {
    const { resume, version } = await generate();
    const content = structuredClone(version.content);
    const exp = content.sections.find((s) => s.kind === 'experience')!;
    exp.entries[0]!.bullets[0]!.text = 'Triagem e análise de incidentes em sistemas web.';
    exp.entries[0]!.bullets.push({
      id: 'novo-1',
      text: 'Documentação de procedimentos.',
      origin: 'generated',
    });
    const saved = parseVersion(
      (await a.client.put(versionUrl(resume.id, version.id), { content })).body,
    );
    const after = saved.content.sections.find((s) => s.kind === 'experience')!.entries[0]!.bullets;
    expect(after[0]?.origin).toBe('edited');
    expect(after.at(-1)?.origin).toBe('added');
    expect(saved.contentHash).not.toBe(version.contentHash);
  });

  it('invented numbers, a changed title and seniority words are errors; unknown tools are warnings', async () => {
    const { resume, version } = await generate();
    const content = structuredClone(version.content);
    const exp = content.sections.find((s) => s.kind === 'experience')!;
    exp.entries[0]!.heading = 'Analista de Suporte Sênior';
    exp.entries[0]!.bullets[0]!.text = 'Atendimento a 900 clientes com Kubernetes.';
    const saved = parseVersion(
      (await a.client.put(versionUrl(resume.id, version.id), { content })).body,
    );
    const codes = saved.issues.map((i) => `${i.severity}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'error:UNSUPPORTED_NUMBER',
        'error:TITLE_MISMATCH',
        'error:SENIORITY_CLAIM',
        'warning:UNSUPPORTED_TERM',
      ]),
    );
    const approve = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(approve.status).toBe(409);
    expect((approve.body as { error: { code: string } }).error.code).toBe('RESUME_INVALID');
  });

  it('rejects content that breaks the contract', async () => {
    const { resume, version } = await generate();
    const broken = { ...version.content, schemaVersion: 1 };
    expect(
      (await a.client.put(versionUrl(resume.id, version.id), { content: broken })).status,
    ).toBe(400);
  });
});

describe('approval and versions', () => {
  it('approves a valid draft, freezes it (API and database) and edits go through a new draft', async () => {
    const { resume, version } = await generate();
    const approve = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect(approve.status, JSON.stringify(approve.body).slice(0, 300)).toBe(200);
    const approved = parseVersion(approve.body);
    expect(approved).toMatchObject({ status: 'approved' });

    const again = await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect((again.body as { error: { code: string } }).error.code).toBe('VERSION_APPROVED');
    const put = await a.client.put(versionUrl(resume.id, version.id), {
      content: approved.content,
    });
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
  });

  it('an approved version is checked against the base it was approved on, not the current one', async () => {
    const { resume, version } = await generate();
    expect((await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {})).status).toBe(
      200,
    );
    // Change the base: the "120" disappears from it.
    await seedBase(a.client, BASE_CV.replace('120 clientes', 'clientes'), BASE_PROFILE);
    try {
      const approved = parseVersion((await a.client.get(versionUrl(resume.id, version.id))).body);
      expect(approved.issues.filter((i) => i.severity === 'error')).toEqual([]);
      // A new draft is checked against the base as it is now.
      const copy = parseVersion(
        (await a.client.post(`/api/resumes/${resume.id}/versions`, { fromVersionId: version.id }))
          .body,
      );
      expect(copy.issues.map((i) => i.code)).toContain('UNSUPPORTED_NUMBER');
    } finally {
      await seedBase(a.client);
    }
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
  });

  it('deleting the job removes its evaluations and resumes, even approved ones', async () => {
    const { job, resume, version } = await generate();
    await a.client.post(`${versionUrl(resume.id, version.id)}/approve`, {});
    expect((await a.client.delete(`/api/jobs/${job.id}`)).status).toBe(200);
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
    expect(xml).toContain('ana.contato@example.test');
    expect(xml).not.toMatch(/Kubernetes/);
  });

  it('downloads HTML in the modern template by default and in the classic one on request', async () => {
    const { resume, version } = await approved();
    const modern = await a.client.request(
      'get',
      exportUrl(resume.id, version.id, 'html'),
      undefined,
      { binary: true },
    );
    expect(modern.status).toBe(200);
    expect(modern.headers['content-type']).toContain('text/html');
    expect(modern.headers['content-disposition']).toMatch(
      /^attachment; filename="Ana-Teste_Dev_Acme_\d{8}\.html"$/,
    );
    expect(modern.headers['x-content-type-options']).toBe('nosniff');
    const modernHtml = (modern.body as Buffer).toString('utf8');
    expect(modernHtml).toContain('class="header-gradient"');
    expect(modernHtml).toContain('Criou APIs REST em Node.js.');
    // Only the document body: the stylesheet legitimately contains values such as "40%".
    expect(modernHtml.split('</style>')[1] ?? '').not.toMatch(/<script/);

    const classic = await a.client.request(
      'get',
      `${exportUrl(resume.id, version.id, 'html')}&template=classic`,
      undefined,
      { binary: true },
    );
    expect(classic.status).toBe(200);
    const classicHtml = (classic.body as Buffer).toString('utf8');
    expect(classicHtml).toContain('<h1>Ana Teste</h1>');
    expect(classicHtml).not.toContain('header-gradient');

    const unknown = await a.client.get(`${exportUrl(resume.id, version.id, 'html')}&template=neon`);
    expect(unknown.status).toBe(400);
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
