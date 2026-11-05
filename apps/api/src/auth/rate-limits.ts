import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from '../http/errors';

/** ADR-0009: login 5/15 min por IP+e-mail; cadastro/convite 10/hora por IP. Store em memoria. */
export interface AuthRateLimits {
  loginPerIpEmail: RateLimitRule;
  /** Teto por IP somando e-mails diferentes (contra pulverizacao de senhas). */
  loginPerIp: RateLimitRule;
  invitePerIp: RateLimitRule;
  /** Progressive delay per ACCOUNT (not per IP): defense in depth when the client IP is not reliable. */
  loginAccountDelay: AccountDelayRule;
}

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

/**
 * Per-account progressive delay. It is deliberately a DELAY with a ceiling, never a block: because
 * the key is only the (normalized) e-mail, a block would let anyone lock out a chosen victim. With
 * the ceiling, a flood against one account slows that account's logins by at most `maxDelayMs` and
 * leaves every other account untouched. It exists for deployments where `req.ip` is attacker
 * controlled (TRUST_PROXY>=1 with no proxy overwriting X-Forwarded-For), where the per-IP limits
 * are bypassable; see the proxy contract in apps/api/README.md.
 */
export interface AccountDelayRule {
  windowMs: number;
  /** Attempts per window that incur no delay. */
  freeAttempts: number;
  /** Delay of the first attempt above the free ones; doubles for each further attempt. */
  baseDelayMs: number;
  /** Ceiling of the delay. 0 disables the mechanism. */
  maxDelayMs: number;
  /** Test hook (fake timers). Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
}

/** Upper bound on tracked accounts (oldest entries are dropped first): memory stays bounded. */
const MAX_TRACKED_ACCOUNTS = 10_000;

const MINUTE = 60_000;

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  loginPerIpEmail: { windowMs: 15 * MINUTE, max: 5 },
  loginPerIp: { windowMs: 15 * MINUTE, max: 20 },
  invitePerIp: { windowMs: 60 * MINUTE, max: 10 },
  loginAccountDelay: { windowMs: 15 * MINUTE, freeAttempts: 5, baseDelayMs: 250, maxDelayMs: 2000 },
};

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? '0.0.0.0');
}

function bodyEmail(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
}

function build(
  rule: RateLimitRule,
  key: (req: Request) => string,
  skipSuccessfulRequests: boolean,
): RequestHandler {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: key,
    // Mantem a resposta no formato de erro estruturado da API (Retry-After vem do limitador).
    handler: (_req, _res, next) => {
      next(new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.'));
    },
  });
}

/** Delay (ms) for the n-th attempt in the window (1-based): 0 up to `freeAttempts`, then doubling, capped. */
export function accountDelayFor(rule: AccountDelayRule, attempt: number): number {
  const excess = attempt - rule.freeAttempts;
  if (rule.maxDelayMs <= 0 || excess <= 0) return 0;
  return Math.min(rule.maxDelayMs, rule.baseDelayMs * 2 ** Math.min(excess - 1, 20));
}

/**
 * Middleware of the per-account delay. Attempts are counted when they START (so a burst of parallel
 * guesses sees growing delays) and refunded when the login succeeds. The key is the normalized
 * e-mail only, independent of IP and of the account existing (no enumeration oracle).
 */
export function createAccountDelay(
  rule: AccountDelayRule,
  now: () => number = Date.now,
): RequestHandler {
  const sleep =
    rule.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries = new Map<string, { count: number; resetAt: number }>();
  return async (req, res, next) => {
    const email = bodyEmail(req);
    if (email === '' || rule.maxDelayMs <= 0) {
      next();
      return;
    }
    const at = now();
    let entry = entries.get(email);
    if (!entry || entry.resetAt <= at) {
      entry = { count: 0, resetAt: at + rule.windowMs };
      entries.delete(email);
      entries.set(email, entry);
      if (entries.size > MAX_TRACKED_ACCOUNTS) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
    }
    entry.count += 1;
    const tracked = entry;
    res.once('finish', () => {
      if (res.statusCode < 400 && tracked.count > 0) tracked.count -= 1;
    });
    const delay = accountDelayFor(rule, tracked.count);
    if (delay > 0) await sleep(delay);
    next();
  };
}

/**
 * Limitadores novos por `createApp` (cada app tem as proprias contagens). No login so tentativas
 * que falham contam (`skipSuccessfulRequests`); a chave nao depende de o e-mail existir, para nao
 * criar um oraculo de enumeracao.
 */
export function createAuthRateLimiters(limits: AuthRateLimits) {
  return {
    login: [
      build(limits.loginPerIpEmail, (req) => `${clientIp(req)}|${bodyEmail(req)}`, true),
      build(limits.loginPerIp, (req) => clientIp(req), true),
      createAccountDelay(limits.loginAccountDelay),
    ],
    invite: build(limits.invitePerIp, (req) => clientIp(req), false),
  };
}
