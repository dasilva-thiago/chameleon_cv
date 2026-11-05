import { createDb, type Db } from '@chameleon/db';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  expectSessionRoutesRejectAnonymous,
  TestClient,
  testConfig,
} from './helpers';

// Sem rede: o cliente do Prisma so conecta no primeiro uso. Rotas exercitadas aqui falham antes
// de qualquer consulta (CSRF, parser, 401 sem cookie, 404).
const db = createDb({ connectionString: testConfig().DATABASE_URL });
afterAll(async () => db.$disconnect());

function buildApp() {
  return buildTestApp(db).app;
}

describe('createApp', () => {
  it('GET /health e /api/health respondem 200 {status:"ok"} sem abrir porta fixa', async () => {
    for (const path of ['/health', '/api/health']) {
      const response = await request(buildApp()).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    }
  });

  it('devolve X-Request-Id e nao expoe X-Powered-By', async () => {
    const response = await request(buildApp()).get('/health');
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('always generates the correlation id server-side; a client X-Request-Id is never echoed', async () => {
    const app = buildApp();
    for (const sent of ['abc12345-trace', 'bad id with spaces!', 'x'.repeat(500)]) {
      const response = await request(app).get('/health').set('X-Request-Id', sent);
      expect(response.headers['x-request-id']).not.toBe(sent);
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    const first = await request(app).get('/health');
    const second = await request(app).get('/health');
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('rota inexistente devolve erro estruturado 404 (dentro e fora de /api)', async () => {
    for (const path of ['/nao-existe', '/api/nao-existe']) {
      const response = await request(buildApp()).get(path);
      expect(response.status).toBe(404);
      const body = response.body as { error: { code: string; requestId: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.requestId).toBe(response.headers['x-request-id']);
    }
  });

  it('aplica cabecalhos de seguranca (helmet) e no-store na API', async () => {
    const response = await request(buildApp()).get('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['referrer-policy']).toBeDefined();
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('parser JSON e erros', () => {
  it('JSON malformado -> 400 INVALID_JSON sem eco do conteudo', async () => {
    const client = new TestClient(buildApp(), testConfig());
    const response = await client.postRaw(
      '/api/auth/login',
      '{"email": "canary-json@example.test", ',
    );
    expect(response.status).toBe(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(response.body)).not.toContain('canary-json');
  });

  it('corpo acima do limite -> 413 PAYLOAD_TOO_LARGE', async () => {
    const config = testConfig({ JSON_BODY_LIMIT_BYTES: '1024' });
    const client = new TestClient(buildTestApp(db, { config }).app, config);
    const response = await client.postRaw(
      '/api/auth/login',
      JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(5000) }),
    );
    expect(response.status).toBe(413);
    expect((response.body as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('campo desconhecido e tipos errados -> 400 VALIDATION_ERROR com caminhos (sem valores)', async () => {
    const client = new TestClient(buildApp(), testConfig());
    const response = await client.post('/api/auth/login', {
      email: 'nao-e-email',
      password: 12345,
      extra: 'canary-valor',
    });
    expect(response.status).toBe(400);
    const body = response.body as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toContain('canary-valor');
  });
});

describe('CSRF (Origin + X-CSRF-Token)', () => {
  it('metodo nao seguro sem X-CSRF-Token -> 403 CSRF_TOKEN', async () => {
    const client = new TestClient(buildApp(), testConfig());
    await client.get('/api/auth/me');
    const response = await client.post(
      '/api/auth/login',
      { email: 'a@example.test', password: 'x' },
      { csrf: null },
    );
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('CSRF_TOKEN');
  });

  it('token diferente do cookie -> 403 CSRF_TOKEN', async () => {
    const client = new TestClient(buildApp(), testConfig());
    await client.get('/api/auth/me');
    const response = await client.post('/api/auth/logout', undefined, {
      csrf: 'A'.repeat(43),
    });
    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe('CSRF_TOKEN');
  });

  it('sem cookie CSRF previo -> 403, mas a resposta ja emite o cookie para a nova tentativa', async () => {
    const response = await request(buildApp())
      .post('/api/auth/logout')
      .set('Origin', testConfig().APP_ORIGIN)
      .set('X-CSRF-Token', 'A'.repeat(43));
    expect(response.status).toBe(403);
    expect(String(response.headers['set-cookie'])).toContain('__Host-cc_csrf=');
  });

  it('Origin de outro site, "null" ou ausente -> 403 CSRF_ORIGIN', async () => {
    const client = new TestClient(buildApp(), testConfig());
    await client.get('/api/auth/me');
    for (const origin of ['https://evil.example', 'null', null]) {
      const response = await client.post('/api/auth/logout', undefined, { origin });
      expect(response.status).toBe(403);
      expect((response.body as { error: { code: string } }).error.code).toBe('CSRF_ORIGIN');
    }
  });

  it('aceita Referer da origem permitida quando nao ha Origin; rejeita Referer alheio', async () => {
    const config = testConfig();
    const client = new TestClient(buildApp(), config);
    await client.get('/api/auth/me');
    const good = await client.post('/api/auth/logout', undefined, {
      origin: null,
      headers: { Referer: `${config.APP_ORIGIN}/algum/caminho` },
    });
    expect(good.status).toBe(401); // passou do CSRF; falta sessao
    const bad = await client.post('/api/auth/logout', undefined, {
      origin: null,
      headers: { Referer: 'https://evil.example/x' },
    });
    expect(bad.status).toBe(403);
  });

  it('metodos seguros (GET) nao exigem token', async () => {
    const response = await request(buildApp()).get('/api/auth/me');
    expect(response.status).toBe(401);
  });
});

describe('rotas protegidas sem sessao', () => {
  it('every `session` route in the manifest answers 401 without a cookie', async () => {
    const checked = await expectSessionRoutesRejectAnonymous(buildApp(), testConfig());
    expect(checked.length).toBeGreaterThan(0);
  });

  it('cookie de sessao malformado -> 401 sem consultar o banco', async () => {
    const config = testConfig();
    const client = new TestClient(buildApp(), config);
    client.setCookie(`${config.APP_ORIGIN.startsWith('https') ? '__Host-' : ''}cc_session`, 'lixo');
    const response = await client.get('/api/auth/me');
    expect(response.status).toBe(401);
  });
});

describe('erro 500', () => {
  it('nao vaza stack, mensagem ou SQL no corpo e nao loga a mensagem', async () => {
    const secret = 'CANARY-500-postgres://user:senha@host/db';
    const broken = {
      global: {
        user: {
          findUnique: () => {
            throw new Error(`falha interna ${secret}`);
          },
        },
      },
      forOwner: () => {
        throw new Error(secret);
      },
      unsafeRaw: {},
      $disconnect: () => Promise.resolve(),
    } as unknown as Db;
    const { app, config, logs } = buildTestApp(broken);
    const client = new TestClient(app, config);
    const response = await client.post('/api/auth/login', {
      email: 'qualquer@example.test',
      password: 'uma-senha-qualquer',
    });
    expect(response.status).toBe(500);
    const text = JSON.stringify(response.body);
    expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(text).not.toMatch(/stack|\bat \w|CANARY|postgres:|senha/i);
    // O log registra tipo e quadros, nunca a mensagem (que pode carregar dados do usuario).
    expect(logs.text()).not.toContain('CANARY-500');
    expect(logs.text()).toContain('unhandled error');
  });
});
