import type { AuthContext } from '../auth/context';

declare global {
  namespace Express {
    interface Request {
      /** Identificador de correlacao da requisicao (ver http/errors.ts; nao use `req.id`, que o pino-http tipa como ReqId). */
      correlationId: string;
      /** Preenchido por `requireAuth` (auth/middleware.ts). Ausente em rotas publicas. */
      auth?: AuthContext;
    }
  }
}

export {};
