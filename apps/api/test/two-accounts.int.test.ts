import { createTestDb, type TestDb } from '@chameleon/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { requireAuthContext } from '../src/auth/context';
import { getRouteManifest } from '../src/http';
import { buildTestApp, createTwoAccounts, TestClient } from './helpers';

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(async () => {
  await testDb.drop();
});
beforeEach(async () => {
  await testDb.truncateAll();
});

describe('requireAuth injeta ownerId e db.forOwner (duas contas)', () => {
  function setup() {
    return buildTestApp(testDb.db, {
      modules: [
        ({ routes, requireAuth }) => {
          // Modulo de teste que imita um modulo privado: so usa req.auth.db.
          routes.get('/probe/sessions', { auth: 'session' }, requireAuth, async (req, res) => {
            const auth = requireAuthContext(req);
            const rows = await auth.db.session.findMany({ select: { ownerId: true, id: true } });
            res.json({ ownerId: auth.ownerId, rows });
          });
          routes.get('/probe/:sessionId', { auth: 'session' }, requireAuth, async (req, res) => {
            const auth = requireAuthContext(req);
            const row = await auth.db.session.findFirst({
              where: { id: String(req.params.sessionId) },
              select: { id: true },
            });
            if (!row) {
              res.status(404).json({ error: { code: 'NOT_FOUND' } });
              return;
            }
            res.json(row);
          });
          // Anti-padrao: modelo privado sem escopo falha (nunca vaza), vira 500 generico.
          routes.get('/probe-global', { auth: 'session' }, requireAuth, async (_req, res) => {
            res.json(await testDb.db.global.session.findMany());
          });
        },
      ],
    });
  }

  it('cada conta ve apenas as proprias linhas; id de B no escopo de A -> 404', async () => {
    const { app, config } = setup();
    const { a, b } = await createTwoAccounts({ app, config, db: testDb.db });

    const listA = (await a.client.get('/api/probe/sessions')).body as {
      ownerId: string;
      rows: { ownerId: string; id: string }[];
    };
    const listB = (await b.client.get('/api/probe/sessions')).body as typeof listA;
    expect(listA.ownerId).toBe(a.ownerId);
    expect(listB.ownerId).toBe(b.ownerId);
    expect(listA.rows.every((r) => r.ownerId === a.ownerId)).toBe(true);
    expect(listB.rows.every((r) => r.ownerId === b.ownerId)).toBe(true);
    expect(listA.rows.map((r) => r.id)).not.toContain(listB.rows[0]?.id);

    const crossed = await a.client.get(`/api/probe/${listB.rows[0]?.id}`);
    const missing = await a.client.get('/api/probe/00000000-0000-4000-8000-000000000000');
    expect(crossed.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(crossed.body).toEqual(missing.body); // sem oraculo de existencia
  });

  it('sem sessao: 401 nas rotas do modulo; cookie de A nao serve de B e vice-versa', async () => {
    const { app, config } = setup();
    const { a, b } = await createTwoAccounts({ app, config, db: testDb.db });
    const anon = new TestClient(app, config);
    expect((await anon.get('/api/probe/sessions')).status).toBe(401);
    expect((await a.client.get('/api/probe/sessions', { cookies: false })).status).toBe(401);
    // Trocar o token de sessao identifica o dono do token, nunca o de outra conta.
    const mixed = new TestClient(app, config);
    mixed.setCookie(mixed.sessionCookieName, b.client.sessionToken ?? '');
    const body = (await mixed.get('/api/probe/sessions')).body as { ownerId: string };
    expect(body.ownerId).toBe(b.ownerId);
  });

  it('uso indevido de db.global em modelo privado vira 500 generico, sem dados', async () => {
    const { app, config } = setup();
    const { a } = await createTwoAccounts({ app, config, db: testDb.db });
    const response = await a.client.get('/api/probe-global');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toMatch(/tokenHash|Unscoped|session/i);
  });

  it('o manifesto marca rotas com parametro de recurso para o gate da S1.4', () => {
    const { app } = setup();
    // the profile (S2.1a) and jobs (P1) modules are covered by the isolation gate; this test is about the probe module
    const withParam = getRouteManifest(app).filter(
      (r) =>
        r.hasResourceParam &&
        !r.path.startsWith('/api/profile') &&
        !r.path.startsWith('/api/jobs') &&
        !r.path.startsWith('/api/resumes'),
    );
    expect(withParam.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/probe/:sessionId']);
    expect(withParam[0]).toMatchObject({ auth: 'session', resourceParams: ['sessionId'] });
  });
});
