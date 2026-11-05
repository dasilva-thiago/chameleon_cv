import { afterAll, describe, expect, it } from 'vitest';
import { ROUTE_COVERAGE } from './coverage';
import { CROSS_CASES } from './cross-cases';
import { evaluateGate, routeKey, type CoverageMap } from './support/gate';
import {
  buildTestApp,
  createDb,
  createStrayRouter,
  getRouteManifest,
  testConfig,
  type ApiModule,
  type RouteManifestEntry,
} from './support/workspace';

/**
 * GATE DE ROTAS (ADR-0008 item 5b; criterio da Fase 1): enumera as rotas REAIS do Express via
 * `getRouteManifest(app)` e FALHA se alguma rota (a) nao esta classificada, (b) vem de router montado
 * fora do registro, (c) nao tem entrada em coverage.ts, (d) tem parametro de recurso ou exige sessao
 * sem caso cruzado A/B registrado em cross-cases.ts (e executado por http-cross-owner.test.ts).
 *
 * Os testes negativos provam o gate com apps SINTETICOS (modulos de teste montados via
 * `buildTestApp({ modules })`); o app real nunca e alterado.
 */
const db = createDb({ connectionString: testConfig().DATABASE_URL }); // nao conecta ate a 1a query
afterAll(async () => db.$disconnect());

const manifestOf = (
  modules?: ApiModule[],
  mount?: (app: unknown) => void,
): RouteManifestEntry[] => {
  const { app } = buildTestApp(db, modules ? { modules } : {});
  mount?.(app);
  return getRouteManifest(app);
};

describe('gate de rotas: app real', () => {
  const manifest = manifestOf();

  it('o manifesto lista as rotas reais (guarda contra varredura vazia)', () => {
    expect(manifest.map(routeKey)).toEqual(
      expect.arrayContaining([
        'POST /api/auth/login',
        'POST /api/auth/invites/preview',
        'POST /api/auth/invites/accept',
        'GET /api/auth/me',
        'POST /api/auth/logout',
        'POST /api/auth/logout-all',
        'GET /api/health',
        'GET /health',
      ]),
    );
    expect(manifest.length).toBeGreaterThanOrEqual(8);
  });

  it('nenhuma rota esta "unclassified" nem montada fora do registro', () => {
    expect(manifest.filter((r) => r.auth === 'unclassified').map(routeKey)).toEqual([]);
    expect(manifest.filter((r) => r.path.includes('<?>')).map(routeKey)).toEqual([]);
  });

  it('TODA rota do manifesto esta coberta (e toda rota privada/com parametro tem caso cruzado executavel)', () => {
    expect(evaluateGate(manifest, ROUTE_COVERAGE, CROSS_CASES)).toEqual([]);
  });

  it('cobertura obtida: rotas por tipo de cobertura (relatorio)', () => {
    const cross = manifest.filter((r) => ROUTE_COVERAGE[routeKey(r)]?.kind === 'cross-case');
    const trivial = manifest.filter((r) => ROUTE_COVERAGE[routeKey(r)]?.kind === 'no-private-data');
    expect(cross.length + trivial.length).toBe(manifest.length);
    // toda rota autenticada tem caso cruzado (nao existe "sessao" sem cobertura)
    expect(manifest.filter((r) => r.auth === 'session').every((r) => cross.includes(r))).toBe(true);
    expect(cross.length).toBeGreaterThanOrEqual(6);
  });
});

describe('gate de rotas: prova negativa com apps sinteticos (o gate FALHA quando deve)', () => {
  const resourceRoute: ApiModule = ({ routes, requireAuth }) => {
    routes.get('/things/:thingId', { auth: 'session' }, requireAuth, (_req, res) => {
      res.json({});
    });
  };

  it('rota nova com parametro de recurso e SEM cobertura -> falha', () => {
    const problems = evaluateGate(manifestOf([resourceRoute]), ROUTE_COVERAGE, CROSS_CASES);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('GET /api/things/:thingId');
    expect(problems[0]).toContain('sem cobertura cruzada');
  });

  it('rota nova sem parametro mas com sessao e SEM cobertura -> falha', () => {
    const module: ApiModule = ({ routes, requireAuth }) => {
      // not '/profile': that path is a real route since S2.1a and is covered
      routes.get('/preferences', { auth: 'session' }, requireAuth, (_req, res) => res.json({}));
    };
    const problems = evaluateGate(manifestOf([module]), ROUTE_COVERAGE, CROSS_CASES);
    expect(problems.join('\n')).toContain('GET /api/preferences: sem cobertura cruzada');
  });

  it('rota fora do registro (unclassified) -> falha, mesmo que o caminho esteja em coverage.ts', () => {
    const rogue: ApiModule = ({ router }) => {
      router.get('/sorrateira/:id', (_req, res) => {
        res.json({});
      });
    };
    const coverage: CoverageMap = {
      ...ROUTE_COVERAGE,
      'GET /api/sorrateira/:id': {
        kind: 'cross-case',
        caseId: 'auth.me/session-never-crosses-owners',
      },
    };
    const problems = evaluateGate(manifestOf([rogue]), coverage, CROSS_CASES);
    expect(
      problems.some((p) => p.includes('GET /api/sorrateira/:id') && p.includes('NAO classificada')),
    ).toBe(true);
  });

  it('router montado fora do registro (prefixo <?>) -> falha', () => {
    const stray = createStrayRouter();
    stray.get('/x/:id', (_req, res) => res.json({}));
    const manifest = manifestOf(undefined, (app) => {
      (app as { use(path: string, router: never): void }).use('/api2', stray as never);
    });
    const problems = evaluateGate(manifest, ROUTE_COVERAGE, CROSS_CASES);
    expect(problems.some((p) => p.includes('<?>') && p.includes('montado fora do registro'))).toBe(
      true,
    );
  });

  it('"no-private-data" nao vale para rota com parametro, com sessao, nem para rota que muta estado', () => {
    const publicMutating: ApiModule = ({ routes }) => {
      routes.post('/feedback', { auth: 'public' }, (_req, res) => res.json({}));
      routes.get('/public/:slug', { auth: 'public' }, (_req, res) => res.json({}));
    };
    const reason = 'justificativa com mais de dez caracteres';
    const coverage: CoverageMap = {
      ...ROUTE_COVERAGE,
      'POST /api/feedback': { kind: 'no-private-data', reason },
      'GET /api/public/:slug': { kind: 'no-private-data', reason },
      'GET /api/auth/me': { kind: 'no-private-data', reason },
    };
    const problems = evaluateGate(manifestOf([publicMutating]), coverage, CROSS_CASES).join('\n');
    expect(problems).toContain('POST /api/feedback: rota que muta estado');
    expect(problems).toContain('GET /api/public/:slug: tem parametro de recurso');
    expect(problems).toContain('GET /api/auth/me: exige sessao');
  });

  it('cobertura invalida: caso inexistente, caso que nao declara a rota, entrada obsoleta, caso orfao, justificativa vazia', () => {
    const manifest = manifestOf();
    const coverage: CoverageMap = {
      ...ROUTE_COVERAGE,
      'GET /api/auth/me': { kind: 'cross-case', caseId: 'nao.existe' },
      'POST /api/auth/logout': {
        kind: 'cross-case',
        caseId: 'auth.login/credentials-never-cross-accounts',
      },
      'GET /health': { kind: 'no-private-data', reason: 'curto' },
      'GET /api/rota-removida/:id': {
        kind: 'cross-case',
        caseId: 'auth.me/session-never-crosses-owners',
      },
    };
    const problems = evaluateGate(manifest, coverage, CROSS_CASES).join('\n');
    expect(problems).toContain('GET /api/auth/me: caso cruzado "nao.existe" nao existe');
    expect(problems).toContain(
      'POST /api/auth/logout: o caso "auth.login/credentials-never-cross-accounts" nao declara',
    );
    expect(problems).toContain('GET /health: justificativa');
    expect(problems).toContain(
      'GET /api/rota-removida/:id: entrada de cobertura de rota que NAO existe mais',
    );
    // 'auth.me/...' ainda e referenciado por GET /api/rota-removida, mas 'auth.logout/...' ficou orfao
    expect(problems).toContain('caso "auth.logout/revokes-only-own-session": nao e referenciado');
  });

  it('rota nova COM entrada de cobertura e caso registrado que a declara -> gate verde', () => {
    const coverage: CoverageMap = {
      ...ROUTE_COVERAGE,
      'GET /api/things/:thingId': { kind: 'cross-case', caseId: 'things.get/cross' },
    };
    const cases = {
      ...CROSS_CASES,
      'things.get/cross': {
        description: 'x',
        routes: ['GET /api/things/:thingId'],
        run: () => Promise.resolve(),
      },
    };
    expect(evaluateGate(manifestOf([resourceRoute]), coverage, cases)).toEqual([]);
  });
});
