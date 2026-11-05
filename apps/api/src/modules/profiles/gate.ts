import type { RequestHandler } from 'express';
import { requireAuthContext } from '../../auth/context';
import { hasGrantedConsent } from '../../consent';
import { HttpError } from '../../http/errors';
import type { RouteGroup } from '../../http/route-registry';
import { attachScope, buildScope, type ScopeDeps } from './scope';

export const PROFILE_CONSENT_PURPOSE = 'profile_processing';

/**
 * Consent gate (Phase 1 gate, condition 1): every profile route is refused unless the LATEST
 * `profile_processing` record of the caller is `granted` (a later withdrawal wins; no record = no consent).
 * Runs after the session guard (the registry puts `requireAuth` first), before any body is processed.
 */
export const requireProfileConsent: RequestHandler = async (req, _res, next) => {
  const auth = requireAuthContext(req);
  const granted = await hasGrantedConsent(auth.db, auth.ownerId, PROFILE_CONSENT_PURPOSE);
  if (!granted) {
    throw new HttpError(
      403,
      'CONSENT_REQUIRED_FOR_PROFILE',
      'O consentimento para tratar os dados do perfil e necessario para usar esta funcao.',
    );
  }
  next();
};

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export type ProfileRouteDefiner = (
  path: string,
  description: string,
  ...handlers: RequestHandler[]
) => void;
export type ProfileRoutes = Record<Method, ProfileRouteDefiner>;

/**
 * The ONLY way the profile module declares routes. Each route is `auth: 'session'` (the registry adds the
 * session guard), then the consent gate, then the owner-bound scope, then the handlers: the gate is
 * structural, a handler cannot be registered without it. Paths are relative to `/api/profile`.
 */
export function profileRoutes(routes: RouteGroup, deps: ScopeDeps): ProfileRoutes {
  const bindScope: RequestHandler = (req, res, next) => {
    attachScope(res, buildScope(req, deps));
    next();
  };
  const define =
    (method: Method): ProfileRouteDefiner =>
    (path, description, ...handlers) => {
      routes[method](
        `/profile${path === '/' ? '' : path}`,
        { auth: 'session', description },
        requireProfileConsent,
        bindScope,
        ...handlers,
      );
    };
  return {
    get: define('get'),
    post: define('post'),
    put: define('put'),
    patch: define('patch'),
    delete: define('delete'),
  };
}
