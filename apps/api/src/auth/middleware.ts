import type { Db } from '@chameleon/db';
import type { RequestHandler } from 'express';
import { type CookieSettings, clearSessionCookie, readCookie } from '../http/cookies';
import { HttpError } from '../http/errors';
import type { AuthContext } from './context';
import type { SessionService } from './sessions';

/**
 * `requireAuth`: resolve o cookie de sessao e injeta `req.auth` (ownerId + `db.forOwner(ownerId)`).
 * Sem cookie ou com sessao invalida/expirada/revogada -> 401 (e o cookie e limpo). Todo modulo
 * privado monta suas rotas atras deste middleware.
 */
export function createRequireAuth(deps: {
  sessions: SessionService;
  db: Db;
  cookies: CookieSettings;
}): RequestHandler {
  const { sessions, db, cookies } = deps;
  return async (req, res, next) => {
    const token = readCookie(req, cookies.sessionName);
    if (token === undefined || token === '') {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticacao necessaria.');
    }
    const resolved = await sessions.resolve(token);
    if (!resolved) {
      clearSessionCookie(res, cookies);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticacao necessaria.');
    }
    const { session, user } = resolved;
    const context: AuthContext = {
      ownerId: user.id,
      sessionId: session.id,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      session: { expiresAt: session.expiresAt, absoluteExpiresAt: session.absoluteExpiresAt },
      db: db.forOwner(user.id),
    };
    req.auth = context;
    next();
  };
}
