import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CrossCaseContext } from './support/context';
import { evaluateGate, routeKey, type CoverageMap } from './support/gate';
import { expectNoLeaks, forbiddenFor } from './support/leaks';
import { assertLogsClean } from './support/logs';
import { getRouteManifest, requireAuthContext, type ApiModule } from './support/workspace';
import { ROUTE_COVERAGE } from './coverage';
import { CROSS_CASES } from './cross-cases';
import { createWorld, type World } from './support/world';

/**
 * Implementacao de REFERENCIA do ciclo completo (README.md): um modulo sintetico com rotas de recurso
 * (`/api/probe/revisions/:revisionId`) sobre o ProfileStore REAL, o caso cruzado A/B que o cobre e o
 * gate verde. Enquanto a S2.1 nao entrega rotas de perfil, e este arquivo que prova que o mecanismo
 * (manifesto -> cobertura -> caso -> rastreio de rotas atingidas -> varredura) funciona de ponta a
 * ponta com uma rota de recurso. O app real nao e alterado.
 */
const probeModule: ApiModule = ({ routes, profileStore: store }) => {
  routes.get('/probe/profile', { auth: 'session' }, async (req, res) => {
    const auth = requireAuthContext(req);
    const loaded = await store.loadProfileDocument(auth.ownerId);
    res.json(loaded?.document ?? null);
  });
  routes.get('/probe/revisions/:revisionId', { auth: 'session' }, async (req, res) => {
    const auth = requireAuthContext(req);
    const revision = await store.getRevision(auth.ownerId, String(req.params.revisionId));
    if (!revision) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurso nao encontrado.' } });
      return;
    }
    res.json(revision);
  });
};

let world: World;
beforeAll(async () => {
  world = await createWorld({ modules: [probeModule] });
}, 120_000);
afterAll(async () => {
  if (!world) return;
  assertLogsClean(world);
  await world.drop();
});

const CASE_ID = 'probe.revisions/cross-owner';
const COVERAGE: CoverageMap = {
  ...ROUTE_COVERAGE,
  'GET /api/probe/profile': { kind: 'cross-case', caseId: CASE_ID },
  'GET /api/probe/revisions/:revisionId': { kind: 'cross-case', caseId: CASE_ID },
};
const CASES = {
  ...CROSS_CASES,
  [CASE_ID]: {
    description: 'rotas de referencia sobre o ProfileStore',
    routes: ['GET /api/probe/profile', 'GET /api/probe/revisions/:revisionId'],
    run: () => Promise.resolve(),
  },
};

describe('rota de recurso de referencia', () => {
  it('o manifesto expoe o parametro de recurso e o gate fica verde com cobertura + caso', () => {
    const manifest = getRouteManifest(world.app);
    const entry = manifest.find((r) => r.path === '/api/probe/revisions/:revisionId');
    expect(entry).toMatchObject({
      auth: 'session',
      hasResourceParam: true,
      resourceParams: ['revisionId'],
    });
    // sem a cobertura, o gate falha (prova de que ele enxerga a rota nova do app com modulo)
    const missing = evaluateGate(manifest, ROUTE_COVERAGE, CROSS_CASES);
    expect(missing.some((p) => p.startsWith('GET /api/probe/profile:'))).toBe(true);
    expect(missing.some((p) => p.startsWith('GET /api/probe/revisions/:revisionId'))).toBe(true);
    expect(evaluateGate(manifest, COVERAGE, CASES)).toEqual([]);
    expect(manifest.map(routeKey)).toContain('GET /api/probe/profile');
  });

  it('caso cruzado: B com o id de revisao de A == id inexistente; A le o proprio; nada de A chega a B', async () => {
    const ctx = new CrossCaseContext(world);
    const { a, b } = world;
    const clientA = ctx.http(a.client);
    const clientB = ctx.http(b.client);

    // controle positivo: A le a propria revisao e o proprio perfil (com canarios)
    const ownRevision = await clientA.get(`/api/probe/revisions/${a.revisionId}`);
    expect(ownRevision.status).toBe(200);
    expect(JSON.stringify(ownRevision.body)).toContain(a.canaries[0]);
    const ownProfile = await clientA.get('/api/probe/profile');
    expect(JSON.stringify(ownProfile.body)).toContain(a.canaries[0]);

    // ataque: B pede o recurso de A, um recurso inexistente e lixo
    const crossed = await clientB.get(`/api/probe/revisions/${a.revisionId}`);
    const ghost = await clientB.get('/api/probe/revisions/00000000-0000-4000-8000-000000000000');
    const garbage = await clientB.get('/api/probe/revisions/nao-e-uuid');
    for (const response of [crossed, ghost, garbage]) ctx.observe(b, response);
    expect(crossed.status).toBe(404);
    expect(crossed.body).toEqual(ghost.body); // sem oraculo de existencia
    expect(crossed.headers['content-length']).toBe(ghost.headers['content-length']);
    expect(garbage.status).toBeGreaterThanOrEqual(400);

    // B ve o proprio perfil, e so ele
    const profileB = await clientB.get('/api/probe/profile');
    ctx.observe(b, profileB);
    expect(profileB.status).toBe(200);
    expect(JSON.stringify(profileB.body)).toContain(b.canaries[0]);
    expectNoLeaks('rotas de referencia como B', ctx.observedAll(), await forbiddenFor(world, b));

    // o rastreio de rotas atingidas enxerga as duas rotas do modulo, pelo modelo do manifesto
    expect([...ctx.hits].sort()).toEqual([
      'GET /api/probe/profile',
      'GET /api/probe/revisions/:revisionId',
    ]);
    expect(ctx.unmatched).toEqual([]);
  });
});
