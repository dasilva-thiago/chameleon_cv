import { expect } from 'vitest';
import { listRecords } from '../../../packages/contracts/src';
import type { CaseInfo } from './support/gate';
import type { CrossCaseContext } from './support/context';
import { expectNoLeaks, forbiddenFor, type Forbidden } from './support/leaks';
import {
  type AuthSessionResponse,
  type TestClient,
  TEST_SIGNUP_CONSENTS,
  createInvite,
  generateToken,
  hashToken,
  PRIVATE_MODELS,
  type TestResponse,
} from './support/workspace';
import { delegateName, type Actor, type World } from './support/world';

/**
 * Casos cruzados HTTP (ADR-0008 item 5b). Cada caso declara as rotas que exercita (`routes`) e o gate
 * (route-gate.test.ts) exige que TODA rota nao trivial do manifesto aponte para um caso daqui; o
 * http-cross-owner.test.ts executa todos e confere que cada rota declarada foi realmente atingida.
 *
 * Como adicionar um caso quando surgir uma rota nova: ver README.md desta pasta.
 */
export interface CrossCase extends CaseInfo {
  description: string;
  run(ctx: CrossCaseContext): Promise<void>;
}

type Body = Record<string, unknown>;
const bodyOf = (response: TestResponse): Body => response.body as Body;

/** Corpo de erro sem o `requestId` (varia por requisicao): o resto deve ser identico entre casos. */
function errorShape(response: TestResponse): unknown {
  const error = (bodyOf(response).error ?? {}) as Record<string, unknown>;
  const { requestId: _ignored, ...rest } = error;
  return { status: response.status, error: rest };
}

const setCookies = (response: TestResponse): string[] => {
  const raw = response.headers['set-cookie'] as string[] | string | undefined;
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
};

/** O que identifica `other` (e que `viewer` nunca pode receber): dados de perfil, ids e credenciais vivas. */
async function secretsOf(world: World, viewer: Actor, other: Actor): Promise<Forbidden[]> {
  // O observador pode ler os PROPRIOS dados (inclusive canarios de fixture iguais aos do par): retire-os.
  const mine = new Set(
    [...viewer.canaries, viewer.email, viewer.ownerId].map((v) => v.toLowerCase()),
  );
  const base = (await forbiddenFor(world, viewer)).filter(
    (item) => !mine.has(item.needle.toLowerCase()),
  );
  const own: Forbidden[] = [
    ...other.canaries.map((needle) => ({ label: `canario ${other.fixtureId} (par)`, needle })),
    { label: `e-mail de ${other.fixtureId} (par)`, needle: other.email },
    { label: `ownerId de ${other.fixtureId} (par)`, needle: other.ownerId },
    { label: 'senha do par', needle: other.password },
  ];
  if (other.client.sessionToken) {
    own.push({ label: 'sessao do par', needle: other.client.sessionToken });
    own.push({ label: 'hash da sessao do par', needle: hashToken(other.client.sessionToken) });
  }
  if (other.client.csrfToken) own.push({ label: 'csrf do par', needle: other.client.csrfToken });
  const rowIds = await world.testDb.sql<{ id: string }>(
    `SELECT id::text AS id FROM "ProfileFact" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "ProfessionalProfile" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "ProfileRevision" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "ImportRecord" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "Session" WHERE "ownerId" = $1::uuid`,
    [other.ownerId],
  );
  for (const row of rowIds.rows) own.push({ label: `id de linha do par`, needle: row.id });
  return [...base, ...own];
}

/**
 * Everything an owner's profile surface holds, in an order-independent form (no physical row order, so
 * autovacuum or HEAP updates between two reads cannot make it flap): the document, revisions, imports and the
 * row count of every private model.
 */
async function stableState(world: World, owner: Actor): Promise<unknown> {
  const scoped = world.testDb.db.forOwner(owner.ownerId) as unknown as Record<
    string,
    { count(): Promise<number> }
  >;
  const counts: Record<string, number> = {};
  for (const model of PRIVATE_MODELS)
    counts[model] = (await scoped[delegateName(model)]?.count()) ?? -1;
  return {
    document: (await world.store.loadProfileDocument(owner.ownerId))?.document,
    revisions: await world.store.listRevisions(owner.ownerId, { limit: 200 }),
    imports: await world.store.listImportRecords(owner.ownerId, { limit: 200 }),
    idMap: await world.store.getImportIdMap(owner.ownerId),
    counts,
  };
}

const activeSessions = async (world: World, ownerId: string): Promise<number> =>
  world.testDb.db.forOwner(ownerId).session.count({ where: { revokedAt: null } });

export const CROSS_CASES: Record<string, CrossCase> = {
  'resumes.api/cross-owner-behaves-like-not-found': {
    description:
      'P3/P4: B com os ids da vaga, do curriculo e da versao de A recebe o MESMO status e corpo que para ids ' +
      'inexistentes ou malformados em toda rota de curriculos (listar, ler, renomear, editar, aprovar, copiar, ' +
      'exportar, excluir); nada em A muda.',
    routes: [
      'POST /api/jobs/:jobId/resumes',
      'GET /api/jobs/:jobId/resumes',
      'GET /api/resumes/:resumeId',
      'PATCH /api/resumes/:resumeId',
      'DELETE /api/resumes/:resumeId',
      'GET /api/resumes/:resumeId/versions/:versionId',
      'PUT /api/resumes/:resumeId/versions/:versionId',
      'POST /api/resumes/:resumeId/versions/:versionId/approve',
      'GET /api/resumes/:resumeId/versions/:versionId/export',
      'POST /api/resumes/:resumeId/versions',
    ],
    async run(ctx) {
      const pair = await ctx.pair('resumes-api');
      const a = ctx.http(pair.a.client);
      const b = ctx.http(pair.b.client);
      const GHOST = '00000000-0000-4000-8000-000000000000';
      const CANARY = 'CANARY-RESUME-OF-A-5d1e2';

      const job = bodyOf(
        await a.post('/api/jobs', { description: `Vaga ${CANARY}`, company: CANARY }),
      );
      const jobId = (job.job as { id: string }).id;
      const created = await a.post(`/api/jobs/${jobId}/resumes`, {});
      expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
      const resumeId = (bodyOf(created).resume as { id: string }).id;
      const versionId = (bodyOf(created).version as { id: string; content: unknown }).id;
      const content = (bodyOf(created).version as { content: unknown }).content;
      // positive controls: the owner reads and lists its own
      expect((await a.get(`/api/resumes/${resumeId}`)).status).toBe(200);
      expect((await a.get(`/api/jobs/${jobId}/resumes`)).status).toBe(200);
      expect((await a.get(`/api/resumes/${resumeId}/versions/${versionId}`)).status).toBe(200);
      const copied = await a.post(`/api/resumes/${resumeId}/versions`, {
        fromVersionId: versionId,
      });
      expect(copied.status).toBe(201);

      const before = await stableState(ctx.world, pair.a);
      const beforeB = await stableState(ctx.world, pair.b);

      /** The victim ids in a URL, a missing id and garbage must be indistinguishable for B. */
      async function indistinguishable(
        label: string,
        request: (ids: { job: string; resume: string; version: string }) => Promise<TestResponse>,
      ): Promise<void> {
        const crossed = await request({ job: jobId, resume: resumeId, version: versionId });
        const ghost = await request({ job: GHOST, resume: GHOST, version: GHOST });
        const garbage = await request({ job: 'x', resume: 'x', version: 'x' });
        for (const response of [crossed, ghost, garbage]) ctx.observe(pair.b, response);
        expect(crossed.status, label).toBe(404);
        expect(errorShape(crossed), label).toEqual(errorShape(ghost));
        expect(errorShape(garbage), label).toEqual(errorShape(ghost));
        expect(crossed.headers['content-length'], label).toBe(ghost.headers['content-length']);
      }
      const versionPath = (i: { resume: string; version: string }): string =>
        `/api/resumes/${i.resume}/versions/${i.version}`;
      await indistinguishable('POST resume', (i) => b.post(`/api/jobs/${i.job}/resumes`, {}));
      await indistinguishable('GET resumes of job', (i) => b.get(`/api/jobs/${i.job}/resumes`));
      await indistinguishable('GET resume', (i) => b.get(`/api/resumes/${i.resume}`));
      await indistinguishable('PATCH resume', (i) =>
        b.patch(`/api/resumes/${i.resume}`, { name: 'CANARY-ATTACK-by-B' }),
      );
      await indistinguishable('GET version', (i) => b.get(versionPath(i)));
      await indistinguishable('PUT version', (i) => b.put(versionPath(i), { content }));
      await indistinguishable('approve', (i) => b.post(`${versionPath(i)}/approve`, {}));
      await indistinguishable('export docx', (i) => b.get(`${versionPath(i)}/export?format=docx`));
      await indistinguishable('export pdf', (i) => b.get(`${versionPath(i)}/export?format=pdf`));
      await indistinguishable('copy version', (i) =>
        b.post(`/api/resumes/${i.resume}/versions`, { fromVersionId: i.version }),
      );
      await indistinguishable('DELETE resume', (i) => b.delete(`/api/resumes/${i.resume}`));

      expect(await stableState(ctx.world, pair.a)).toEqual(before);
      expect(await stableState(ctx.world, pair.b)).toEqual(beforeB);
      const still = bodyOf(await a.get(`/api/resumes/${resumeId}`)).resume as {
        name: string;
        versions: unknown[];
      };
      expect(still.name).not.toContain('ATTACK');
      expect(still.versions).toHaveLength(2);
    },
  },

  'ai.api/status-and-consent-never-cross-owners': {
    description:
      'IA: o status e o consentimento sao sempre do proprio chamador. A conceder ou retirar o consentimento nao ' +
      'muda nada para B, e uma entrada invalida e um 400 (nunca um 500).',
    routes: ['GET /api/ai', 'PUT /api/ai/consent'],
    async run(ctx) {
      const pair = await ctx.pair('ai-api');
      const a = ctx.http(pair.a.client);
      const b = ctx.http(pair.b.client);

      const beforeB = await b.get('/api/ai');
      ctx.observe(pair.b, beforeB);
      expect(beforeB.status).toBe(200);

      for (const granted of [true, false]) {
        const response = await a.put('/api/ai/consent', { granted });
        ctx.observe(pair.a, response);
        expect(response.status).toBe(200);
      }
      const afterB = await b.get('/api/ai');
      ctx.observe(pair.b, afterB);
      expect(bodyOf(afterB)).toEqual(bodyOf(beforeB));

      const bad = await b.put('/api/ai/consent', { granted: 'yes' });
      ctx.observe(pair.b, bad);
      expect(bad.status).toBe(400);
    },
  },

  'jobs.api/cross-owner-behaves-like-not-found': {
    description:
      'P1: B com o id de uma vaga de A recebe o MESMO status e corpo que para um id inexistente ou malformado ' +
      '(ler, editar, excluir); a listagem e a busca de B nunca trazem a vaga de A e nada em A muda.',
    routes: [
      'GET /api/jobs',
      'POST /api/jobs',
      'GET /api/jobs/:jobId',
      'PATCH /api/jobs/:jobId',
      'DELETE /api/jobs/:jobId',
      'GET /api/jobs/:jobId/analysis',
      'POST /api/jobs/:jobId/analysis',
      'PATCH /api/jobs/:jobId/analysis/review',
    ],
    async run(ctx) {
      const pair = await ctx.pair('jobs-api');
      const a = ctx.http(pair.a.client);
      const b = ctx.http(pair.b.client);
      const GHOST = '00000000-0000-4000-8000-000000000000';
      const CANARY = 'CANARY-JOB-OF-A-7f3c9';

      const created = await a.post('/api/jobs', {
        description: `Vaga ${CANARY}`,
        company: CANARY,
        notes: CANARY,
      });
      expect(created.status).toBe(201);
      const victim = (bodyOf(created).job as { id: string }).id;
      expect((await a.get(`/api/jobs/${victim}`)).status).toBe(200);
      // A has an analysis (and a review) of its own job: positive control for the analysis routes
      expect((await a.post(`/api/jobs/${victim}/analysis`, {})).status).toBe(201);
      expect((await a.get(`/api/jobs/${victim}/analysis`)).status).toBe(200);

      const before = await stableState(ctx.world, pair.a);
      const beforeB = await stableState(ctx.world, pair.b);

      async function indistinguishable(
        label: string,
        request: (id: string) => Promise<TestResponse>,
      ): Promise<void> {
        const crossed = await request(victim);
        const ghost = await request(GHOST);
        const garbage = await request('nao-e-um-uuid');
        for (const response of [crossed, ghost, garbage]) ctx.observe(pair.b, response);
        expect(crossed.status, label).toBe(404);
        expect(errorShape(crossed), label).toEqual(errorShape(ghost));
        expect(errorShape(garbage), label).toEqual(errorShape(ghost));
        expect(crossed.headers['content-length'], label).toBe(ghost.headers['content-length']);
      }
      await indistinguishable('GET job', (id) => b.get(`/api/jobs/${id}`));
      await indistinguishable('PATCH job', (id) =>
        b.patch(`/api/jobs/${id}`, { status: 'archived', notes: 'CANARY-ATTACK-by-B' }),
      );
      await indistinguishable('DELETE job', (id) => b.delete(`/api/jobs/${id}`));
      await indistinguishable('GET analysis', (id) => b.get(`/api/jobs/${id}/analysis`));
      await indistinguishable('POST analysis', (id) => b.post(`/api/jobs/${id}/analysis`, {}));
      await indistinguishable('PATCH review', (id) =>
        b.patch(`/api/jobs/${id}/analysis/review`, {
          review: {
            excludedRecordIds: [],
            pinnedRecordIds: [],
            notes: { r1: 'CANARY-ATTACK-by-B' },
          },
        }),
      );

      // B cannot claim ownership at creation, and its list/search never shows A's job
      const forged = await b.post('/api/jobs', { description: 'x', ownerId: pair.a.ownerId });
      ctx.observe(pair.b, forged);
      expect(forged.status).toBe(400);
      for (const query of ['', '?status=all', `?status=all&q=${CANARY}`]) {
        const listed = await b.get(`/api/jobs${query}`);
        ctx.observe(pair.b, listed);
        expect(listed.status).toBe(200);
        expect(JSON.stringify(listed.body)).not.toContain(CANARY);
      }

      expect(await stableState(ctx.world, pair.a)).toEqual(before);
      // B only wrote its own audit rows/sessions; nothing of B's profile data changed
      expect(await stableState(ctx.world, pair.b)).toEqual(beforeB);
      // counts alone would not show an edit: A's job is exactly as left by A's own analysis (status moved by A, not by B)
      const still = bodyOf(await a.get(`/api/jobs/${victim}`)).job as Record<string, unknown>;
      expect(still).toMatchObject({ status: 'analyzed', notes: CANARY, company: CANARY });
    },
  },

  // ------------------------------------------------------------------------------------------
  'auth.me/session-never-crosses-owners': {
    description:
      'GET /api/auth/me: cada cookie identifica apenas o dono do token; token alheio, adulterado, hash, ' +
      'revogado, expirado, usuario desativado ou excluido -> 401; B nunca recebe dado de A.',
    routes: ['GET /api/auth/me'],
    async run(ctx) {
      const { world } = ctx;
      const [a, b] = [world.a, world.b];
      const clientA = ctx.http(a.client);
      const clientB = ctx.http(b.client);

      const meA = await clientA.get('/api/auth/me');
      const meB = await clientB.get('/api/auth/me');
      ctx.observe(b, meB);
      expect(meA.status).toBe(200);
      expect(meB.status).toBe(200);
      expect((meA.body as AuthSessionResponse).user).toMatchObject({
        id: a.ownerId,
        email: a.email,
      });
      expect((meB.body as AuthSessionResponse).user).toMatchObject({
        id: b.ownerId,
        email: b.email,
      });
      expectNoLeaks('GET /me como B', ctx.observedBy(b), await secretsOf(world, b, a));

      // Cookie de sessao de A + cookie/cabecalho CSRF de B: a identidade e a do TOKEN DE SESSAO (A).
      const mixed = ctx.anonymous();
      mixed.setCookie(mixed.sessionCookieName, a.client.sessionToken ?? '');
      mixed.setCookie(mixed.csrfCookieName, b.client.csrfToken ?? '');
      const mixedMe = await mixed.get('/api/auth/me');
      expect((mixedMe.body as AuthSessionResponse).user.id).toBe(a.ownerId);

      // Variantes invalidas: todas 401 com o MESMO corpo (sem oraculo sobre qual token existe).
      const stored = await world.testDb.db
        .forOwner(a.ownerId)
        .session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      const tokenOfA = a.client.sessionToken ?? '';
      const flipped = tokenOfA.slice(0, -1) + (tokenOfA.endsWith('A') ? 'B' : 'A');
      const variants: [string, string | null][] = [
        ['sem cookie', null],
        ['hash armazenado como se fosse o token', stored.tokenHash],
        ['token de A adulterado em 1 caractere', flipped],
        ['token aleatorio bem formado', generateToken()],
        ['lixo', 'nao-e-um-token'],
      ];
      const shapes: unknown[] = [];
      for (const [name, token] of variants) {
        const client = ctx.anonymous();
        if (token !== null) client.setCookie(client.sessionCookieName, token);
        const response = await client.get('/api/auth/me');
        ctx.observe(b, response);
        expect(response.status, name).toBe(401);
        shapes.push(errorShape(response));
      }
      expect(new Set(shapes.map((s) => JSON.stringify(s))).size).toBe(1);

      // A sessao de B continua dele depois de todos esses ataques; A idem.
      expect((await clientB.get('/api/auth/me')).status).toBe(200);
      expect((await clientA.get('/api/auth/me')).status).toBe(200);

      // Estados de sessao/conta (par descartavel): revogada, expirada, usuario desativado, excluido logicamente.
      const pair = await ctx.pair('me');
      const db = world.testDb.db;
      const pa = ctx.http(pair.a.client);
      const pb = ctx.http(pair.b.client);
      expect((await pa.get('/api/auth/me')).status).toBe(200);

      await db
        .forOwner(pair.a.ownerId)
        .session.updateMany({ where: {}, data: { revokedAt: new Date() } });
      expect((await pa.get('/api/auth/me')).status).toBe(401); // revogada
      expect((await pb.get('/api/auth/me')).status).toBe(200); // a do outro dono nao foi afetada

      const expired = await ctx.pair('me-expired');
      await db
        .forOwner(expired.a.ownerId)
        .session.updateMany({ where: {}, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await ctx.http(expired.a.client).get('/api/auth/me')).status).toBe(401); // expirada
      await db.forOwner(expired.b.ownerId).session.updateMany({
        where: {},
        data: {
          createdAt: new Date(Date.now() - 10_000),
          expiresAt: new Date(Date.now() - 2000),
          absoluteExpiresAt: new Date(Date.now() - 1000),
        },
      });
      expect((await ctx.http(expired.b.client).get('/api/auth/me')).status).toBe(401); // expirada (idle e absoluta)

      const disabled = await ctx.pair('me-disabled');
      await db.global.user.update({
        where: { id: disabled.a.ownerId },
        data: { status: 'disabled' },
      });
      expect((await ctx.http(disabled.a.client).get('/api/auth/me')).status).toBe(401); // desativado
      expect((await ctx.http(disabled.b.client).get('/api/auth/me')).status).toBe(200);
      await db.global.user.update({
        where: { id: disabled.a.ownerId },
        data: { status: 'active', deletedAt: new Date() },
      });
      expect((await ctx.http(disabled.a.client).get('/api/auth/me')).status).toBe(401); // excluido logicamente
    },
  },

  // ------------------------------------------------------------------------------------------
  'auth.logout/revokes-only-own-session': {
    description:
      'POST /api/auth/logout: revoga so a sessao de quem chama; token antigo morre; CSRF/Origin de outro ' +
      'dono sao rejeitados; auditoria de B nao contem A.',
    routes: ['POST /api/auth/logout'],
    async run(ctx) {
      const { world } = ctx;
      const pair = await ctx.pair('logout');
      const a = ctx.http(pair.a.client);
      const b = ctx.http(pair.b.client);
      const oldB = pair.b.client.sessionToken ?? '';
      const csrfOfA = pair.a.client.csrfToken ?? '';
      const csrfOfB = pair.b.client.csrfToken ?? '';

      // CSRF de A usado na requisicao de B (cookie de B): double-submit nao confere -> 403, nada revogado.
      const wrongCsrf = await b.post('/api/auth/logout', undefined, { csrf: csrfOfA });
      expect(wrongCsrf.status).toBe(403);
      // Origin alheia / ausente -> 403.
      expect(
        (await b.post('/api/auth/logout', undefined, { origin: 'https://evil.example.test' }))
          .status,
      ).toBe(403);
      expect((await b.post('/api/auth/logout', undefined, { origin: null })).status).toBe(403);
      expect(await activeSessions(world, pair.b.ownerId)).toBe(1);
      expect(csrfOfA).not.toBe(csrfOfB);

      const out = await b.post('/api/auth/logout');
      ctx.observe(pair.b, out);
      expect(out.status).toBe(200);
      expect(bodyOf(out)).toEqual({ revokedSessions: 1 });
      expectNoLeaks(
        'POST /logout como B',
        ctx.observedBy(pair.b),
        await secretsOf(world, pair.b, pair.a),
      );

      // A nao foi deslogado; B nao entra mais nem restaurando o cookie antigo.
      expect((await a.get('/api/auth/me')).status).toBe(200);
      expect(await activeSessions(world, pair.a.ownerId)).toBe(1);
      const replay = ctx.anonymous();
      replay.setCookie(replay.sessionCookieName, oldB);
      expect((await replay.get('/api/auth/me')).status).toBe(401);

      // Logout repetido (sem sessao) -> 401, e a auditoria de B so tem eventos de B.
      expect((await ctx.anonymous().post('/api/auth/logout')).status).toBe(401);
      const audit = await world.testDb.db.forOwner(pair.b.ownerId).auditEvent.findMany();
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.every((event) => event.ownerId === pair.b.ownerId)).toBe(true);
      expectNoLeaks(
        'auditoria de B',
        JSON.stringify(audit),
        await secretsOf(world, pair.b, pair.a),
      );
    },
  },

  // ------------------------------------------------------------------------------------------
  'auth.logout-all/revokes-only-own-sessions': {
    description:
      'POST /api/auth/logout-all: revoga todas as sessoes do chamador e NENHUMA do outro dono.',
    routes: ['POST /api/auth/logout-all'],
    async run(ctx) {
      const { world } = ctx;
      const pair = await ctx.pair('logout-all');
      // mais duas sessoes para cada um (cliente sem cookie -> login nao revoga a sessao existente)
      const extras: TestClient[] = [];
      for (const actor of [pair.a, pair.b, pair.a, pair.b]) {
        const extra = ctx.anonymous();
        const login = await extra.post('/api/auth/login', {
          email: actor.email,
          password: actor.password,
        });
        expect(login.status).toBe(200);
        extras.push(extra);
      }
      expect(await activeSessions(world, pair.a.ownerId)).toBe(3);
      expect(await activeSessions(world, pair.b.ownerId)).toBe(3);

      const response = await ctx.http(pair.b.client).post('/api/auth/logout-all');
      ctx.observe(pair.b, response);
      expect(response.status).toBe(200);
      expect(bodyOf(response)).toEqual({ revokedSessions: 3 });
      expect(await activeSessions(world, pair.b.ownerId)).toBe(0);
      expect(await activeSessions(world, pair.a.ownerId)).toBe(3);

      // todas as sessoes de A respondem; todas as de B nao
      for (const client of [pair.a.client, extras[0]!, extras[2]!]) {
        expect((await ctx.http(client).get('/api/auth/me')).status).toBe(200);
      }
      for (const client of [pair.b.client, extras[1]!, extras[3]!]) {
        expect((await ctx.http(client).get('/api/auth/me')).status).toBe(401);
      }
      expectNoLeaks(
        'POST /logout-all como B',
        ctx.observedBy(pair.b),
        await secretsOf(world, pair.b, pair.a),
      );
    },
  },

  // ------------------------------------------------------------------------------------------
  'auth.login/credentials-never-cross-accounts': {
    description:
      'POST /api/auth/login: e-mail de A com a senha de B falha igual a e-mail inexistente; login de um ' +
      'dono nao altera as sessoes do outro; cookie invalido apresentado no login nao revoga ninguem.',
    routes: ['POST /api/auth/login'],
    async run(ctx) {
      const { world } = ctx;
      const pair = await ctx.pair('login');
      const anon = ctx.anonymous();
      const sessionsA = await activeSessions(world, pair.a.ownerId);
      const sessionsB = await activeSessions(world, pair.b.ownerId);

      const crossed = await anon.post('/api/auth/login', {
        email: pair.a.email,
        password: pair.b.password,
      });
      const missing = await ctx.anonymous().post('/api/auth/login', {
        email: 'nao-existe-login@example.test',
        password: pair.b.password,
      });
      const wrong = await ctx.anonymous().post('/api/auth/login', {
        email: pair.a.email,
        password: 'senha-errada-qualquer-123456',
      });
      for (const response of [crossed, missing, wrong]) {
        ctx.observe(pair.b, response);
        expect(response.status).toBe(401);
        expect(setCookies(response).filter((c) => c.includes('session'))).toEqual([]);
      }
      expect(errorShape(crossed)).toEqual(errorShape(missing));
      expect(errorShape(crossed)).toEqual(errorShape(wrong));
      expect((bodyOf(crossed).error as Body).code).toBe('INVALID_CREDENTIALS');
      expect(await activeSessions(world, pair.a.ownerId)).toBe(sessionsA);

      // Login legitimo de B: sessao nova e dele; A intocado.
      const loginB = ctx.anonymous();
      const ok = await loginB.post('/api/auth/login', {
        email: pair.b.email,
        password: pair.b.password,
      });
      ctx.observe(pair.b, ok);
      expect(ok.status).toBe(200);
      expect((ok.body as AuthSessionResponse).user.id).toBe(pair.b.ownerId);
      expect(await activeSessions(world, pair.b.ownerId)).toBe(sessionsB + 1);
      expect(await activeSessions(world, pair.a.ownerId)).toBe(sessionsA);

      // Cookie invalido/aleatorio no login nao revoga sessao de ninguem.
      const bogus = ctx.anonymous();
      bogus.setCookie(bogus.sessionCookieName, generateToken());
      expect(
        (await bogus.post('/api/auth/login', { email: pair.b.email, password: pair.b.password }))
          .status,
      ).toBe(200);
      expect(await activeSessions(world, pair.a.ownerId)).toBe(sessionsA);
      expect((await ctx.http(pair.a.client).get('/api/auth/me')).status).toBe(200);

      expectNoLeaks(
        'POST /login como B',
        ctx.observedBy(pair.b),
        await secretsOf(world, pair.b, pair.a),
      );
    },
  },

  // ------------------------------------------------------------------------------------------
  'auth.invites/tokens-are-single-use-and-not-an-oracle': {
    description:
      'POST /api/auth/invites/preview e /accept: convite usado, expirado, revogado ou inexistente dao a mesma ' +
      'resposta; aceite nao permite escolher o e-mail nem tomar conta existente; convite de e-mail ja ' +
      'cadastrado nao altera a credencial do dono.',
    routes: ['POST /api/auth/invites/preview', 'POST /api/auth/invites/accept'],
    async run(ctx) {
      const { world } = ctx;
      const db = world.testDb.db;
      const password = 'senha-do-convidado-valida-5544';

      // convite valido: preview revela so o e-mail do proprio convite
      const fresh = await createInvite(db, { email: 'convidado-1@example.test' });
      const previewOk = await ctx
        .anonymous()
        .post('/api/auth/invites/preview', { token: fresh.token });
      expect(previewOk.status).toBe(200);
      expect(bodyOf(previewOk).email).toBe('convidado-1@example.test');

      const users = () => db.global.user.count();
      const accepted = ctx.anonymous();
      expect(
        (
          await accepted.post('/api/auth/invites/accept', {
            token: fresh.token,
            password,
            consents: TEST_SIGNUP_CONSENTS,
          })
        ).status,
      ).toBe(201);
      const totalUsers = await users();

      // convites "mortos": usado, expirado, revogado, inexistente -> respostas identicas
      const expired = await createInvite(db, { email: 'convidado-2@example.test' });
      await db.global.invite.update({
        where: { tokenHash: hashToken(expired.token) },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const revoked = await createInvite(db, { email: 'convidado-3@example.test' });
      await db.global.invite.update({
        where: { tokenHash: hashToken(revoked.token) },
        data: { usedAt: new Date() },
      });
      const dead: [string, string][] = [
        ['ja usado (aceito)', fresh.token],
        ['expirado', expired.token],
        ['revogado', revoked.token],
        ['inexistente', generateToken()],
      ];
      const previews: unknown[] = [];
      const accepts: unknown[] = [];
      for (const [name, token] of dead) {
        const preview = await ctx.anonymous().post('/api/auth/invites/preview', { token });
        const accept = await ctx
          .anonymous()
          .post('/api/auth/invites/accept', { token, password, consents: TEST_SIGNUP_CONSENTS });
        for (const response of [preview, accept]) {
          expect(response.status, name).toBe(400);
          expect((bodyOf(response).error as Body).code, name).toBe('INVITE_INVALID');
          expect(setCookies(response), name).toEqual([]);
          ctx.observe(world.b, response);
        }
        previews.push(errorShape(preview));
        accepts.push(errorShape(accept));
      }
      expect(new Set(previews.map((s) => JSON.stringify(s))).size).toBe(1);
      expect(new Set(accepts.map((s) => JSON.stringify(s))).size).toBe(1);
      expect(await users()).toBe(totalUsers);

      // aceite nao aceita e-mail nem campos extras (schema estrito): nao ha como "escolher" a conta
      const another = await createInvite(db, { email: 'convidado-4@example.test' });
      const injected = await ctx.anonymous().post('/api/auth/invites/accept', {
        token: another.token,
        password,
        email: world.a.email,
        consents: TEST_SIGNUP_CONSENTS,
      });
      expect(injected.status).toBe(400);
      expect(await users()).toBe(totalUsers);

      // convite emitido para o e-mail de um dono existente (forcado no banco): aceite falha com a mesma
      // resposta generica e a credencial do dono nao muda.
      await expect(createInvite(db, { email: world.a.email })).rejects.toMatchObject({
        code: 'USER_EXISTS',
      });
      const takeover = await createInvite(db, { email: 'convidado-5@example.test' });
      await db.global.invite.update({
        where: { tokenHash: hashToken(takeover.token) },
        data: { email: world.a.email },
      });
      const credentialBefore = await db.forOwner(world.a.ownerId).credential.findFirstOrThrow();
      const sessionsBefore = await activeSessions(world, world.a.ownerId);
      const attempt = await ctx.anonymous().post('/api/auth/invites/accept', {
        token: takeover.token,
        password: 'senha-do-invasor-valida-9988',
        consents: TEST_SIGNUP_CONSENTS,
      });
      ctx.observe(world.b, attempt);
      expect(attempt.status).toBe(400);
      expect(errorShape(attempt)).toEqual(accepts[0]);
      expect(setCookies(attempt)).toEqual([]);
      expect(await users()).toBe(totalUsers);
      const credentialAfter = await db.forOwner(world.a.ownerId).credential.findFirstOrThrow();
      expect(credentialAfter.passwordHash).toBe(credentialBefore.passwordHash);
      expect(await activeSessions(world, world.a.ownerId)).toBe(sessionsBefore);
      // A continua entrando com a propria senha
      const loginA = await ctx
        .anonymous()
        .post('/api/auth/login', { email: world.a.email, password: world.a.password });
      expect(loginA.status).toBe(200);
      expect((loginA.body as AuthSessionResponse).user.id).toBe(world.a.ownerId);

      expectNoLeaks(
        'respostas de convite observadas por B',
        ctx.observedBy(world.b),
        await secretsOf(world, world.b, world.a),
      );
    },
  },

  // ------------------------------------------------------------------------------------------
  'profile.api/cross-owner-behaves-like-not-found': {
    description:
      'S2.1a: B com ids de A (registro, evidencia, revisao, importacao em previa e aplicada) recebe o MESMO status e ' +
      'corpo que para um id inexistente ou malformado; escritas/exclusoes/aplicacao de B sobre ids de A nao mudam ' +
      'nada em A; listagens, exportacao, confirmacao em lote e importacao de B so tem dados de B.',
    routes: [
      'GET /api/profile',
      'PUT /api/profile',
      'GET /api/profile/sections/:section',
      'PUT /api/profile/sections/:section',
      'POST /api/profile/records',
      'GET /api/profile/records/:recordId',
      'PUT /api/profile/records/:recordId',
      'DELETE /api/profile/records/:recordId',
      'PATCH /api/profile/records/:recordId/meta',
      'POST /api/profile/records/:recordId/archive',
      'POST /api/profile/confirmations',
      'GET /api/profile/evidence',
      'GET /api/profile/evidence/:evidenceId/links',
      'POST /api/profile/evidence/:evidenceId/links',
      'DELETE /api/profile/evidence/:evidenceId/links/:recordId',
      'GET /api/profile/pending',
      'PATCH /api/profile/pending/:pendingId',
      'POST /api/profile/revisions',
      'GET /api/profile/revisions',
      'GET /api/profile/revisions/:revisionId',
      'POST /api/profile/imports/preview',
      'GET /api/profile/imports',
      'GET /api/profile/imports/:importRecordId',
      'POST /api/profile/imports/:importRecordId/apply',
      'POST /api/profile/imports/:importRecordId/discard',
      'GET /api/profile/export',
    ],
    async run(ctx) {
      const { world } = ctx;
      const pair = await ctx.pair('profile-api');
      const a = ctx.http(pair.a.client);
      const b = ctx.http(pair.b.client);
      const secrets = await secretsOf(world, pair.b, pair.a);
      const secretsForA = await secretsOf(world, pair.a, pair.b);
      const GHOST = '00000000-0000-4000-8000-000000000000';
      const GARBAGE = 'nao-e-um-uuid';

      const recordsOf = async (owner: Actor) => {
        const loaded = await world.store.loadProfileDocument(owner.ownerId);
        return listRecords(loaded?.document);
      };
      const idOfKind = async (owner: Actor, kind: string): Promise<string> => {
        const found = (await recordsOf(owner)).find((r) => r.kind === kind);
        if (found?.id == null) throw new Error(`${owner.fixtureId} has no ${kind}`);
        return found.id;
      };
      const factA = await idOfKind(pair.a, 'skill');
      const experienceA = await idOfKind(pair.a, 'experience');
      const evidenceA = await idOfKind(pair.a, 'evidence');
      const pendingB = await idOfKind(pair.b, 'pending_item');
      const factB = await idOfKind(pair.b, 'skill');
      const evidenceB = await idOfKind(pair.b, 'evidence');

      // controle positivo: o dono le o que e dele
      expect((await a.get(`/api/profile/records/${factA}`)).status).toBe(200);
      expect((await a.get(`/api/profile/revisions/${pair.a.revisionId}`)).status).toBe(200);
      expect((await a.get(`/api/profile/imports/${pair.a.appliedImportId}`)).status).toBe(200);
      expect((await a.get(`/api/profile/evidence/${evidenceA}/links`)).status).toBe(200);

      // A's own export (it writes an audit event for A) happens BEFORE the snapshot of A's state
      const exportA = await a.get('/api/profile/export?format=yaml');
      expect(exportA.status).toBe(200);

      const before = await stableState(world, pair.a);
      const beforeB = await stableState(world, pair.b);

      /** B pede o recurso de A, um inexistente e lixo: tudo igual (status + corpo sem requestId). */
      async function indistinguishable(
        label: string,
        request: (id: string) => Promise<TestResponse>,
        victimId: string,
        /** A malformed id in the URL is a 404 too; in a JSON body it is a plain schema error (400). */
        garbageIsNotFound = true,
      ): Promise<void> {
        const crossed = await request(victimId);
        const ghost = await request(GHOST);
        const garbage = await request(GARBAGE);
        for (const response of [crossed, ghost, garbage]) ctx.observe(pair.b, response);
        expect(crossed.status, label).toBe(404);
        expect(errorShape(crossed), label).toEqual(errorShape(ghost));
        if (garbageIsNotFound) expect(errorShape(garbage), label).toEqual(errorShape(ghost));
        else expect(garbage.status, label).toBe(400);
        expect(crossed.headers['content-length'], label).toBe(ghost.headers['content-length']);
      }

      const attack = { record: { name: 'CANARY-ATTACK-by-B' } };
      await indistinguishable('GET record', (id) => b.get(`/api/profile/records/${id}`), factA);
      await indistinguishable(
        'PUT record',
        (id) => b.put(`/api/profile/records/${id}`, attack),
        factA,
      );
      await indistinguishable(
        'DELETE record',
        (id) => b.delete(`/api/profile/records/${id}`),
        factA,
      );
      await indistinguishable(
        'PATCH meta',
        (id) => b.patch(`/api/profile/records/${id}/meta`, { status: 'confirmed' }),
        factA,
      );
      await indistinguishable(
        'archive',
        (id) => b.post(`/api/profile/records/${id}/archive`, {}),
        factA,
      );
      await indistinguishable(
        'GET links',
        (id) => b.get(`/api/profile/evidence/${id}/links`),
        evidenceA,
      );
      await indistinguishable(
        'POST link (evidence of A)',
        (id) => b.post(`/api/profile/evidence/${id}/links`, { recordId: factB }),
        evidenceA,
      );
      // B's own evidence pointing at A's record: the target is "not found", exactly like a ghost target
      await indistinguishable(
        'POST link (target of A)',
        (id) => b.post(`/api/profile/evidence/${evidenceB}/links`, { recordId: id }),
        factA,
        false,
      );
      await indistinguishable(
        'DELETE link (evidence of A)',
        (id) => b.delete(`/api/profile/evidence/${id}/links/${factA}`),
        evidenceA,
      );
      // unlinking a foreign record from B's own evidence is an idempotent 200 with B's own links only
      const unlinkForeign = await b.delete(`/api/profile/evidence/${evidenceB}/links/${factA}`);
      const unlinkGhost = await b.delete(`/api/profile/evidence/${evidenceB}/links/${GHOST}`);
      ctx.observe(pair.b, unlinkForeign);
      expect(unlinkForeign.status).toBe(200);
      expect(unlinkForeign.body).toEqual(unlinkGhost.body);
      await indistinguishable(
        'GET revision',
        (id) => b.get(`/api/profile/revisions/${id}`),
        pair.a.revisionId,
      );
      await indistinguishable(
        'GET import (applied)',
        (id) => b.get(`/api/profile/imports/${id}`),
        pair.a.appliedImportId,
      );
      await indistinguishable(
        'GET import (preview)',
        (id) => b.get(`/api/profile/imports/${id}`),
        pair.a.previewImportId,
      );
      await indistinguishable(
        'apply import (preview of A)',
        (id) => b.post(`/api/profile/imports/${id}/apply`, { mode: 'merge' }),
        pair.a.previewImportId,
      );
      await indistinguishable(
        'apply import (applied of A)',
        (id) => b.post(`/api/profile/imports/${id}/apply`, { mode: 'merge' }),
        pair.a.appliedImportId,
      );
      await indistinguishable(
        'discard import',
        (id) => b.post(`/api/profile/imports/${id}/discard`, {}),
        pair.a.previewImportId,
      );
      // the symmetric direction on the pending-item route: A attacks B's pending item
      const attackPending = (id: string) =>
        a.patch(`/api/profile/pending/${id}`, { status: 'dismissed' });
      const crossedPending = await attackPending(pendingB);
      const ghostPending = await attackPending(GHOST);
      ctx.observe(pair.a, crossedPending);
      expect(crossedPending.status).toBe(404);
      expect(errorShape(crossedPending)).toEqual(errorShape(ghostPending));
      expect(errorShape(await attackPending(GARBAGE))).toEqual(errorShape(ghostPending));

      // a nested create whose parent belongs to A: "not found", like a ghost parent
      await indistinguishable(
        'POST record with foreign parent',
        (id) =>
          b.post('/api/profile/records', {
            kind: 'experience_item',
            parentId: id,
            record: { kind: 'achievement', text: 'CANARY-ATTACK-nested' },
          }),
        experienceA,
        false,
      );

      // batch confirmation with A's ids: every id is "not_found", the same answer as for ghosts
      const idsOfA = (await recordsOf(pair.a)).slice(0, 8).map((r) => String(r.id));
      const ghosts = idsOfA.map(
        (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      );
      const confirmCrossed = await b.post('/api/profile/confirmations', { recordIds: idsOfA });
      const confirmGhost = await b.post('/api/profile/confirmations', { recordIds: ghosts });
      // not observed: `skipped` echoes the ids B itself sent (and nothing else), which the final sweep would flag
      expect(confirmCrossed.status).toBe(200);
      expect(bodyOf(confirmCrossed).confirmed).toEqual([]);
      const skipped = bodyOf(confirmCrossed).skipped as { reason: string }[];
      expect(skipped).toHaveLength(idsOfA.length);
      expect((skipped as unknown as { recordId: string }[]).map((entry) => entry.recordId)).toEqual(
        idsOfA,
      );
      expect(Object.keys(bodyOf(confirmCrossed)).sort()).toEqual([
        'confirmed',
        'skipped',
        'summary',
      ]);
      expect(JSON.stringify(bodyOf(confirmCrossed).summary)).not.toContain(pair.a.ownerId);
      expect(skipped.every((s) => s.reason === 'not_found')).toBe(true);
      expect((bodyOf(confirmGhost).skipped as unknown[]).length).toBe(skipped.length);

      // A's document as the body of B's whole-document save: A's ids are unknown to B (400, no oracle)
      const documentOfA = (await world.store.loadProfileDocument(pair.a.ownerId))?.document;
      const putForeign = await b.put('/api/profile', { document: documentOfA });
      const putPhantom = await b.put('/api/profile', {
        document: {
          schema_version: '2.1.0',
          profile: { skills: [{ id: '99999999-9999-4999-8999-999999999999', name: 'Fantasma' }] },
        },
      });
      ctx.observe(pair.b, putForeign);
      expect(putForeign.status).toBe(400);
      expect(putPhantom.status).toBe(400);
      expect(bodyOf(putForeign).error).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(bodyOf(putPhantom).error).toMatchObject({ code: 'VALIDATION_ERROR' });
      // the section route cannot adopt A's ids either
      const sectionForeign = await b.put('/api/profile/sections/skills', {
        value: (documentOfA?.profile.skills ?? []).slice(0, 2),
      });
      ctx.observe(pair.b, sectionForeign);
      expect(sectionForeign.status).toBe(400);

      // reads without ids return B's own data only
      for (const path of [
        '/api/profile',
        '/api/profile/sections/identity',
        '/api/profile/evidence',
        '/api/profile/pending?status=all',
        '/api/profile/revisions',
        '/api/profile/imports',
        '/api/profile/export?format=json',
        '/api/profile/export?format=yaml',
      ]) {
        const response = await b.get(path);
        ctx.observe(pair.b, response);
        expect(response.status, path).toBe(200);
      }
      const ownProfile = await b.get('/api/profile');
      expect(JSON.stringify(ownProfile.body)).toContain(pair.b.canaries[0]);
      const revisionB = await b.post('/api/profile/revisions', {});
      ctx.observe(pair.b, revisionB);
      expect([200, 201]).toContain(revisionB.status);

      // B's own writes through the section route only touch B
      const writeB = await b.put('/api/profile/sections/review', {
        value: { reviewed_by: 'self' },
      });
      ctx.observe(pair.b, writeB);
      expect(writeB.status).toBe(200);

      // another account's export text previewed by B: the text is B's own input; applying it hits ID_CONFLICT
      const previewByB = await b.post('/api/profile/imports/preview', { text: exportA.text });
      expect(previewByB.status).toBe(201);
      const previewId = (bodyOf(previewByB).importRecord as Body).id as string;
      const conflict = await b.post(`/api/profile/imports/${previewId}/apply`, { mode: 'merge' });
      ctx.observe(pair.b, conflict);
      expect(conflict.status).toBe(409);
      expect(bodyOf(conflict).error).toMatchObject({ code: 'ID_CONFLICT' });
      expect((await b.post(`/api/profile/imports/${previewId}/discard`, {})).status).toBe(200);

      // A is byte-for-byte untouched; B changed only what B did to itself
      expect(await stableState(world, pair.a)).toEqual(before);
      expect(await stableState(world, pair.b)).not.toEqual(beforeB);
      const afterB = await world.store.loadProfileDocument(pair.b.ownerId);
      expect(JSON.stringify(afterB?.document)).not.toContain('CANARY-ATTACK');
      expect(JSON.stringify(await world.store.loadProfileDocument(pair.a.ownerId))).not.toContain(
        'CANARY-ATTACK',
      );

      expectNoLeaks('rotas de perfil como B', ctx.observedBy(pair.b), secrets);
      expectNoLeaks('rotas de perfil como A (par)', ctx.observedBy(pair.a), secretsForA);
    },
  },
};
