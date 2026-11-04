import type { Request, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

/**
 * Log de acesso por requisicao. SO registra: id de correlacao, metodo, caminho SEM query string,
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
      req: (serialized: { method?: string; raw?: Request }) => ({
        method: serialized.method,
        path: serialized.raw?.originalUrl.split('?')[0],
      }),
      res: (serialized: { statusCode?: number }) => ({ statusCode: serialized.statusCode }),
    },
    customProps: (req) => ({ ownerId: (req as Request).auth?.ownerId }),
    customLogLevel: (_req, res, error) =>
      error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
  });
}
