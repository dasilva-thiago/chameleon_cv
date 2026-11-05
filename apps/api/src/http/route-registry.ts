import type { Express, IRouter, RequestHandler, Router } from 'express';

/**
 * Registro e MANIFESTO de rotas (ADR-0008, item 5b). Toda rota da API e declarada por um `group`,
 * que a classifica (`public` | `session`). `getRouteManifest(app)` percorre a pilha REAL do
 * Express e cruza com o registro: rota presente no Express e ausente do registro aparece como
 * `unclassified`, e o gate de isolamento (S1.4) falha. Parametros de recurso (`:id`) sao derivados
 * do proprio caminho, nao do registro.
 */

export type RouteAuth = 'public' | 'session';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteMeta {
  /** `session`: the registry attaches `requireAuth` itself (401 without a session). */
  auth: RouteAuth;
  /** Texto curto para humanos (documentacao do manifesto). */
  description?: string;
}

export interface RouteManifestEntry {
  method: HttpMethod;
  /** Caminho completo, com prefixo (ex.: `/api/things/:id`). */
  path: string;
  auth: RouteAuth | 'unclassified';
  /** Metodo nao seguro (exige Origin + X-CSRF-Token). */
  mutating: boolean;
  /** Nomes dos parametros de caminho (ex.: `['id']`). */
  resourceParams: string[];
  /** Verdadeiro se o caminho tem parametro: exige caso cruzado A/B no gate de isolamento. */
  hasResourceParam: boolean;
  description?: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type Lower = (typeof METHODS)[number];

type RouteDefiner = (path: string, meta: RouteMeta, ...handlers: RequestHandler[]) => void;
export type RouteGroup = Record<Lower, RouteDefiner>;

const REGISTRY_KEY = Symbol.for('chameleon.routeRegistry');

function joinPaths(prefix: string, path: string): string {
  const joined = `${prefix}${path === '/' ? '' : path}`.replace(/\/{2,}/g, '/');
  return joined === '' ? '/' : joined;
}

interface RouteLayer {
  route?: { path: unknown; methods: Record<string, boolean | undefined> };
  handle?: { stack?: RouteLayer[] };
}

export class RouteRegistry {
  private readonly meta = new Map<string, RouteMeta>();
  private readonly mounts = new WeakMap<object, string>();
  private sessionGuard: RequestHandler | undefined;

  /**
   * Registers the middleware that resolves the session and sets `req.auth`. Called once by the auth
   * module BEFORE any `session` route is declared. From then on `auth: 'session'` is structural: the
   * registry itself puts the guard in front of the route handlers, so a session route cannot be
   * registered without it (the declared meta is no longer self-asserted).
   */
  setSessionGuard(guard: RequestHandler): void {
    if (this.sessionGuard !== undefined)
      throw new Error('RouteRegistry: session guard already set.');
    this.sessionGuard = guard;
  }

  /** Cria uma API de declaracao de rotas em `target` (app ou router) sob `prefix`. */
  group(target: IRouter, prefix: string): RouteGroup {
    const define = (method: Lower): RouteDefiner => {
      return (path, meta, ...handlers) => {
        const template = joinPaths(prefix, path);
        this.meta.set(`${method.toUpperCase()} ${template}`, meta);
        target[method](path, ...this.chain(meta, template, handlers));
      };
    };
    return {
      get: define('get'),
      post: define('post'),
      put: define('put'),
      patch: define('patch'),
      delete: define('delete'),
    };
  }

  /** Handler chain for a route: template recorder, then the auth policy implied by `meta.auth`. */
  private chain(meta: RouteMeta, template: string, handlers: RequestHandler[]): RequestHandler[] {
    const guard = this.sessionGuard;
    const record: RequestHandler = (_req, res, next) => {
      res.locals.routeTemplate = template;
      next();
    };
    if (meta.auth === 'session') {
      if (guard === undefined) {
        throw new Error(
          `RouteRegistry: session route ${template} declared before the session guard.`,
        );
      }
      // A module may still pass `requireAuth` explicitly (compat); it must not run twice.
      return [record, guard, ...handlers.filter((handler) => handler !== guard)];
    }
    if (guard !== undefined && handlers.includes(guard)) {
      throw new Error(`RouteRegistry: public route ${template} must not use the session guard.`);
    }
    // Public routes never see an authenticated context, whatever ran before them.
    const strip: RequestHandler = (req, _res, next) => {
      delete req.auth;
      next();
    };
    return [record, strip, ...handlers];
  }

  /** Monta `router` em `parent` registrando o prefixo (necessario para o manifesto). */
  mount(parent: IRouter, prefix: string, router: Router): void {
    this.mounts.set(router, prefix);
    parent.use(prefix, router);
  }

  /** Marca o proprio app como raiz (prefixo vazio) para a varredura. */
  attach(app: Express): void {
    (app.locals as Record<symbol, unknown>)[REGISTRY_KEY] = this;
  }

  manifest(app: Express): RouteManifestEntry[] {
    const entries: RouteManifestEntry[] = [];
    const root = (app as unknown as { router: { stack: RouteLayer[] } }).router;
    this.walk(root.stack, '', entries);
    return entries.sort((a, b) =>
      a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path),
    );
  }

  private walk(stack: RouteLayer[], prefix: string, out: RouteManifestEntry[]): void {
    for (const layer of stack) {
      if (layer.route) {
        const path = joinPaths(prefix, String(layer.route.path));
        for (const method of METHODS) {
          if (layer.route.methods[method] !== true) continue;
          const upper = method.toUpperCase() as HttpMethod;
          const meta = this.meta.get(`${upper} ${path}`);
          const resourceParams = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? '');
          out.push({
            method: upper,
            path,
            auth: meta?.auth ?? 'unclassified',
            mutating: upper !== 'GET',
            resourceParams,
            hasResourceParam: resourceParams.length > 0,
            ...(meta?.description ? { description: meta.description } : {}),
          });
        }
      } else if (layer.handle?.stack) {
        const mounted = this.mounts.get(layer.handle);
        // Router montado sem `mount()`: prefixo desconhecido -> caminho marcado, gate falha.
        this.walk(
          layer.handle.stack,
          mounted === undefined ? `${prefix}/<?>` : joinPaths(prefix, mounted),
          out,
        );
      }
    }
  }
}

/** Manifesto de rotas de um app criado por `createApp` (ver docs: gate de isolamento da S1.4). */
export function getRouteManifest(app: Express): RouteManifestEntry[] {
  const registry = (app.locals as Record<symbol, unknown>)[REGISTRY_KEY];
  if (!(registry instanceof RouteRegistry)) {
    throw new Error('App sem RouteRegistry: crie-o com createApp().');
  }
  return registry.manifest(app);
}
