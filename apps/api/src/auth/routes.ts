import {
  acceptInviteRequestSchema,
  invitePreviewRequestSchema,
  loginRequestSchema,
} from '@chameleon/contracts';
import { type RequestHandler, Router } from 'express';
import {
  type CookieSettings,
  clearSessionCookie,
  readCookie,
  setCsrfCookie,
  setSessionCookie,
} from '../http/cookies';
import { generateCsrfToken } from '../http/csrf';
import type { RouteRegistry } from '../http/route-registry';
import { parseWithSchema } from '../http/validation';
import { requireAuthContext } from './context';
import type { createAuthRateLimiters } from './rate-limits';
import { type AuthService, toSessionResponse } from './service';

export interface AuthRoutesDeps {
  service: AuthService;
  cookies: CookieSettings;
  requireAuth: RequestHandler;
  limiters: ReturnType<typeof createAuthRateLimiters>;
  registry: RouteRegistry;
}

/** Rotas `/api/auth/*`. Corpo sempre validado pelos DTOs de `@chameleon/contracts`. */
export function createAuthRouter(deps: AuthRoutesDeps): Router {
  const { service, cookies, requireAuth, limiters, registry } = deps;
  const router = Router();
  const routes = registry.group(router, '/api/auth');

  routes.post(
    '/login',
    { auth: 'public', description: 'Login por e-mail e senha; rotaciona a sessao.' },
    ...limiters.login,
    async (req, res) => {
      const body = parseWithSchema(loginRequestSchema, req.body);
      const issued = await service.login({
        email: body.email,
        password: body.password,
        currentToken: readCookie(req, cookies.sessionName),
        userAgent: req.get('user-agent'),
        correlationId: req.correlationId,
      });
      setSessionCookie(res, cookies, issued.token);
      setCsrfCookie(res, cookies, generateCsrfToken());
      res.json(issued.response);
    },
  );

  routes.post(
    '/invites/preview',
    { auth: 'public', description: 'Confere um convite e devolve o e-mail convidado.' },
    limiters.invite,
    async (req, res) => {
      const body = parseWithSchema(invitePreviewRequestSchema, req.body);
      res.json(await service.previewInvite(body.token));
    },
  );

  routes.post(
    '/invites/accept',
    { auth: 'public', description: 'Aceita o convite: cria a conta e inicia a sessao.' },
    limiters.invite,
    async (req, res) => {
      const body = parseWithSchema(acceptInviteRequestSchema, req.body);
      const issued = await service.acceptInvite({
        ...body,
        userAgent: req.get('user-agent'),
        correlationId: req.correlationId,
      });
      setSessionCookie(res, cookies, issued.token);
      setCsrfCookie(res, cookies, generateCsrfToken());
      res.status(201).json(issued.response);
    },
  );

  routes.get(
    '/me',
    { auth: 'session', description: 'Usuario e sessao atuais.' },
    requireAuth,
    (req, res) => {
      const auth = requireAuthContext(req);
      res.json(toSessionResponse(auth.user, auth.session));
    },
  );

  routes.post(
    '/logout',
    { auth: 'session', description: 'Revoga a sessao atual.' },
    requireAuth,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const revoked = await service.logout(auth.ownerId, auth.sessionId, req.correlationId);
      clearSessionCookie(res, cookies);
      setCsrfCookie(res, cookies, generateCsrfToken());
      res.json({ revokedSessions: revoked });
    },
  );

  routes.post(
    '/logout-all',
    { auth: 'session', description: 'Revoga todas as sessoes do usuario (todos os dispositivos).' },
    requireAuth,
    async (req, res) => {
      const auth = requireAuthContext(req);
      const revoked = await service.logoutAll(auth.ownerId, req.correlationId);
      clearSessionCookie(res, cookies);
      setCsrfCookie(res, cookies, generateCsrfToken());
      res.json({ revokedSessions: revoked });
    },
  );

  return router;
}
