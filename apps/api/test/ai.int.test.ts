import type { AiProvider, CompletionRequest } from '@chameleon/ai';
import {
  aiStatusResponseSchema,
  createResumeResponseSchema,
  jobAnalysisSchema,
  jobResponseSchema,
  runAnalysisResponseSchema,
} from '@chameleon/contracts';
import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiService } from '../src/ai/service';
import { buildTestApp, createTwoAccounts, type TestAccount } from './helpers';

const confirmed = { status: 'confirmed' };

const profileDocument = {
  schema_version: '2.1.0',
  profile: {
    identity: { full_name: 'Ana Teste', city: 'Curitiba' },
    contact_points: [
      { id: 'email-1', kind: 'email', value: 'ana.contato@example.test', visibility: 'public' },
      { id: 'phone-1', kind: 'phone', value: '+55 41 99999-0000', visibility: 'public' },
    ],
    statements: [{ id: 'sum-1', kind: 'short_summary', text: 'Resumo base.', meta: confirmed }],
    experiences: [
      {
        id: 'exp-1',
        official_title: 'Suporte Técnico',
        organization_name: 'Acme',
        start_date: '2025',
        end_date: 'present',
        meta: confirmed,
        items: [
          {
            id: 'item-ok',
            kind: 'responsibility',
            text: 'Triagem de incidentes em sistemas web.',
            meta: confirmed,
          },
          {
            id: 'item-secret',
            kind: 'achievement',
            text: 'Reduziu custos em 40%.',
            meta: { status: 'needs_review' },
          },
        ],
      },
    ],
    projects: [
      {
        id: 'prj-1',
        name: 'Painel de equipamentos',
        meta: confirmed,
        items: [
          {
            id: 'prj-item',
            kind: 'feature',
            text: 'APIs REST com Node.js e Express.',
            meta: confirmed,
          },
        ],
      },
    ],
    skills: [{ id: 'sk-node', name: 'Node.js', category: 'tool', meta: confirmed }],
    skill_usages: [
      {
        id: 'use-node',
        skill_id: 'sk-node',
        usage_context: 'project_experience',
        project_id: 'prj-1',
        meta: confirmed,
      },
    ],
  },
};

const JOB_TEXT =
  'Vaga\n\nRequisitos\n- Conhecimentos básicos em back-end\n- Kubernetes em produção\n';

/** Finds the `F12` ref of the catalog line that contains `text`, in the user message of a request. */
function refIn(request: CompletionRequest, text: string): string {
  const user = request.messages.find((message) => message.role === 'user')?.content ?? '';
  const line = user
    .split('\n')
    .find((candidate) => /^F\d+\|/.test(candidate) && candidate.includes(text));
  if (line === undefined) throw new Error(`no catalog line with "${text}"`);
  return line.split('|')[0]!;
}

interface Scripted extends AiProvider {
  requests: CompletionRequest[];
  mode: 'ok' | 'quota';
}

function scriptedProvider(): Scripted {
  const provider: Scripted = {
    requests: [],
    mode: 'ok',
    spec: {
      id: 'fake',
      label: 'Fake',
      baseUrl: 'https://fake.example.test/v1',
      model: 'fake-model',
      apiKey: 'k',
      dailyRequests: 50,
      jsonMode: true,
      timeoutMs: 1000,
    },
    complete(request) {
      provider.requests.push(request);
      if (provider.mode === 'quota') {
        return Promise.reject(
          Object.assign(new Error('quota'), { name: 'AiProviderError', kind: 'quota' }),
        );
      }
      const system = request.messages[0]?.content ?? '';
      const text = system.includes('compare ONE job posting')
        ? JSON.stringify({
            requirements: [
              {
                text: 'Conhecimentos básicos em back-end',
                importance: 'mandatory',
                keywords: ['back-end'],
                facts: [{ ref: refIn(request, 'Node.js'), relation: 'related' }],
              },
              {
                text: 'Kubernetes em produção',
                importance: 'mandatory',
                keywords: ['Kubernetes'],
                facts: [],
              },
            ],
          })
        : JSON.stringify({
            headline: 'Desenvolvedor Backend Júnior | Node.js',
            summary: {
              text: 'Profissional de suporte técnico com projeto de APIs REST em Node.js e Express.',
              refs: [refIn(request, 'Triagem'), refIn(request, 'APIs REST')],
            },
            skills: [refIn(request, 'Node.js')],
            experience: [
              { ref: refIn(request, 'Suporte Técnico @'), items: [refIn(request, 'Triagem')] },
            ],
            projects: [{ ref: refIn(request, 'Painel'), items: [refIn(request, 'APIs REST')] }],
          });
      return Promise.resolve({
        text,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        provider: 'fake',
        model: 'fake-model',
      });
    },
  };
  return provider;
}

let testDb: TestDb;
let a: TestAccount;
let b: TestAccount;
const provider = scriptedProvider();

async function seedProfile(client: TestAccount['client']): Promise<void> {
  const preview = await client.post('/api/profile/imports/preview', {
    text: JSON.stringify(profileDocument),
  });
  expect(preview.status).toBe(201);
  const importId = (preview.body as { importRecord: { id: string } }).importRecord.id;
  const applied = await client.post(`/api/profile/imports/${importId}/apply`, { mode: 'merge' });
  expect(applied.status).toBe(200);
  const idMap = (applied.body as { importRecord: { idMap: Record<string, string> } }).importRecord
    .idMap;
  const toConfirm = Object.entries(idMap)
    .filter(([local]) => local !== 'item-secret')
    .map(([, uuid]) => uuid);
  expect((await client.post('/api/profile/confirmations', { recordIds: toConfirm })).status).toBe(
    200,
  );
}

async function newJob(client = a.client): Promise<string> {
  const response = await client.post('/api/jobs', {
    description: JOB_TEXT,
    title: 'Dev',
    company: 'Acme',
  });
  expect(response.status).toBe(201);
  return jobResponseSchema.parse(response.body).job.id;
}

beforeAll(async () => {
  testDb = await createTestDb();
  const ai = createAiService({
    mode: 'auto',
    providers: [provider],
    limits: { totalDailyRequests: 100, totalDailyTokens: 100_000 },
  });
  const built = buildTestApp(testDb.db, { ai });
  ({ a, b } = await createTwoAccounts({ app: built.app, config: built.config, db: testDb.db }));
  await seedProfile(a.client);
}, 90_000);
afterAll(async () => {
  await testDb.drop();
});

describe('AI status and consent', () => {
  it('starts configured but not consented, so nothing is sent', async () => {
    const response = await a.client.get('/api/ai');
    expect(response.status).toBe(200);
    const status = aiStatusResponseSchema.parse(response.body);
    expect(status).toMatchObject({
      mode: 'auto',
      configured: true,
      consented: false,
      active: false,
    });
    expect(status.providers[0]).toMatchObject({ id: 'fake', consented: false });
  });

  it('without consent the analysis is local and the provider is never called', async () => {
    const jobId = await newJob();
    const response = await a.client.post(`/api/jobs/${jobId}/analysis`, {});
    expect(response.status).toBe(201);
    const { analysis } = runAnalysisResponseSchema.parse(response.body);
    expect(analysis?.result.engine).toBe('deterministic');
    expect(provider.requests).toHaveLength(0);
  });

  it('the consent is per owner: another account does not inherit it', async () => {
    expect((await a.client.put('/api/ai/consent', { granted: true })).status).toBe(200);
    const mine = aiStatusResponseSchema.parse((await a.client.get('/api/ai')).body);
    const theirs = aiStatusResponseSchema.parse((await b.client.get('/api/ai')).body);
    expect(mine).toMatchObject({ consented: true, active: true });
    expect(theirs).toMatchObject({ consented: false, active: false });
  });
});

describe('analysis and resume with AI', () => {
  let jobId: string;

  it('analyzes with the AI, records who answered, and never sends contacts, private items or ids', async () => {
    jobId = await newJob();
    const before = provider.requests.length;
    const response = await a.client.post(`/api/jobs/${jobId}/analysis`, {});
    expect(response.status).toBe(201);
    const { analysis } = runAnalysisResponseSchema.parse(response.body);
    expect(analysis?.result.engine).toBe('ai');
    expect(analysis?.result.ai).toEqual({
      provider: 'fake',
      model: 'fake-model',
      promptVersion: 'ai-an-1',
    });
    expect(provider.requests.length).toBe(before + 1);

    const sent = JSON.stringify(provider.requests.at(-1)?.messages);
    expect(sent).not.toMatch(/ana\.contato|99999|Ana Teste|Curitiba|Resumo base/);
    expect(sent).not.toContain('40%'); // needs_review fact
    expect(sent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/); // no record ids
    expect(sent).toContain('Kubernetes em produção'); // the job text is what the provider needs

    const requirements = analysis?.result.matches ?? [];
    // The AI linked "back-end" to Node.js (a project fact): evidence, "partial" by the local rule.
    expect(requirements[0]?.strength).toBe('partial');
    expect(requirements[1]?.strength).toBe('absent');
  });

  it('reuses the stored AI analysis for the same inputs (no new call), and "force" asks again', async () => {
    const calls = provider.requests.length;
    const again = runAnalysisResponseSchema.parse(
      (await a.client.post(`/api/jobs/${jobId}/analysis`, {})).body,
    );
    expect(again.reused).toBe(true);
    expect(provider.requests.length).toBe(calls);
    const forced = await a.client.post(`/api/jobs/${jobId}/analysis`, { force: true });
    expect([200, 201]).toContain(forced.status);
    expect(provider.requests.length).toBe(calls + 1);
  });

  it('tailors the resume with the AI and keeps every line sourced and valid', async () => {
    const response = await a.client.post(`/api/jobs/${jobId}/resumes`, {});
    expect(response.status).toBe(201);
    const created = createResumeResponseSchema.parse(response.body);
    expect(created.notes.join(' ')).toMatch(/Redigido com IA \(fake, fake-model\)/);
    const content = created.version.content;
    expect(content.header.headline).toBe('Desenvolvedor Backend Júnior | Node.js');
    const summary = content.sections.find((s) => s.kind === 'summary')?.entries[0];
    expect(summary?.bullets[0]?.text).toMatch(/APIs REST em Node\.js/);
    expect(summary?.bullets[0]?.sourceIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(content)).not.toContain('40%');
    expect(created.version.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('writes counts only to the audit trail (no prompt, no profile text)', async () => {
    const rows = await testDb.sql<{ action: string; metadata: unknown }>(
      `SELECT action, metadata FROM "AuditEvent" WHERE action IN ('ai.usage', 'job.analyze', 'resume.create')`,
    );
    const usage = rows.rows.filter((row) => row.action === 'ai.usage');
    expect(usage.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows.rows);
    expect(dump).not.toMatch(/Triagem|Kubernetes|ana\.contato|99999|Node\.js e Express/);
    expect(dump).toContain('fake-model');
  });

  it('shows today usage against the caps', async () => {
    const status = aiStatusResponseSchema.parse((await a.client.get('/api/ai')).body);
    expect(status.usageToday.requests).toBeGreaterThanOrEqual(3);
    expect(status.usageToday.tokens).toBeGreaterThanOrEqual(450);
    expect(status.limits).toEqual({ totalDailyRequests: 100, totalDailyTokens: 100_000 });
  });
});

describe('silent fallback', () => {
  it('when the provider fails (quota) the analysis and the resume still work, locally, with no error', async () => {
    provider.mode = 'quota';
    const jobId = await newJob();
    const analysis = await a.client.post(`/api/jobs/${jobId}/analysis`, {});
    expect(analysis.status).toBe(201);
    const parsed = jobAnalysisSchema.parse((analysis.body as { analysis: unknown }).analysis);
    expect(parsed.result.engine).toBe('deterministic');
    expect(parsed.result.warnings.join(' ')).toMatch(/A IA não respondeu agora/);

    const resume = await a.client.post(`/api/jobs/${jobId}/resumes`, {});
    expect(resume.status).toBe(201);
    const created = createResumeResponseSchema.parse(resume.body);
    expect(created.notes.join(' ')).toMatch(/texto original dos seus registros/);
    expect(created.version.content.sections.length).toBeGreaterThan(0);
    provider.mode = 'ok';
  });

  it('after the consent is withdrawn the provider is not called again', async () => {
    expect((await a.client.put('/api/ai/consent', { granted: false })).status).toBe(200);
    const calls = provider.requests.length;
    const jobId = await newJob();
    expect((await a.client.post(`/api/jobs/${jobId}/analysis`, {})).status).toBe(201);
    expect((await a.client.post(`/api/jobs/${jobId}/resumes`, {})).status).toBe(201);
    expect(provider.requests.length).toBe(calls);
  });
});
