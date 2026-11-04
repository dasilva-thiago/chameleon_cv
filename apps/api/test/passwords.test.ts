import { describe, expect, it } from 'vitest';
import {
  ARGON2_OPTIONS,
  checkPasswordPolicy,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from '../src/auth/passwords';
import { TOKEN_REGEX, generateToken, hashToken } from '../src/auth/tokens';

describe('senhas (argon2id)', () => {
  it('gera hash argon2id em formato PHC com os parametros do ADR-0009', async () => {
    const hash = await hashPassword('uma senha longa e unica');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(ARGON2_OPTIONS).toEqual({ memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    expect(hash).not.toContain('uma senha longa');
  });

  it('verifica senha correta/errada e nunca lanca com hash malformado', async () => {
    const hash = await hashPassword('uma senha longa e unica');
    expect(await verifyPassword(hash, 'uma senha longa e unica')).toBe(true);
    expect(await verifyPassword(hash, 'outra senha longa e unica')).toBe(false);
    expect(await verifyPassword('nao-e-um-hash', 'x')).toBe(false);
  });

  it('normaliza NFKC (mesma senha em formas Unicode equivalentes)', async () => {
    const hash = await hashPassword('senha-com-acentuacao-ç'); // c cedilha composto
    expect(await verifyPassword(hash, 'senha-com-acentuacao-ç')).toBe(true); // decomposto
  });

  it('o hash ficticio e estavel e tem os mesmos parametros', async () => {
    const first = await getDummyHash();
    expect(await getDummyHash()).toBe(first);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});

describe('politica de senha', () => {
  it('rejeita senhas comuns, repetitivas e que contem o e-mail', () => {
    expect(checkPasswordPolicy('Password1234', 'x@example.test')).toBe('common');
    expect(checkPasswordPolicy('abababababab', 'x@example.test')).toBe('repeated');
    expect(checkPasswordPolicy('minha-maria.silva-2026', 'maria.silva@example.test')).toBe(
      'contains_email',
    );
  });

  it('aceita frase longa sem regra de composicao', () => {
    expect(checkPasswordPolicy('correct horse battery staple', 'x@example.test')).toBeNull();
  });
});

describe('tokens', () => {
  it('32 bytes aleatorios em base64url (43 caracteres), unicos', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(TOKEN_REGEX);
  });

  it('hash SHA-256 hex minusculo (64) e deterministico', () => {
    const token = generateToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
  });
});
