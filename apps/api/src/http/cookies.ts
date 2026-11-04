import { parseCookie, stringifySetCookie } from 'cookie';
import type { Request, Response } from 'express';
import type { AppConfig } from '../config';

/**
 * Cookies (ADR-0009). A estrategia segura e derivada de APP_ORIGIN, sem flag separada:
 * - https (producao): `__Host-cc_session` / `__Host-cc_csrf` com `Secure`, `Path=/`, sem `Domain`;
 * - http em loopback (somente desenvolvimento; a config rejeita http em producao ou em outros
 *   hosts): `cc_session` / `cc_csrf` SEM `Secure` e sem prefixo, porque o prefixo `__Host-` exige
 *   `Secure` e navegadores nao aceitam `Secure` em http de forma consistente (Safari recusa).
 * `HttpOnly` e `SameSite=Lax` valem nos dois modos; apenas o cookie CSRF e legivel por JS.
 */
export interface CookieSettings {
  readonly secure: boolean;
  readonly sessionName: string;
  readonly csrfName: string;
}

export const SESSION_COOKIE_BASE = 'cc_session';
export const CSRF_COOKIE_BASE = 'cc_csrf';

export function cookieSettings(config: Pick<AppConfig, 'APP_ORIGIN'>): CookieSettings {
  const secure = new URL(config.APP_ORIGIN).protocol === 'https:';
  const prefix = secure ? '__Host-' : '';
  return {
    secure,
    sessionName: `${prefix}${SESSION_COOKIE_BASE}`,
    csrfName: `${prefix}${CSRF_COOKIE_BASE}`,
  };
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header === '') return undefined;
  return parseCookie(header)[name];
}

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

function append(res: Response, serialized: string): void {
  res.append('Set-Cookie', serialized);
}

export function setSessionCookie(
  res: Response,
  settings: CookieSettings,
  token: string,
  maxAgeSeconds: number = THIRTY_DAYS_SECONDS,
): void {
  append(
    res,
    stringifySetCookie({
      name: settings.sessionName,
      value: token,
      httpOnly: true,
      secure: settings.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: maxAgeSeconds,
    }),
  );
}

export function clearSessionCookie(res: Response, settings: CookieSettings): void {
  append(
    res,
    stringifySetCookie({
      name: settings.sessionName,
      value: '',
      httpOnly: true,
      secure: settings.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
      expires: new Date(0),
    }),
  );
}

/** Cookie CSRF (double-submit): legivel por JS de proposito (nao `HttpOnly`). */
export function setCsrfCookie(res: Response, settings: CookieSettings, value: string): void {
  append(
    res,
    stringifySetCookie({
      name: settings.csrfName,
      value,
      httpOnly: false,
      secure: settings.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: THIRTY_DAYS_SECONDS,
    }),
  );
}
