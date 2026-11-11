import { expect } from 'vitest';
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
    ...other.canaries.map((needle) => ({ label: `canario ${other.label} (par)`, needle })),
    { label: `e-mail de ${other.label} (par)`, needle: other.email },
    { label: `ownerId de ${other.label} (par)`, needle: other.ownerId },
    { label: 'senha do par', needle: other.password },
  ];
  if (other.client.sessionToken) {
    own.push({ label: 'sessao do par', needle: other.client.sessionToken });
    own.push({ label: 'hash da sessao do par', needle: hashToken(other.client.sessionToken) });
  }
  if (other.client.csrfToken) own.push({ label: 'csrf do par', needle: other.client.csrfToken });
  const rowIds = await world.testDb.sql<{ id: string }>(
    `SELECT id::text AS id FROM "ProfileBase" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "ProfileBaseRevision" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "JobPosting" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "Resume" WHERE "ownerId" = $1::uuid
     UNION ALL SELECT id::text FROM "Session" WHERE "ownerId" = $1::uuid`,
    [other.ownerId],
  );
  for (const row of rowIds.rows) own.push({ label: `id de linha do par`, needle: row.id });
  return [...base, ...own];
}

/**
 * Everything an owner's data holds, in an order-independent form (no physical row order, so autovacuum or HEAP
 * updates between two reads cannot make it flap): the base, its revisions and the row count of every private model.
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
    base: await world.testDb.db.forOwner(owner.ownerId).profileBase.findFirst(),
    revisions: (
      await world.testDb.db
        .forOwner(owner.ownerId)
        .profileBaseRevision.findMany({ select: { id: true, contentHash: true } })
    ).sort((x, y) => x.id.localeCompare(y.id)),
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
      // A has an evaluation of its own job: positive control for the analysis routes
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
      // B only wrote its own audit rows/sessions; nothing of B's base changed
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
      'Base profissional: B so le e grava a PROPRIA base; com o id de uma revisao de A (ler, restaurar) recebe o ' +
      'MESMO status e corpo que para um id inexistente ou malformado, e nada em A muda.',
    routes: [
      'GET /api/profile',
      'PUT /api/profile',
      'POST /api/profile/reading',
      'GET /api/profile/revisions',
      'GET /api/profile/revisions/:revisionId',
      'POST /api/profile/revisions/:revisionId/restore',
    ],
    async run(ctx) {
      const { world } = ctx;
      const pair = await ctx.pair('profile-api');
      const a = ctx.http(pair.a.client);
      const b = ctx.http(pair.b.client);
      const secrets = await secretsOf(world, pair.b, pair.a);
      const secretsForA = await secretsOf(world, pair.a, pair.b);
      const GHOST = '00000000-0000-4000-8000-000000000000';

      // controle positivo: o dono le o que e dele
      const ownBase = await a.get('/api/profile');
      ctx.observe(pair.a, ownBase);
      expect(JSON.stringify(ownBase.body)).toContain(pair.a.canaries[0]);
      expect((await a.get(`/api/profile/revisions/${pair.a.revisionId}`)).status).toBe(200);

      const before = await stableState(world, pair.a);

      async function indistinguishable(
        label: string,
        request: (id: string) => Promise<TestResponse>,
      ): Promise<void> {
        const crossed = await request(pair.a.revisionId);
        const ghost = await request(GHOST);
        const garbage = await request('nao-e-um-uuid');
        for (const response of [crossed, ghost, garbage]) ctx.observe(pair.b, response);
        expect(crossed.status, label).toBe(404);
        expect(errorShape(crossed), label).toEqual(errorShape(ghost));
        expect(errorShape(garbage), label).toEqual(errorShape(ghost));
        expect(crossed.headers['content-length'], label).toBe(ghost.headers['content-length']);
      }
      await indistinguishable('GET revision', (id) => b.get(`/api/profile/revisions/${id}`));
      await indistinguishable('restore revision', (id) =>
        b.post(`/api/profile/revisions/${id}/restore`, {}),
      );

      // B le e lista so o que e seu; gravar a propria base nao toca A
      for (const route of ['/api/profile', '/api/profile/revisions']) {
        const response = await b.get(route);
        ctx.observe(pair.b, response);
        expect(response.status).toBe(200);
      }
      const write = await b.put('/api/profile', {
        cvMarkdown: '# CV -- B novo',
        profileMarkdown: '',
      });
      ctx.observe(pair.b, write);
      expect(write.status).toBe(200);
      const forged = await b.put('/api/profile', {
        cvMarkdown: 'x',
        profileMarkdown: '',
        ownerId: pair.a.ownerId,
      });
      ctx.observe(pair.b, forged);
      expect(forged.status).toBe(400);

      // a leitura da base so devolve o texto enviado (nada e lido do banco nem gravado)
      const reading = await b.post('/api/profile/reading', {
        cvMarkdown:
          '# B Leitura\n\n## Experiência\n\n### Empresa B — Cidade\n\n**Cargo B**\n2024 – Atual\n',
        profileMarkdown: '',
      });
      ctx.observe(pair.b, reading);
      expect(reading.status).toBe(200);
      expect(JSON.stringify(reading.body)).toContain('Empresa B');
      const forgedReading = await b.post('/api/profile/reading', {
        cvMarkdown: 'x',
        profileMarkdown: '',
        ownerId: pair.a.ownerId,
      });
      ctx.observe(pair.b, forgedReading);
      expect(forgedReading.status).toBe(400);

      expect(await stableState(world, pair.a)).toEqual(before);
      expectNoLeaks('rotas da base como B', ctx.observedBy(pair.b), secrets);
      expectNoLeaks('rotas da base como A (par)', ctx.observedBy(pair.a), secretsForA);
    },
  },
};
