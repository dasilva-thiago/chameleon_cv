/**
 * Leitura do cookie CSRF legivel por JS (ADR-0009). O nome depende da origem: `__Host-cc_csrf`
 * em https (producao) e `cc_csrf` em http de desenvolvimento.
 */
export const CSRF_COOKIE_NAMES = ['__Host-cc_csrf', 'cc_csrf'] as const;
export const CSRF_HEADER = 'X-CSRF-Token';

export function readCsrfToken(cookieString: string = document.cookie): string | undefined {
  for (const part of cookieString.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!(CSRF_COOKIE_NAMES as readonly string[]).includes(name)) continue;
    const raw = part.slice(separator + 1).trim();
    if (raw === '') continue;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}
