import { type Db, type ProfileStore, createProfileStore } from '@chameleon/db';
import { buildProfileSnapshot } from '@chameleon/domain';
import express, { type Express, type RequestHandler, type Router } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { type AuthModule, createAuthModule } from './auth';
import type { AuthRateLimits } from './auth/rate-limits';
import type { SessionPolicy } from './auth/sessions';
import type { AppConfig } from './config';
import {
  RouteRegistry,
  type RouteGroup,
  createErrorHandler,
  csrfCookieIssuer,
  csrfGuard,
  notFoundHandler,
  requestId,
} from './http';
import { createHttpLogger } from './logging';

/** O que um modulo de dominio recebe para montar suas rotas em `/api` (profiles, imports, ...). */
export interface ApiModuleContext {
  /** Roteador `/api`: CSRF, parser JSON e no-store ja aplicados. */
  router: Router;
  /** Declara rotas em `/api` registrando-as no manifesto (`getRouteManifest`). */
  routes: RouteGroup;
  /**
   * The session guard. Routes declared with `auth: 'session'` get it from the registry
   * automatically; passing it explicitly is accepted (and deduplicated) but no longer required.
   */
  requireAuth: RequestHandler;
  /**
   * Profile persistence, built by the composition root. Modules NEVER receive the unrestricted
   * `Db` (`global`/`unsafeRaw`; ADR-0008 item 2): they use this store or `req.auth.db`, the client
   * scoped to the authenticated owner.
   */
  profileStore: ProfileStore;
  logger: Logger;
  config: AppConfig;
}

export type ApiModule = (context: ApiModuleContext) => void;

export interface AppDeps {
  config: AppConfig;
  logger: Logger;
  /** Banco (`createDb()`); o app nunca o encerra: quem o criou chama `$disconnect()`. */
  db: Db;
  /** Relogio injetavel (testes de expiracao). Padrao: `new Date()`. */
  now?: () => Date;
  /** Sobrescritas dos limites (testes). Em producao valem os padroes do ADR-0009. */
  rateLimits?: Partial<AuthRateLimits>;
  sessionPolicy?: Partial<SessionPolicy>;
  /** Modulos de dominio adicionais (as fatias seguintes entram aqui; testes tambem). */
  modules?: readonly ApiModule[];
}

/** Evita cache de respostas da API (dados de sessao e de conta). */
const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

const health: RequestHandler = (_req, res) => {
  res.json({ status: 'ok' });
};

/**
 * Monta a aplicacao Express sem abrir porta: testavel com supertest, sem rede.
 *
 * Ordem: request-id -> log de acesso -> helmet -> /health -> /api (no-store, cookie CSRF, guarda
 * CSRF, parser JSON com limite, modulos) -> 404 -> erro estruturado. Modulos de dominio (profiles,
 * imports, ...) montam suas rotas em `/api` atras de `auth.requireAuth`, declaradas por
 * `registry.group(...)` para aparecerem no manifesto de rotas (`getRouteManifest(app)`).
 */
export function createApp(deps: AppDeps): Express {
  const { config, logger, db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = express();
  const registry = new RouteRegistry();
  registry.attach(app);

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestId);
  app.use(createHttpLogger(logger));
  app.use(helmet());

  registry.group(app, '').get('/health', { auth: 'public', description: 'Liveness.' }, health);

  const auth: AuthModule = createAuthModule({
    config,
    authDb: db,
    logger,
    registry,
    now,
    ...(deps.rateLimits ? { rateLimits: deps.rateLimits } : {}),
    ...(deps.sessionPolicy ? { sessionPolicy: deps.sessionPolicy } : {}),
  });

  const api = express.Router();
  api.use(noStore);
  api.use(csrfCookieIssuer(auth.cookies));
  api.use(csrfGuard(config, auth.cookies));
  api.use(express.json({ limit: config.JSON_BODY_LIMIT_BYTES, strict: true }));
  const routes = registry.group(api, '/api');
  routes.get('/health', { auth: 'public', description: 'Liveness.' }, health);
  registry.mount(api, '/auth', auth.router);
  const profileStore = createProfileStore(db, { snapshot: buildProfileSnapshot });
  for (const mount of deps.modules ?? []) {
    mount({ router: api, routes, requireAuth: auth.requireAuth, profileStore, logger, config });
  }
  registry.mount(app, '/api', api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
