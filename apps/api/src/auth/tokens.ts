import { createHash, randomBytes } from 'node:crypto';

/** Tokens de sessao e de convite: 32 bytes aleatorios em base64url (43 caracteres). */
export const TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hex (64): unica forma em que o token e persistido (CHECK `*_tokenHash_format_chk`). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
