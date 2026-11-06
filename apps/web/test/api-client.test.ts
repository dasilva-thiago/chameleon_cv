import { authSessionResponseSchema, logoutResponseSchema } from '@chameleon/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from '../src/lib/api/auth';
import { createApiClient } from '../src/lib/api/client';
import { ApiError, isApiError } from '../src/lib/api/errors';
import { readCsrfToken } from '../src/lib/api/csrf';
import {
  CSRF_TOKEN,
  FakeApi,
  INVITE_TOKEN,
  TEST_EMAIL,
  TEST_PASSWORD,
  errorResponse,
  jsonResponse,
  logoutResponse,
  makeSession,
  previewResponse,
  sessionResponse,
} from './helpers/fake-api';

function setup(options: { timeoutMs?: number } = {}) {
  const fake = new FakeApi();
  const client = createApiClient({
    fetchImpl: fake.fetch as unknown as typeof fetch,
    ...options,
  });
  return { fake, client, auth: createAuthApi(client) };
}

describe('readCsrfToken', () => {
  it('le cc_csrf (dev) e __Host-cc_csrf (producao) e ignora outros cookies', () => {
    expect(readCsrfToken('a=1; cc_csrf=tok-dev; b=2')).toBe('tok-dev');
    expect(readCsrfToken('__Host-cc_csrf=tok-prod')).toBe('tok-prod');
    expect(readCsrfToken('cc_session=segredo; outro=1')).toBeUndefined();
    expect(readCsrfToken('')).toBeUndefined();
  });
});

describe('cliente de API: CSRF e transporte', () => {
  it('nao envia X-CSRF-Token em GET, mas envia same-origin e Accept JSON', async () => {
    const { fake, auth } = setup();
    document.cookie = `cc_csrf=${CSRF_TOKEN}; path=/`;
    fake.session = makeSession();
    await auth.getSession();
    const [request] = fake.requests;
    expect(request?.method).toBe('GET');
    expect(request?.headers.has('X-CSRF-Token')).toBe(false);
    expect(fake.fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' });
    expect(request?.headers.get('Accept')).toBe('application/json');
  });

  it('envia X-CSRF-Token igual ao cookie em mutacoes', async () => {
    const { fake, auth } = setup();
    document.cookie = `cc_csrf=${CSRF_TOKEN}; path=/`;
    fake.on('POST /api/auth/login', sessionResponse(makeSession()));
    await auth.login({ email: TEST_EMAIL, password: TEST_PASSWORD });
    const [login] = fake.requestsTo('POST /api/auth/login');
    expect(login?.headers.get('X-CSRF-Token')).toBe(CSRF_TOKEN);
    expect(login?.headers.get('Content-Type')).toBe('application/json');
  });

  it('obtem o cookie CSRF com GET /api/auth/me antes da primeira mutacao', async () => {
    const { fake, auth } = setup();
    expect(readCsrfToken()).toBeUndefined();
    fake.on('POST /api/auth/login', sessionResponse(makeSession()));
    await auth.login({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/auth/me',
      'POST /api/auth/login',
    ]);
    expect(fake.requests[1]?.headers.get('X-CSRF-Token')).toBe(CSRF_TOKEN);
  });

  it('le o cookie a cada requisicao (o servidor o rotaciona no login/logout)', async () => {
    const { fake, auth } = setup();
    document.cookie = `cc_csrf=${CSRF_TOKEN}; path=/`;
    const rotated = 'R'.repeat(43);
    fake.on('POST /api/auth/logout', () => {
      document.cookie = `cc_csrf=${rotated}; path=/`;
      return logoutResponse();
    });
    await auth.logout();
    await auth.logoutAll();
    const tokens = fake.requests.map((r) => r.headers.get('X-CSRF-Token'));
    expect(tokens).toEqual([CSRF_TOKEN, rotated]);
  });

  it('repete uma unica vez quando recebe 403 CSRF_TOKEN e entao desiste', async () => {
    document.cookie = `cc_csrf=${CSRF_TOKEN}; path=/`;
    let posts = 0;
    const flaky = vi.fn(() => {
      posts += 1;
      return Promise.resolve(posts === 1 ? errorResponse(403, 'CSRF_TOKEN') : logoutResponse());
    });
    const recovering = createAuthApi(createApiClient({ fetchImpl: flaky }));
    await expect(recovering.logout()).resolves.toEqual({ revokedSessions: 1 });
    expect(flaky).toHaveBeenCalledTimes(2);

    const broken = vi.fn(() => Promise.resolve(errorResponse(403, 'CSRF_TOKEN')));
    const failing = createAuthApi(createApiClient({ fetchImpl: broken }));
    await expect(failing.logout()).rejects.toMatchObject({ code: 'CSRF_TOKEN', status: 403 });
    expect(broken).toHaveBeenCalledTimes(2);
  });

  it('nao envia o token do convite em URL nem em query: apenas no corpo POST', async () => {
    const { fake, auth } = setup();
    fake.on('POST /api/auth/invites/preview', previewResponse());
    await auth.previewInvite(INVITE_TOKEN);
    const urls = fake.requests.map((r) => r.path);
    expect(urls.every((url) => !url.includes(INVITE_TOKEN) && !url.includes('?'))).toBe(true);
    expect(fake.requestsTo('POST /api/auth/invites/preview')[0]?.body).toEqual({
      token: INVITE_TOKEN,
    });
  });
});

describe('cliente de API: erros tipados', () => {
  it('mapeia o corpo de erro padrao para ApiError com code, status e requestId', async () => {
    const { fake, auth } = setup();
    fake.on(
      'POST /api/auth/login',
      errorResponse(401, 'INVALID_CREDENTIALS', { message: 'E-mail ou senha incorretos.' }),
    );
    const error = await auth.login({ email: TEST_EMAIL, password: 'x' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
      requestId: 'req-test-0001',
    });
  });

  it('le Retry-After em 429', async () => {
    const { fake, auth } = setup();
    fake.on(
      'POST /api/auth/login',
      errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '120' } }),
    );
    const error = await auth.login({ email: TEST_EMAIL, password: 'x' }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 120 });
  });

  it('GET /me sem sessao devolve null; outros erros sao propagados', async () => {
    const { fake, auth } = setup();
    await expect(auth.getSession()).resolves.toBeNull();
    fake.on('GET /api/auth/me', errorResponse(500, 'INTERNAL_ERROR'));
    await expect(auth.getSession()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('classifica erro sem corpo do contrato (proxy) pelo status', async () => {
    const { fake, auth } = setup();
    fake.on('GET /api/auth/me', new Response('<html>Bad Gateway</html>', { status: 502 }));
    const error = await auth.getSession().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'INTERNAL_ERROR', status: 502 });
    expect(isApiError(error)).toBe(true);
    // O HTML do proxy nunca vira mensagem do erro.
    expect((error as ApiError).message).toBe('INTERNAL_ERROR');
  });

  it('rejeita resposta de sucesso fora do contrato (campo extra) como UNEXPECTED_RESPONSE', async () => {
    const { fake, auth } = setup();
    const body = { ...authSessionResponseSchema.parse(makeSession()), extra: true };
    fake.on('GET /api/auth/me', jsonResponse(200, body));
    await expect(auth.getSession()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    fake.on('POST /api/auth/logout', jsonResponse(200, { revokedSessions: 'muitas' }));
    await expect(auth.logout()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
    expect(logoutResponseSchema.safeParse({ revokedSessions: 'muitas' }).success).toBe(false);
  });

  it('falha de rede vira NETWORK', async () => {
    const client = createApiClient({
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(createAuthApi(client).getSession()).rejects.toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
  });

  it('estoura o tempo limite e aborta a requisicao (TIMEOUT)', async () => {
    let aborted = false;
    const fetchImpl = ((_input: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const client = createApiClient({ fetchImpl, timeoutMs: 20 });
    await expect(createAuthApi(client).getSession()).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(aborted).toBe(true);
  });

  it('timeoutMs da requisicao sobrescreve o padrao do cliente (operacoes longas nao estouram)', async () => {
    const slowOk = ((_input: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        setTimeout(() => {
          resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        }, 60);
      })) as unknown as typeof fetch;
    const schema = { safeParse: (data: unknown) => ({ success: true as const, data }) };

    // Padrao de 20 ms: a resposta de 60 ms chega tarde demais.
    const strict = createApiClient({ fetchImpl: slowOk, timeoutMs: 20 });
    await expect(strict.get('/api/lento', { schema })).rejects.toMatchObject({ code: 'TIMEOUT' });

    // Com 500 ms so nesta requisicao, a mesma resposta lenta e aceita.
    await expect(strict.get('/api/lento', { schema, timeoutMs: 500 })).resolves.toEqual({
      ok: true,
    });
  });

  it('respeita o AbortSignal externo (ABORTED)', async () => {
    const fetchImpl = ((_input: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const client = createApiClient({ fetchImpl });
    const controller = new AbortController();
    const pending = createAuthApi(client).getSession(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('valida a requisicao com o schema do contrato antes de enviar', async () => {
    const { fake, auth } = setup();
    await expect(auth.login({ email: 'nao-e-email', password: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(auth.previewInvite('curto')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fake.requests).toHaveLength(0);
  });

  it('normaliza o e-mail (trim + minusculas) como o contrato', async () => {
    const { fake, auth } = setup();
    fake.on('POST /api/auth/login', sessionResponse(makeSession()));
    await auth.login({ email: '  Ana.Teste@Example.COM ', password: TEST_PASSWORD });
    expect(fake.requestsTo('POST /api/auth/login')[0]?.body).toEqual({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
  });
});
