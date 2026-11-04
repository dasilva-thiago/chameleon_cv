import { createDb } from '@chameleon/db';
import express from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import { getRouteManifest } from '../src/http';
import { buildTestApp, testConfig } from './helpers';

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
});
