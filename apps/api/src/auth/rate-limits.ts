import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { HttpError } from '../http/errors';

/** ADR-0009: login 5/15 min por IP+e-mail; cadastro/convite 10/hora por IP. Store em memoria. */
export interface AuthRateLimits {
  loginPerIpEmail: RateLimitRule;
  /** Teto por IP somando e-mails diferentes (contra pulverizacao de senhas). */
  loginPerIp: RateLimitRule;
  invitePerIp: RateLimitRule;
}

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

const MINUTE = 60_000;

export const DEFAULT_AUTH_RATE_LIMITS: AuthRateLimits = {
  loginPerIpEmail: { windowMs: 15 * MINUTE, max: 5 },
  loginPerIp: { windowMs: 15 * MINUTE, max: 20 },
  invitePerIp: { windowMs: 60 * MINUTE, max: 10 },
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
    ],
    invite: build(limits.invitePerIp, (req) => clientIp(req), false),
  };
}
