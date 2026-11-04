import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS } from './common-passwords';

/**
 * argon2id via @node-rs/argon2 (ADR-0009): m=19 MiB, t=2, p=1 (OWASP), revisaveis. O algoritmo
 * padrao da biblioteca e Argon2id. A senha e normalizada em NFKC antes de hashear/verificar.
 */
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

const normalize = (password: string): string => password.normalize('NFKC');

export function hashPassword(password: string): Promise<string> {
  return hash(normalize(password), ARGON2_OPTIONS);
}

/** Nunca lanca: hash malformado ou incompativel vira `false`. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, normalize(password));
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Hash fictício, calculado uma vez, com os MESMOS parametros: o login de e-mail inexistente (ou
 * conta sem credencial/desativada) tambem executa uma verificacao argon2, equalizando o tempo.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(`dummy-${Math.random().toString(36)}-${Date.now()}`);
  return dummyHash;
}

export type PasswordViolation = 'common' | 'repeated' | 'contains_email';

/** Politica minima alem do comprimento (que o DTO ja valida): comum, repetida, contem o e-mail. */
export function checkPasswordPolicy(password: string, email: string): PasswordViolation | null {
  const lowered = normalize(password).toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) return 'common';
  if (new Set(lowered).size <= 2) return 'repeated';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && lowered.includes(local)) return 'contains_email';
  return null;
}

export const PASSWORD_VIOLATION_MESSAGES: Record<PasswordViolation, string> = {
  common: 'Essa senha e muito comum. Escolha outra.',
  repeated: 'A senha nao pode ser formada por poucos caracteres repetidos.',
  contains_email: 'A senha nao pode conter o seu e-mail.',
};
