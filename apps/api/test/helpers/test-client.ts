import { parseSetCookie } from 'cookie';
import type { Express } from 'express';
import request from 'supertest';
import type { AppConfig } from '../../src/config';
import { cookieSettings } from '../../src/http/cookies';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type TestResponse = Awaited<ReturnType<ReturnType<typeof request>['get']>>;

export interface RequestOptions {
  /** `null` omite o cabecalho Origin; padrao: APP_ORIGIN. */
  origin?: string | null;
  /** `null` omite X-CSRF-Token; padrao: valor do cookie CSRF do cliente. */
  csrf?: string | null;
  /** `false` nao envia nenhum cookie (simula cliente sem sessao). */
  cookies?: boolean;
  headers?: Record<string, string>;
}

/**
 * Cliente HTTP de teste com "cookie jar" manual: os cookies de producao sao `Secure` (e o
 * supertest fala http), entao o jar do superagent nao serve. Envia Origin e X-CSRF-Token como a
 * SPA faria, e permite desligar cada um para os testes negativos.
 */
export class TestClient {
  private readonly jar = new Map<string, string>();
  private readonly names: ReturnType<typeof cookieSettings>;

  constructor(
    private readonly app: Express,
    private readonly config: Pick<AppConfig, 'APP_ORIGIN'>,
  ) {
    this.names = cookieSettings(config);
  }

  get sessionToken(): string | undefined {
    return this.jar.get(this.names.sessionName);
  }

  get csrfToken(): string | undefined {
    return this.jar.get(this.names.csrfName);
  }

  /** Sobrescreve um cookie (ex.: restaurar um cookie antigo para provar revogacao). */
  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
  }

  cookieHeader(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get sessionCookieName(): string {
    return this.names.sessionName;
  }

  get csrfCookieName(): string {
    return this.names.csrfName;
  }

  async request(
    method: Method,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<TestResponse> {
    const mutating = method !== 'get';
    if (mutating && options.csrf === undefined && options.cookies !== false && !this.csrfToken) {
      // Como a SPA: um GET inicial emite o cookie CSRF.
      await this.request('get', '/api/auth/me');
    }
    let req = request(this.app)[method](path);
    const sendCookies = options.cookies !== false;
    if (sendCookies && this.jar.size > 0) req = req.set('Cookie', this.cookieHeader());
    if (mutating) {
      const origin = options.origin === undefined ? this.config.APP_ORIGIN : options.origin;
      if (origin !== null) req = req.set('Origin', origin);
      const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
      if (csrf !== null && csrf !== undefined) req = req.set('X-CSRF-Token', csrf);
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) req = req.set(name, value);
    const response = await (body === undefined ? req : req.send(body as object));
    this.capture(response);
    return response;
  }

  private capture(response: TestResponse): void {
    const raw = response.headers['set-cookie'] as string[] | string | undefined;
    const lines = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    for (const line of lines) {
      const cookie = parseSetCookie(line);
      if (cookie.value === undefined || cookie.value === '' || cookie.maxAge === 0) {
        this.jar.delete(cookie.name);
      } else {
        this.jar.set(cookie.name, cookie.value);
      }
    }
  }

  /** POST com corpo bruto (string) e Content-Type explicito: JSON malformado, corpo grande, etc. */
  async postRaw(
    path: string,
    payload: string,
    options: RequestOptions & { contentType?: string } = {},
  ): Promise<TestResponse> {
    if (!this.csrfToken) await this.request('get', '/api/auth/me');
    let req = request(this.app)
      .post(path)
      .set('Content-Type', options.contentType ?? 'application/json');
    if (this.jar.size > 0) req = req.set('Cookie', this.cookieHeader());
    const origin = options.origin === undefined ? this.config.APP_ORIGIN : options.origin;
    if (origin !== null) req = req.set('Origin', origin);
    const csrf = options.csrf === undefined ? this.csrfToken : options.csrf;
    if (csrf !== null && csrf !== undefined) req = req.set('X-CSRF-Token', csrf);
    const response = await req.send(payload);
    this.capture(response);
    return response;
  }

  get(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('get', path, undefined, options);
  }
  post(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
    return this.request('post', path, body, options);
  }
  put(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
    return this.request('put', path, body, options);
  }
  patch(path: string, body?: unknown, options?: RequestOptions): Promise<TestResponse> {
    return this.request('patch', path, body, options);
  }
  delete(path: string, options?: RequestOptions): Promise<TestResponse> {
    return this.request('delete', path, undefined, options);
  }
}
