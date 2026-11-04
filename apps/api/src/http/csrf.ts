import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { AppConfig } from '../config';
import { type CookieSettings, readCookie, setCsrfCookie } from './cookies';
import { HttpError } from './errors';

/**
 * CSRF (ADR-0009): (1) `Origin` (ou `Referer`) igual a APP_ORIGIN e (2) double-submit: o cabecalho
 * `X-CSRF-Token` precisa ser igual ao cookie legivel. Valem para metodos nao seguros. O cookie e
 * emitido em qualquer requisicao `/api/*` que ainda nao o tenha (inclusive 401/403), entao
 * `GET /api/auth/me` no carregamento da SPA basta para o primeiro POST.
 */

export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Emite o cookie CSRF quando ausente ou malformado (token aleatorio de 256 bits). */
export function csrfCookieIssuer(settings: CookieSettings): RequestHandler {
  return (req, res, next) => {
    const current = readCookie(req, settings.csrfName);
    if (current === undefined || !CSRF_TOKEN_REGEX.test(current)) {
      setCsrfCookie(res, settings, generateCsrfToken());
    }
    next();
  };
}

function requestOrigin(req: Request): string | undefined {
  const origin = req.header('origin');
  if (origin !== undefined) return origin;
  const referer = req.header('referer');
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return 'invalid';
  }
}

function equalSecrets(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function csrfGuard(
  config: Pick<AppConfig, 'APP_ORIGIN'>,
  settings: CookieSettings,
): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (requestOrigin(req) !== config.APP_ORIGIN) {
      throw new HttpError(403, 'CSRF_ORIGIN', 'Origem da requisicao nao permitida.');
    }
    const cookie = readCookie(req, settings.csrfName);
    const header = req.header(CSRF_HEADER);
    if (
      cookie === undefined ||
      header === undefined ||
      !CSRF_TOKEN_REGEX.test(cookie) ||
      !equalSecrets(cookie, header)
    ) {
      throw new HttpError(403, 'CSRF_TOKEN', 'Token CSRF ausente ou invalido.');
    }
    next();
  };
}
