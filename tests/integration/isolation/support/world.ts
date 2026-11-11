import { createHash, randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  PRIVATE_MODELS,
  TEST_PASSWORD,
  buildBaseResume,
  buildTestApp,
  createAiService,
  createTestAccount,
  createTwoAccounts,
  createTestDb,
  parseBaseCv,
  scriptedProvider,
  type ApiModule,
  type TestAccount,
  type TestApp,
  type TestDb,
} from './workspace';

export interface Actor extends TestAccount {
  label: string;
  baseId: string;
  /** Revisao atual da base (alvo dos ataques as rotas de revisao). */
  revisionId: string;
  jobId: string;
  analysisId: string;
  resumeId: string;
  versionId: string;
  /** Canarios deste dono (`CANARY-<label>-<onde>-<n>`), espalhados pela base, vaga e curriculo. */
  canaries: readonly string[];
}

/** O que identifica um dono para as varreduras (inclui o dono sem base, que nao tem canarios). */
export interface Identity {
  label: string;
  ownerId: string;
  email: string;
  canaries: readonly string[];
}

export interface World {
  testDb: TestDb;
  app: TestApp['app'];
  config: TestApp['config'];
  logs: TestApp['logs'];
  a: Actor;
  b: Actor;
  /** Mais donos com dados completos: mais canarios e mais linhas por tabela. */
  others: Actor[];
  /** A, B e `others`. */
  all: Actor[];
  /** Dono com dados completos usado como pai "alheio" nas provas de FK (um dos `others`). */
  coverage: Actor;
  /** Dono SEM base nem vagas. */
  bare: Identity;
  /** Todos os donos do mundo, para inventarios de vazamento. */
  everyone: Identity[];
  drop(): Promise<void>;
}

export interface WorldOptions {
  /** Modulos extras montados no app (ex.: rotas sinteticas de recurso para autotestes). */
  modules?: readonly ApiModule[];
}

/** Uma base sintetica com 20 canarios do dono (CV, perfil, vaga, curriculo). */
export function baseFor(label: string): { cv: string; profile: string; canaries: string[] } {
  const c = (where: string, n: number): string => `CANARY-${label}-${where}-${String(n)}`;
  const canaries: string[] = [];
  const keep = (value: string): string => {
    canaries.push(value);
    return value;
  };
  const cv = [
    `# CV -- Pessoa ${label}`,
    `**Headline:** Desenvolvedora ${keep(c('headline', 1))}`,
    '**Location:** Curitiba - PR',
    `**Email:** ${label}-contato@example.invalid`,
    '',
    '## Professional Summary',
    '',
    `Resumo com ${keep(c('summary', 1))} e ${keep(c('summary', 2))}.`,
    '',
    '## Work Experience',
    '',
    `### Empresa ${keep(c('company', 1))} — Curitiba - PR`,
    '',
    '**Suporte Técnico**',
    '2025 - Atual',
    '',
    ...[1, 2, 3, 4, 5].map((n) => `- Atividade ${keep(c('bullet', n))}.`),
    '',
    '## Projects',
    '',
    `### Projeto ${keep(c('project', 1))}`,
    '',
    `- Detalhe ${keep(c('project', 2))}.`,
    '',
    '## Skills',
    '',
    `- **Backend:** Node.js, ${keep(c('skill', 1))}`,
    '',
  ].join('\n');
  const profile = [
    '## Alvos',
    ...[1, 2, 3, 4].map((n) => `- Alvo ${keep(c('target', n))}`),
    '',
    '## Salário',
    `- Faixa ${keep(c('salary', 1))}`,
    `- Regra ${keep(c('salary', 2))}`,
    '',
  ].join('\n');
  keep(c('job', 1));
  keep(c('resume', 1));
  return { cv, profile, canaries };
}

/** Distinct per owner, so a copied row never trips the (resumeId, versionNumber) unique before the FK. */
let nextVersionNumber = 1;

async function provision(testDb: TestDb, account: TestAccount, label: string): Promise<Actor> {
  const { cv, profile, canaries } = baseFor(label);
  const saved = await account.client.put('/api/profile', {
    cvMarkdown: cv,
    profileMarkdown: profile,
  });
  expect(saved.status, JSON.stringify(saved.body).slice(0, 200)).toBe(200);
  const revisionId = (saved.body as { base: { revisionId: string } }).base.revisionId;
  expect((await account.client.put('/api/ai/consent', { granted: true })).status).toBe(200);

  const scoped = testDb.db.forOwner(account.ownerId);
  const base = await scoped.profileBase.findFirstOrThrow({ select: { id: true } });
  const description = `Vaga do mundo de teste ${canaries.at(-2) ?? ''}`;
  const descriptionHash = createHash('sha256').update(description).digest('hex');
  const job = await scoped.jobPosting.create({
    data: { ownerId: account.ownerId, description, descriptionHash, company: `Empresa ${label}` },
  });
  const analysis = await scoped.jobAnalysis.create({
    data: {
      ownerId: account.ownerId,
      jobId: job.id,
      descriptionHash,
      profileHash: createHash('sha256').update(`base ${label}`).digest('hex'),
      engine: 'ai',
      engineVersion: 'test-1',
      result: { nota: `Avaliacao do mundo de teste ${label}` },
    },
  });
  const resume = await scoped.resume.create({
    data: { ownerId: account.ownerId, jobId: job.id, name: `Curriculo ${canaries.at(-1) ?? ''}` },
  });
  const content = buildBaseResume(parseBaseCv(cv), 'pt-BR');
  const version = await scoped.resumeVersion.create({
    data: {
      ownerId: account.ownerId,
      resumeId: resume.id,
      versionNumber: nextVersionNumber++,
      language: 'pt-BR',
      content,
      contentHash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
      profileRevisionId: revisionId,
      analysisId: analysis.id,
    },
  });
  return {
    ...account,
    label,
    baseId: base.id,
    revisionId,
    jobId: job.id,
    analysisId: analysis.id,
    resumeId: resume.id,
    versionId: version.id,
    canaries,
  };
}

/**
 * Par de contas DESCARTAVEL (A' e B'), com senhas DISTINTAS e dados completos, para casos que destroem sessoes
 * ou escrevem. Canarios proprios (rotulo do par), por isso nao entram em `world.everyone`.
 */
export async function createPair(world: World, label: string): Promise<{ a: Actor; b: Actor }> {
  const ctx = { app: world.app, config: world.config, db: world.testDb.db };
  const accountA = await createTestAccount(ctx, {
    email: `${label}-a@example.test`,
    password: `senha-correta-de-A-${label}-91827`,
  });
  const accountB = await createTestAccount(ctx, {
    email: `${label}-b@example.test`,
    password: `senha-correta-de-B-${label}-73645`,
  });
  return {
    a: await provision(world.testDb, accountA, `${label}-a`),
    b: await provision(world.testDb, accountB, `${label}-b`),
  };
}

const identityOf = (actor: Actor): Identity => ({
  label: actor.label,
  ownerId: actor.ownerId,
  email: actor.email,
  canaries: actor.canaries,
});

/**
 * Mundo da suite: banco clonado, app completo (com LogCapture e um provedor de IA simulado), A e B pelo fluxo
 * real convite -> aceite, mais tres donos com dados completos e um dono sem base.
 */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const testDb = await createTestDb();
  const ai = createAiService({
    mode: 'auto',
    providers: [scriptedProvider()],
    limits: { totalDailyRequests: 10_000, totalDailyTokens: 10_000_000 },
  });
  const { app, config, logs } = buildTestApp(testDb.db, {
    ai,
    ...(options.modules ? { modules: options.modules } : {}),
  });
  const ctx = { app, config, db: testDb.db };

  const { a: accountA, b: accountB } = await createTwoAccounts(ctx);
  const a = await provision(testDb, accountA, 'dono-a');
  const b = await provision(testDb, accountB, 'dono-b');
  const others: Actor[] = [];
  for (const index of [1, 2, 3]) {
    const account = await createTestAccount(ctx, {
      email: `dono-${String(index).padStart(2, '0')}@example.test`,
      displayName: `Dono ${String(index)}`,
    });
    others.push(await provision(testDb, account, `dono-${String(index)}`));
  }
  const bareAccount = await createTestAccount(ctx, { email: 'vazio@example.test' });

  await testDb.db.forOwner(a.ownerId).auditEvent.create({
    data: {
      ownerId: a.ownerId,
      action: 'test.event',
      entityType: 'ProfileBase',
      entityId: a.baseId,
      correlationId: randomUUID(),
      metadata: { note: 'sem PII' },
    },
  });

  const all = [a, b, ...others];
  const bare: Identity = {
    label: 'bare',
    ownerId: bareAccount.ownerId,
    email: bareAccount.email,
    canaries: [],
  };
  return {
    testDb,
    app,
    config,
    logs,
    a,
    b,
    others,
    all,
    coverage: others[0]!,
    bare,
    everyone: [...all.map(identityOf), bare],
    drop: () => testDb.drop(),
  };
}

// ---------------------------------------------------------------------------
// Inventario de "coisas que so o dono pode ver"
// ---------------------------------------------------------------------------

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);
export const delegateName = (model: string): string => lowerFirst(model);

/** Todos os ids (UUID) das linhas privadas de um dono, por SQL cru: sao identificadores que nao podem vazar. */
export async function privateRowIds(world: World, ownerId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const model of PRIVATE_MODELS) {
    const { rows } = await world.testDb.sql<{ id: string }>(
      `SELECT "id"::text AS id FROM "${model}" WHERE "ownerId" = $1`,
      [ownerId],
    );
    for (const row of rows) ids.add(row.id);
  }
  return [...ids];
}

export { TEST_PASSWORD };
