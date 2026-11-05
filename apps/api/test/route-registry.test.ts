import { createDb } from '@chameleon/db';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { RouteRegistry, getRouteManifest } from '../src/http';
import { buildTestApp, expectSessionRoutesRejectAnonymous, testConfig } from './helpers';

const db = createDb({ connectionString: testConfig().DATABASE_URL });
afterAll(async () => db.$disconnect());

describe('manifesto de rotas (gate de isolamento, ADR-0008 item 5b)', () => {
  it('lista as rotas reais com metodo, caminho, auth e parametros de recurso', () => {
    const manifest = getRouteManifest(buildTestApp(db).app);
    const summary = manifest.map((r) => `${r.method} ${r.path} ${r.auth}`);
    expect(summary).toEqual([
      'POST /api/auth/invites/accept public',
      'POST /api/auth/invites/preview public',
      'POST /api/auth/login public',
      'POST /api/auth/logout session',
      'POST /api/auth/logout-all session',
      'GET /api/auth/me session',
      'GET /api/health public',
      'GET /health public',
    ]);
    expect(manifest.every((r) => r.auth !== 'unclassified')).toBe(true);
    expect(manifest.every((r) => !r.hasResourceParam)).toBe(true);
    expect(manifest.find((r) => r.path === '/api/auth/login')).toMatchObject({
      method: 'POST',
      mutating: true,
    });
    expect(manifest.find((r) => r.path === '/api/auth/me')?.mutating).toBe(false);
  });

  it('modulos adicionais entram no manifesto e parametros de recurso sao derivados do caminho', () => {
    const { app } = buildTestApp(db, {
      modules: [
        ({ routes, requireAuth }) => {
          routes.get('/things/:thingId', { auth: 'session' }, requireAuth, (_req, res) => {
            res.json({});
          });
          routes.get(
            '/things/:thingId/parts/:partId',
            { auth: 'session' },
            requireAuth,
            (_req, res) => {
              res.json({});
            },
          );
        },
      ],
    });
    const manifest = getRouteManifest(app);
    expect(manifest.find((r) => r.path === '/api/things/:thingId')).toMatchObject({
      auth: 'session',
      hasResourceParam: true,
      resourceParams: ['thingId'],
    });
    expect(manifest.find((r) => r.path === '/api/things/:thingId/parts/:partId')).toMatchObject({
      resourceParams: ['thingId', 'partId'],
    });
  });

  it('rota fora do registro aparece como "unclassified" (o gate falha)', () => {
    const { app } = buildTestApp(db, {
      modules: [
        ({ router }) => {
          router.get('/sorrateira/:id', (_req, res) => {
            res.json({});
          });
        },
      ],
    });
    const rogue = getRouteManifest(app).find((r) => r.path === '/api/sorrateira/:id');
    expect(rogue).toMatchObject({ auth: 'unclassified', hasResourceParam: true });
  });

  it('router montado fora do registro tem prefixo marcado como desconhecido', () => {
    const { app } = buildTestApp(db);
    const stray = express.Router();
    stray.get('/x/:id', (_req, res) => {
      res.json({});
    });
    app.use('/api2', stray);
    const rogue = getRouteManifest(app).find((r) => r.path.endsWith('/x/:id'));
    expect(rogue?.path).toContain('<?>');
    expect(rogue?.auth).toBe('unclassified');
  });

  it('auth: "session" is structural: a session route registered WITHOUT requireAuth still answers 401', async () => {
    const { app, config } = buildTestApp(db, {
      modules: [
        ({ routes }) => {
          // Deliberately no requireAuth: the registry must attach it.
          routes.get('/vault/:id', { auth: 'session' }, (req, res) => {
            res.json({ leaked: req.auth?.ownerId ?? 'no-auth-context' });
          });
          routes.post('/vault', { auth: 'session' }, (_req, res) => {
            res.json({});
          });
        },
      ],
    });
    const checked = await expectSessionRoutesRejectAnonymous(app, config);
    expect(checked).toEqual(
      expect.arrayContaining(['GET /api/vault/:id', 'POST /api/vault', 'GET /api/auth/me']),
    );
  });

  it('an explicit requireAuth on a session route is deduplicated (the guard runs once)', async () => {
    let guardRuns = 0;
    const registry = new RouteRegistry();
    const router = express.Router();
    const guard: RequestHandler = (_req, _res, next) => {
      guardRuns += 1;
      next();
    };
    registry.setSessionGuard(guard);
    registry.group(router, '/api').get('/x', { auth: 'session' }, guard, (_req, res) => {
      res.json({});
    });
    const app = express();
    app.use(router);
    await request(app).get('/x');
    expect(guardRuns).toBe(1);
  });

  it('public routes never see req.auth, even if something upstream set it', async () => {
    const seen: unknown[] = [];
    const { app } = buildTestApp(db, {
      modules: [
        ({ router, routes }) => {
          router.use((req, _res, next) => {
            req.auth = { ownerId: 'planted' } as never;
            next();
          });
          routes.get('/open', { auth: 'public' }, (req, res) => {
            seen.push(req.auth);
            res.json({});
          });
        },
      ],
    });
    expect((await request(app).get('/api/open')).status).toBe(200);
    expect(seen).toEqual([undefined]);
  });

  it('registering a public route with the session guard, or a session route before the guard exists, throws', () => {
    const guard: RequestHandler = (_req, _res, next) => {
      next();
    };
    const early = new RouteRegistry();
    expect(() =>
      early.group(express.Router(), '/api').get('/x', { auth: 'session' }, (_req, res) => {
        res.json({});
      }),
    ).toThrow(/before the session guard/);

    const registry = new RouteRegistry();
    registry.setSessionGuard(guard);
    expect(() =>
      registry.group(express.Router(), '/api').get('/x', { auth: 'public' }, guard),
    ).toThrow(/must not use the session guard/);
    expect(() => registry.setSessionGuard(guard)).toThrow(/already set/);
  });

  it('domain modules receive no unrestricted database handle in their context', () => {
    let context: Record<string, unknown> = {};
    buildTestApp(db, {
      modules: [
        (ctx) => {
          context = { ...ctx };
        },
      ],
    });
    expect(Object.keys(context).sort()).toEqual([
      'config',
      'logger',
      'profileStore',
      'requireAuth',
      'router',
      'routes',
    ]);
    expect(context).not.toHaveProperty('db');
  });
});
