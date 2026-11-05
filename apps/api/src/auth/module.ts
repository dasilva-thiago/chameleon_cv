import type { Db } from '@chameleon/db';
import type { RequestHandler, Router } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from '../config';
import { type CookieSettings, cookieSettings } from '../http/cookies';
import type { RouteRegistry } from '../http/route-registry';
import { createRequireAuth } from './middleware';
import { getDummyHash } from './passwords';
import {
  type AuthRateLimits,
  DEFAULT_AUTH_RATE_LIMITS,
  createAuthRateLimiters,
} from './rate-limits';
import { createAuthRouter } from './routes';
import { AuthService } from './service';
import { DEFAULT_SESSION_POLICY, type SessionPolicy, SessionService } from './sessions';

export interface AuthModuleDeps {
  config: AppConfig;
  /**
   * Unrestricted database handle (`global` + `unsafeRaw`). This is the ONLY place that receives it:
   * identity lookups (session by token hash, user by e-mail, invites) happen before an owner is known.
   * Domain modules get no `Db` at all (ADR-0008 item 2); they use `req.auth.db`.
   */
  authDb: Db;
  logger: Logger;
  registry: RouteRegistry;
  now: () => Date;
  rateLimits?: Partial<AuthRateLimits>;
  sessionPolicy?: Partial<SessionPolicy>;
}

export interface AuthModule {
  router: Router;
  /** Middleware que exige sessao e injeta `req.auth`. Modulos privados o aplicam em TODAS as rotas. */
  requireAuth: RequestHandler;
  cookies: CookieSettings;
}

export function createAuthModule(deps: AuthModuleDeps): AuthModule {
  const cookies = cookieSettings(deps.config);
  const sessions = new SessionService(deps.authDb, deps.now, {
    ...DEFAULT_SESSION_POLICY,
    ...deps.sessionPolicy,
  });
  const service = new AuthService({
    db: deps.authDb,
    sessions,
    policyVersions: deps.config.PROFILE_POLICY_VERSIONS,
    logger: deps.logger,
    now: deps.now,
    signupMode: deps.config.SIGNUP_MODE,
  });
  const requireAuth = createRequireAuth({ sessions, db: deps.authDb, cookies });
  // From here on `auth: 'session'` routes get `requireAuth` from the registry itself.
  deps.registry.setSessionGuard(requireAuth);
  const limiters = createAuthRateLimiters({ ...DEFAULT_AUTH_RATE_LIMITS, ...deps.rateLimits });
  // Aquece o hash ficticio para que o primeiro login de e-mail inexistente nao seja mais lento.
  void getDummyHash();
  const router = createAuthRouter({
    service,
    cookies,
    requireAuth,
    limiters,
    registry: deps.registry,
  });
  return { router, requireAuth, cookies };
}
