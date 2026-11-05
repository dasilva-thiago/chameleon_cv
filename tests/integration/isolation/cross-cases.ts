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
  type TestResponse,
} from './support/workspace';
import type { Actor, World } from './support/world';

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

const activeSessions = async (world: World, ownerId: string): Promise<number> =>
  world.testDb.db.forOwner(ownerId).session.count({ where: { revokedAt: null } });

export const CROSS_CASES: Record<string, CrossCase> = {
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
};
