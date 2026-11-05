import { createHash } from 'node:crypto';
import {
  deleteJobResponseSchema,
  jobResponseSchema,
  listJobsResponseSchema,
  type JobDetail,
} from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRouteManifest } from '../src/http';
import { TestClient, buildTestApp, createTwoAccounts, type TestAccount } from './helpers';

let testDb: TestDb;
let a: TestAccount;
let b: TestAccount;
let built: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  testDb = await createTestDb();
  built = buildTestApp(testDb.db);
  ({ a, b } = await createTwoAccounts({ app: built.app, config: built.config, db: testDb.db }));
}, 60_000);
afterAll(async () => {
  await testDb.drop();
});

const GHOST = '00000000-0000-4000-8000-000000000000';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

async function create(client: TestClient, body: Record<string, unknown>): Promise<JobDetail> {
  const response = await client.post('/api/jobs', body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return jobResponseSchema.parse(response.body).job;
}

describe('jobs: create, read, edit, delete', () => {
  it('saves only the description, keeps the text byte-for-byte and returns a stable hash', async () => {
    const text =
      '  Vaga: Analista  \r\n\r\n• Experiência com TypeScript 🚀\n\n\tRequisitos:  Node  \n';
    const job = await create(a.client, { description: text });
    expect(job.description).toBe(text);
    expect(job.descriptionHash).toBe(sha256(text));
    expect(job).toMatchObject({
      title: null,
      company: null,
      url: null,
      status: 'saved',
      workMode: null,
      postedOn: null,
    });
    const reread = jobResponseSchema.parse((await a.client.get(`/api/jobs/${job.id}`)).body).job;
    expect(reread.description).toBe(text);
  });

  it('stores the optional metadata (blank strings become null) and normalizes the date', async () => {
    const job = await create(a.client, {
      description: 'Texto',
      title: ' Dev ',
      company: '',
      url: 'https://exemplo.test/vaga/1',
      location: 'Remoto',
      workMode: 'remote',
      postedOn: '2026-10-30',
      notes: '  ',
      status: 'analyzed',
    });
    expect(job).toMatchObject({
      title: 'Dev',
      company: null,
      url: 'https://exemplo.test/vaga/1',
      workMode: 'remote',
      postedOn: '2026-10-30',
      notes: null,
      status: 'analyzed',
    });
  });

  it('patch changes only the sent fields, null clears, a new text updates the hash, and the audit has no content', async () => {
    const job = await create(a.client, { description: 'Original', title: 'T1', company: 'ACME' });
    const response = await a.client.patch(`/api/jobs/${job.id}`, {
      title: null,
      status: 'application_sent',
      description: 'Novo texto',
    });
    expect(response.status).toBe(200);
    const edited = jobResponseSchema.parse(response.body).job;
    expect(edited).toMatchObject({
      title: null,
      company: 'ACME',
      status: 'application_sent',
      description: 'Novo texto',
      descriptionHash: sha256('Novo texto'),
    });
    expect(edited.descriptionHash).not.toBe(job.descriptionHash);

    const audit = await testDb.sql<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM "AuditEvent" WHERE "entityId" = $1 ORDER BY "at"`,
      [job.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['job.create', 'job.update']);
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain('Novo texto');
    expect(serialized).not.toContain('ACME');
    expect(audit.rows[1]?.metadata).toEqual({
      fields: ['description', 'descriptionHash', 'status', 'title'],
    });
  });

  it('unchanged text keeps the hash; an empty patch is a validation error', async () => {
    const job = await create(a.client, { description: 'Igual' });
    const same = await a.client.patch(`/api/jobs/${job.id}`, { description: 'Igual', notes: 'n' });
    expect(jobResponseSchema.parse(same.body).job.descriptionHash).toBe(job.descriptionHash);
    expect((await a.client.patch(`/api/jobs/${job.id}`, {})).status).toBe(400);
  });

  it('delete removes the job and a second delete is a 404', async () => {
    const job = await create(a.client, { description: 'Apagar' });
    const deleted = await a.client.delete(`/api/jobs/${job.id}`);
    expect(deleteJobResponseSchema.parse(deleted.body)).toEqual({ deleted: true, id: job.id });
    expect((await a.client.get(`/api/jobs/${job.id}`)).status).toBe(404);
    expect((await a.client.delete(`/api/jobs/${job.id}`)).status).toBe(404);
  });
});

describe('jobs: validation', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['empty description', { description: '' }],
    ['blank description', { description: '   \n  ' }],
    ['missing description', { title: 'x' }],
    ['description over the limit', { description: 'a'.repeat(30_001) }],
    ['NUL in the description', { description: 'a\u0000b' }],
    ['non-http url', { description: 'x', url: 'javascript:alert(1)' }],
    ['url with credentials', { description: 'x', url: 'https://user:pw@exemplo.test/' }],
    ['malformed url', { description: 'x', url: 'not a url' }],
    ['impossible date', { description: 'x', postedOn: '2026-02-30' }],
    ['unknown work mode', { description: 'x', workMode: 'office' }],
    ['unknown status', { description: 'x', status: 'hired' }],
    ['unknown key (mass assignment)', { description: 'x', ownerId: GHOST }],
    ['unknown key descriptionHash', { description: 'x', descriptionHash: 'a'.repeat(64) }],
    ['title too long', { description: 'x', title: 'a'.repeat(201) }],
  ];
  it.each(bad)('rejects %s with 400 VALIDATION_ERROR', async (_label, body) => {
    const response = await a.client.post('/api/jobs', body);
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('does not echo the rejected value back in the error', async () => {
    const response = await a.client.post('/api/jobs', {
      description: 'x',
      url: 'javascript:SECRET-VALUE',
    });
    expect(JSON.stringify(response.body)).not.toContain('SECRET-VALUE');
  });

  it('a malformed id is a 404 like a missing one', async () => {
    expect((await a.client.get('/api/jobs/not-a-uuid')).status).toBe(404);
    expect((await a.client.get(`/api/jobs/${GHOST}`)).status).toBe(404);
  });
});

describe('jobs: listing, filters and search', () => {
  let c: TestAccount;
  beforeAll(async () => {
    const { createTestAccount } = await import('./helpers');
    c = await createTestAccount(
      { app: built.app, config: built.config, db: testDb.db },
      { email: 'lista@example.test' },
    );
    await create(c.client, { description: 'Backend em Go', title: 'Engenheiro', company: 'Alfa' });
    await create(c.client, {
      description: 'Frontend com React',
      title: 'Dev Web',
      company: 'Beta',
      status: 'interview',
    });
    await create(c.client, { description: 'Dados e SQL', company: 'Gama', status: 'archived' });
    await create(c.client, { description: 'Mobile', company: 'Delta', status: 'closed' });
  });

  const list = async (query = '') =>
    listJobsResponseSchema.parse((await c.client.get(`/api/jobs${query}`)).body);

  it('defaults to the active jobs and always counts everything by status', async () => {
    const result = await list();
    expect(result.jobs.map((j) => j.company).sort()).toEqual(['Alfa', 'Beta']);
    expect(result.counts).toMatchObject({
      total: 4,
      active: 2,
      byStatus: { saved: 1, interview: 1, archived: 1, closed: 1, analyzed: 0 },
    });
  });

  it('filters by one status or all, and lists without the full text', async () => {
    expect((await list('?status=archived')).jobs.map((j) => j.company)).toEqual(['Gama']);
    expect((await list('?status=all')).jobs).toHaveLength(4);
    const first = (await list('?status=all')).jobs[0] as Record<string, unknown>;
    expect(first).not.toHaveProperty('description');
    expect(first).toHaveProperty('excerpt');
  });

  it('searches company, title, location and text case-insensitively, and escapes wildcards', async () => {
    expect((await list('?status=all&q=REACT')).jobs.map((j) => j.company)).toEqual(['Beta']);
    expect((await list('?status=all&q=alfa')).jobs).toHaveLength(1);
    expect((await list('?status=all&q=%25')).jobs).toHaveLength(0);
    expect((await list('?status=all&q=_')).jobs).toHaveLength(0);
  });

  it('rejects an unknown status filter and an oversized limit', async () => {
    expect((await c.client.get('/api/jobs?status=hired')).status).toBe(400);
    expect((await c.client.get('/api/jobs?limit=5000')).status).toBe(400);
  });
});

describe('jobs: ownership', () => {
  it('another account cannot read, edit or delete a job and sees the same 404 as for a missing id', async () => {
    const job = await create(a.client, { description: 'Segredo do dono A', company: 'Privada' });
    const missing = await b.client.get(`/api/jobs/${GHOST}`);
    for (const response of [
      await b.client.get(`/api/jobs/${job.id}`),
      await b.client.patch(`/api/jobs/${job.id}`, { status: 'archived' }),
      await b.client.delete(`/api/jobs/${job.id}`),
    ]) {
      expect(response.status).toBe(404);
      const { requestId: _a, ...crossed } = (response.body as { error: Record<string, unknown> })
        .error;
      const { requestId: _b, ...absent } = (missing.body as { error: Record<string, unknown> })
        .error;
      expect(crossed).toEqual(absent);
    }
    const still = jobResponseSchema.parse((await a.client.get(`/api/jobs/${job.id}`)).body).job;
    expect(still.status).toBe('saved');

    const listB = JSON.stringify((await b.client.get('/api/jobs?status=all&q=Privada')).body);
    expect(listB).not.toContain('Segredo');
    expect(listB).not.toContain('Privada');
  });

  it('a request cannot choose the owner: the row belongs to the caller', async () => {
    const forged = await b.client.post('/api/jobs', { description: 'x', ownerId: a.ownerId });
    expect(forged.status).toBe(400);
    const job = await create(b.client, { description: 'de B' });
    const row = await testDb.sql<{ ownerId: string }>(
      `SELECT "ownerId" FROM "JobPosting" WHERE id = $1`,
      [job.id],
    );
    expect(row.rows[0]?.ownerId).toBe(b.ownerId);
  });

  it('every jobs route requires a session', async () => {
    const anon = new TestClient(built.app, built.config);
    for (const route of getRouteManifest(built.app).filter((r) => r.path.startsWith('/api/jobs'))) {
      expect(route.auth).toBe('session');
      const path = route.path.replace(':jobId', GHOST);
      const response = await anon.request(
        route.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete',
        path,
        route.mutating ? {} : undefined,
      );
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
  });
});
