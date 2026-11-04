import type { OwnerScopedClient } from '@chameleon/db';
import type { Request } from 'express';
import { HttpError } from '../http/errors';

/**
 * Contexto autenticado de uma requisicao (preenchido por `requireAuth`). Handlers de modulos
 * privados usam SOMENTE `auth.db` (cliente escopado ao dono) e `auth.ownerId`: nunca `db.global`
 * nem `db.unsafeRaw` para dados privados (ADR-0008).
 */
export interface AuthContext {
  readonly ownerId: string;
  readonly sessionId: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
  };
  readonly session: { readonly expiresAt: Date; readonly absoluteExpiresAt: Date };
  /** `db.forOwner(ownerId)`. */
  readonly db: OwnerScopedClient;
}

/** Le o contexto; lanca 401 se o handler foi montado sem `requireAuth` (falha fechada). */
export function requireAuthContext(req: Request): AuthContext {
  if (!req.auth) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticacao necessaria.');
  }
  return req.auth;
}
