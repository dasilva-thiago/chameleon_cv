import {
  acceptInviteRequestSchema,
  apiErrorBodySchema,
  authSessionResponseSchema,
  invitePreviewRequestSchema,
  invitePreviewResponseSchema,
  loginRequestSchema,
  logoutResponseSchema,
  type ApiErrorCode,
  type AuthSessionResponse,
} from '@chameleon/contracts';
import { vi } from 'vitest';

/** Token de convite valido para o formato do contrato (43 caracteres base64url). */
export const INVITE_TOKEN = 'Tk3f9_aB-xYz0123456789ABCDEFGHIJKLMNOPQRStu';
export const CSRF_TOKEN = 'Q'.repeat(43);
export const TEST_EMAIL = 'ana.teste@example.com';
export const TEST_PASSWORD = 'uma-senha-bem-longa-123';

export function makeSession(overrides: { displayName?: string | null; email?: string } = {}) {
  return authSessionResponseSchema.parse({
    user: {
      id: '0b6c1a4e-6f4e-4f3e-9d0a-5a1f7a6d2c11',
      email: overrides.email ?? TEST_EMAIL,
      displayName: overrides.displayName === undefined ? 'Ana Teste' : overrides.displayName,
    },
    session: {
      expiresAt: '2026-11-11T12:00:00.000Z',
      absoluteExpiresAt: '2026-12-04T12:00:00.000Z',
    },
  });
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

export type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** Respostas de sucesso e de erro sao validadas pelos schemas reais do contrato. */
export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test-0001', ...headers },
  });
}

export function sessionResponse(session: AuthSessionResponse, status = 200): Response {
  return jsonResponse(status, authSessionResponseSchema.parse(session));
}

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  options: {
    message?: string;
    details?: { path: string; message: string }[];
    headers?: Record<string, string>;
  } = {},
): Response {
  const body = apiErrorBodySchema.parse({
    error: {
      code,
      message: options.message ?? 'mensagem do servidor',
      requestId: 'req-test-0001',
      ...(options.details ? { details: options.details } : {}),
    },
  });
  return jsonResponse(status, body, options.headers);
}

export function previewResponse(email = TEST_EMAIL): Response {
  return jsonResponse(
    200,
    invitePreviewResponseSchema.parse({ email, expiresAt: '2026-11-07T12:00:00.000Z' }),
  );
}

export function logoutResponse(revokedSessions = 1): Response {
  return jsonResponse(200, logoutResponseSchema.parse({ revokedSessions }));
}

const BODY_SCHEMAS: Record<string, { safeParse(data: unknown): { success: boolean } }> = {
  'POST /api/auth/login': loginRequestSchema,
  'POST /api/auth/invites/accept': acceptInviteRequestSchema,
  'POST /api/auth/invites/preview': invitePreviewRequestSchema,
};

/**
 * Servidor falso no nivel do `fetch`. Imita o comportamento do backend que importa ao cliente:
 * emite o cookie CSRF em qualquer GET /api/*, exige `X-CSRF-Token` igual ao cookie em metodos
 * mutaveis (403 CSRF_TOKEN) e rejeita corpos que violam os schemas de requisicao reais.
 */
export class FakeApi {
  readonly requests: RecordedRequest[] = [];
  session: AuthSessionResponse | null = null;
  private readonly handlers = new Map<string, Handler>();
  readonly fetch = vi.fn(async (input: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const bodyText = typeof init.body === 'string' ? init.body : undefined;
    const request: RecordedRequest = {
      method,
      path: input,
      headers,
      body: bodyText === undefined ? undefined : (JSON.parse(bodyText) as unknown),
    };
    this.requests.push(request);

    if (input.startsWith('/api/') && !document.cookie.includes('cc_csrf=')) {
      document.cookie = `cc_csrf=${CSRF_TOKEN}; path=/`;
    }
    if (method !== 'GET') {
      const cookieToken = /(?:^|;\s*)cc_csrf=([^;]+)/.exec(document.cookie)?.[1];
      if (cookieToken === undefined || headers.get('X-CSRF-Token') !== cookieToken) {
        return errorResponse(403, 'CSRF_TOKEN');
      }
      const schema = BODY_SCHEMAS[`${method} ${input}`];
      if (schema && !schema.safeParse(request.body).success) {
        return errorResponse(400, 'VALIDATION_ERROR');
      }
    }

    const handler = this.handlers.get(`${method} ${input}`) ?? this.defaultHandler(method, input);
    if (!handler) return errorResponse(404, 'NOT_FOUND');
    return handler(request);
  });

  on(route: string, handler: Handler | Response): this {
    this.handlers.set(route, typeof handler === 'function' ? handler : () => handler.clone());
    return this;
  }

  install(): this {
    vi.stubGlobal('fetch', this.fetch);
    return this;
  }

  requestsTo(route: string): RecordedRequest[] {
    return this.requests.filter((r) => `${r.method} ${r.path}` === route);
  }

  private defaultHandler(method: string, path: string): Handler | undefined {
    const route = `${method} ${path}`;
    if (route === 'GET /api/auth/me') {
      return () =>
        this.session
          ? sessionResponse(this.session)
          : errorResponse(401, 'UNAUTHENTICATED', { message: 'Autenticacao necessaria.' });
    }
    if (route === 'POST /api/auth/logout') {
      return () => {
        this.session = null;
        return logoutResponse(1);
      };
    }
    if (route === 'POST /api/auth/logout-all') {
      return () => {
        this.session = null;
        return logoutResponse(3);
      };
    }
    return undefined;
  }
}
