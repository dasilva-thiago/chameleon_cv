import {
  aiStatusResponseSchema,
  analysisStateResponseSchema,
  jobResponseSchema,
  listJobsResponseSchema,
  runAnalysisResponseSchema,
} from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiService } from '../src/ai/service';
import {
  BASE_PROFILE,
  JOB_TEXT,
  buildTestApp,
  createTwoAccounts,
  scriptedProvider,
  seedBase,
  type TestAccount,
} from './helpers';

let testDb: TestDb;
let a: TestAccount;
let b: TestAccount;
const provider = scriptedProvider();

async function newJob(client = a.client, description = JOB_TEXT): Promise<string> {
  const response = await client.post('/api/jobs', { description, title: 'Dev', company: 'Acme' });
  expect(response.status).toBe(201);
  return jobResponseSchema.parse(response.body).job.id;
}

const evaluate = (jobId: string, force = false, client = a.client) =>
  client.post(`/api/jobs/${jobId}/analysis`, { force });

beforeAll(async () => {
  testDb = await createTestDb();
  const ai = createAiService({
    mode: 'auto',
    providers: [provider],
    limits: { totalDailyRequests: 1000, totalDailyTokens: 1_000_000 },
  });
  const built = buildTestApp(testDb.db, { ai });
  ({ a, b } = await createTwoAccounts({ app: built.app, config: built.config, db: testDb.db }));
  await seedBase(a.client);
  await seedBase(b.client);
}, 90_000);
afterAll(async () => {
  await testDb.drop();
});

describe('AI status and consent', () => {
  it('starts configured but not consented, so the evaluation is refused and nothing is sent', async () => {
    const status = aiStatusResponseSchema.parse((await a.client.get('/api/ai')).body);
    expect(status).toMatchObject({ configured: true, active: false });
    const response = await evaluate(await newJob());
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('AI_REQUIRED');
    expect(provider.requests).toHaveLength(0);
  });

  it('the consent is per owner: another account does not inherit it', async () => {
    expect((await a.client.put('/api/ai/consent', { granted: true })).status).toBe(200);
    const statusB = aiStatusResponseSchema.parse((await b.client.get('/api/ai')).body);
    expect(statusB.active).toBe(false);
  });
});

describe('evaluation (career-ops flow)', () => {
  it('evaluates with two calls, checks the answer and records counts only', async () => {
    const jobId = await newJob();
    const before = provider.requests.length;
    const response = await evaluate(jobId);
    expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(201);
    const { analysis, reused, stale } = runAnalysisResponseSchema.parse(response.body);
    expect(reused).toBe(false);
    expect(stale).toBe(false);
    expect(provider.requests.length - before).toBe(2);
    const result = analysis!.result;
    expect(result).toMatchObject({ score: 4.1, verdict: { recommendation: 'apply' } });
    expect(result.matches.find((m) => m.requirementId === 'r1')).toMatchObject({
      match: 'strong',
      evidenceVerified: true,
    });
    expect(result.salary).toMatchObject({ min: 3000, max: 3500 });
    // The first call sees only the posting; no call ever sees contact details.
    const [extract, judge] = provider.requests.slice(before);
    expect(JSON.stringify(extract!.messages)).not.toContain('Triagem de incidentes');
    expect(JSON.stringify(judge!.messages)).toContain('Triagem de incidentes');
    for (const request of provider.requests) {
      expect(JSON.stringify(request.messages)).not.toMatch(/ana\.contato@example\.test|99999-0000/);
    }
    const job = jobResponseSchema.parse((await a.client.get(`/api/jobs/${jobId}`)).body).job;
    expect(job.status).toBe('analyzed');
    const audit = await testDb.sql<{ metadata: unknown }>(
      `SELECT metadata FROM "AuditEvent" WHERE action = 'job.evaluate'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toMatch(/Triagem|Node\.js é obrigatório|Ana Teste/);
  });

  it('reuses the stored evaluation for the same inputs; "force" asks again', async () => {
    const jobId = await newJob();
    await evaluate(jobId);
    const calls = provider.requests.length;
    const again = runAnalysisResponseSchema.parse((await evaluate(jobId)).body);
    expect(again.reused).toBe(true);
    expect(provider.requests.length).toBe(calls);
    const forced = runAnalysisResponseSchema.parse((await evaluate(jobId, true)).body);
    expect(forced.reused).toBe(false);
    expect(provider.requests.length).toBe(calls + 2);
  });

  it('the job list carries the latest evaluation (score, recommendation, evidence rail) and its staleness', async () => {
    const jobId = await newJob();
    const before = listJobsResponseSchema.parse((await a.client.get('/api/jobs?status=all')).body);
    expect(before.jobs.find((job) => job.id === jobId)?.evaluation).toBeNull();
    const run = runAnalysisResponseSchema.parse((await evaluate(jobId)).body);
    const result = run.analysis?.result;
    expect(result).toBeDefined();
    const listed = listJobsResponseSchema.parse((await a.client.get('/api/jobs?status=all')).body);
    const summary = listed.jobs.find((job) => job.id === jobId)?.evaluation;
    expect(summary).toMatchObject({
      score: result?.score,
      recommendation: result?.verdict.recommendation,
      stale: false,
    });
    const total = Object.values(summary?.rail ?? {}).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(result?.matches.length);
    // Another account never sees it.
    const foreign = listJobsResponseSchema.parse((await b.client.get('/api/jobs?status=all')).body);
    expect(foreign.jobs.some((job) => job.id === jobId)).toBe(false);
  });

  it('when only the base changes, the evaluation is stale and re-running skips the posting call', async () => {
    const jobId = await newJob();
    await evaluate(jobId);
    await seedBase(a.client, undefined, `${BASE_PROFILE}\n- Nova regra.\n`);
    const state = analysisStateResponseSchema.parse(
      (await a.client.get(`/api/jobs/${jobId}/analysis`)).body,
    );
    expect(state).toMatchObject({ stale: true, staleBecause: ['profile'] });
    const extracts = provider.calls('extract');
    const evaluations = provider.calls('evaluate');
    expect((await evaluate(jobId)).status).toBe(201);
    expect(provider.calls('extract')).toBe(extracts);
    expect(provider.calls('evaluate')).toBe(evaluations + 1);
  });

  it('when no provider answers: 503 AI_UNAVAILABLE and nothing is stored', async () => {
    const jobId = await newJob(a.client, `${JOB_TEXT}\n- Outra linha`);
    provider.mode = 'quota';
    try {
      const response = await evaluate(jobId);
      expect(response.status).toBe(503);
      expect((response.body as { error: { code: string } }).error.code).toBe('AI_UNAVAILABLE');
      const state = analysisStateResponseSchema.parse(
        (await a.client.get(`/api/jobs/${jobId}/analysis`)).body,
      );
      expect(state.analysis).toBeNull();
    } finally {
      provider.mode = 'ok';
    }
  });

  it('after the consent is withdrawn the provider is not called again', async () => {
    expect((await a.client.put('/api/ai/consent', { granted: false })).status).toBe(200);
    const calls = provider.requests.length;
    const response = await evaluate(await newJob(a.client, `${JOB_TEXT}\n- Mais uma`));
    expect(response.status).toBe(409);
    expect(provider.requests.length).toBe(calls);
  });

  it('another account cannot read or run the evaluation of a foreign job (404)', async () => {
    const jobId = await newJob();
    expect((await b.client.get(`/api/jobs/${jobId}/analysis`)).status).toBe(404);
    expect((await evaluate(jobId, false, b.client)).status).toBe(404);
  });
});
