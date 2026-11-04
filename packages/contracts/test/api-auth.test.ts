import { describe, expect, it } from 'vitest';
import {
  acceptInviteRequestSchema,
  apiErrorBodySchema,
  authSessionResponseSchema,
  consentInputSchema,
  invitePreviewRequestSchema,
  loginRequestSchema,
} from '../src/index';

const TOKEN = 'A'.repeat(43);

describe('DTOs de autenticacao (contracts/api)', () => {
  it('login normaliza o e-mail (trim + minusculas) e rejeita campos desconhecidos', () => {
    const parsed = loginRequestSchema.parse({ email: '  Pessoa@Example.TEST ', password: 'x' });
    expect(parsed.email).toBe('pessoa@example.test');
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x', admin: true }).success,
    ).toBe(false);
    expect(loginRequestSchema.safeParse({ email: 'nao-e-email', password: 'x' }).success).toBe(
      false,
    );
    expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x'.repeat(129) }).success,
    ).toBe(false);
  });

  it('aceite de convite: senha de 12 a 128, token de 43 caracteres base64url, e-mail nao e enviado', () => {
    const ok = { token: TOKEN, password: 'doze-chars-ok' };
    expect(acceptInviteRequestSchema.safeParse(ok).success).toBe(true);
    expect(acceptInviteRequestSchema.safeParse({ ...ok, password: 'curta' }).success).toBe(false);
    expect(acceptInviteRequestSchema.safeParse({ ...ok, token: 'curto' }).success).toBe(false);
    expect(acceptInviteRequestSchema.safeParse({ ...ok, email: 'a@b.co' }).success).toBe(false);
    expect(
      acceptInviteRequestSchema.safeParse({ ...ok, displayName: 'Nome\u0000Nulo' }).success,
    ).toBe(false);
    expect(invitePreviewRequestSchema.safeParse({ token: TOKEN }).success).toBe(true);
  });

  it('consentimento: finalidades de ADR-0014 e versao de politica restrita', () => {
    const base = { granted: true, policyVersion: '2026-11-01' };
    for (const purpose of ['profile_processing', 'ai_processing:anthropic']) {
      expect(consentInputSchema.safeParse({ ...base, purpose }).success).toBe(true);
    }
    for (const purpose of ['marketing', 'ai_processing:', "profile_processing'; --"]) {
      expect(consentInputSchema.safeParse({ ...base, purpose }).success).toBe(false);
    }
    expect(
      consentInputSchema.safeParse({ ...base, purpose: 'profile_processing', policyVersion: '' })
        .success,
    ).toBe(false);
  });

  it('resposta de sessao e minima (sem hash, token ou id de sessao)', () => {
    const body = {
      user: { id: '0198f7a0-0000-7000-8000-000000000001', email: 'a@b.co', displayName: null },
      session: {
        expiresAt: '2026-11-11T12:00:00.000Z',
        absoluteExpiresAt: '2026-12-04T12:00:00.000Z',
      },
    };
    expect(authSessionResponseSchema.safeParse(body).success).toBe(true);
    expect(
      authSessionResponseSchema.safeParse({ ...body, session: { ...body.session, id: 'x' } })
        .success,
    ).toBe(false);
  });

  it('corpo de erro padrao', () => {
    expect(
      apiErrorBodySchema.safeParse({
        error: { code: 'RATE_LIMITED', message: 'm', requestId: 'abc12345' },
      }).success,
    ).toBe(true);
    expect(
      apiErrorBodySchema.safeParse({ error: { code: 'QUALQUER', message: 'm', requestId: 'r' } })
        .success,
    ).toBe(false);
  });
});
