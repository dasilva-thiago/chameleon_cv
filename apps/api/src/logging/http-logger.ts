import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

export const UNMATCHED_ROUTE = '<unmatched>';

/**
 * Route template for the access log. The route registry records the full template of the matched
 * route in `res.locals.routeTemplate` (see http/route-registry.ts); for a route mounted outside the
 * registry we fall back to `baseUrl + req.route.path`. Anything else (404, parser/CSRF failures
 * before routing) is `<unmatched>`: the raw URL is never logged.
 */
export function routeTemplate(req: Request | undefined): string {
  if (!req) return UNMATCHED_ROUTE;
  const recorded = (req.res?.locals as { routeTemplate?: unknown } | undefined)?.routeTemplate;
  if (typeof recorded === 'string') return recorded;
  const route = (req as { route?: { path?: unknown } }).route;
  return typeof route?.path === 'string' ? `${req.baseUrl}${route.path}` : UNMATCHED_ROUTE;
}

/**
 * Log de acesso por requisicao. SO registra: id de correlacao (gerado no servidor) e `clientRequestId` (X-Request-Id do cliente, so em log), metodo, TEMPLATE da rota casada (nunca a URL crua),
 * status, duracao e ownerId (UUID opaco, nao e PII). Cabecalhos (cookie, token CSRF), corpo e
 * query nunca entram no log (ADR-0014: logs sem conteudo; `REDACT_PATHS` e a segunda linha).
 */
export function createHttpLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req) => (req as Request).correlationId,
    quietReqLogger: true,
    autoLogging: {
      ignore: (req) => {
        const path = (req as Request).path;
        return path === '/health' || path === '/api/health';
      },
    },
    serializers: {
      // The matched route TEMPLATE (`/api/things/:id`), never the raw URL: paths can carry
      // identifiers, tokens or PII (ADR-0014). pino-http binds `req` when the request ARRIVES,
      // before routing, so while the response is still pending the field is omitted (undefined);
      // the access-log record re-adds the request below, once the template is known.
      req: (serialized: { method?: string; raw?: Request }) => {
        const res = serialized.raw?.res;
        const done = res !== undefined && (res.writableEnded || res.headersSent || res.destroyed);
        return done
          ? { method: serialized.method, path: routeTemplate(serialized.raw) }
          : undefined;
      },
      res: (serialized: { statusCode?: number }) => ({ statusCode: serialized.statusCode }),
    },
    customSuccessObject: (req, _res, value: Record<string, unknown>) => ({ ...value, req }),
    customErrorObject: (req, _res, _error, value: Record<string, unknown>) => ({ ...value, req }),
    customProps: (req) => ({
      ownerId: (req as Request).auth?.ownerId,
      clientRequestId: (req as Request).clientRequestId,
    }),
    customLogLevel: (_req, res, error) =>
      error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
  });
}
