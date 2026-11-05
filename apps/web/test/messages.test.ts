import { API_ERROR_CODES } from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import { CLIENT_ERROR_CODES, ApiError } from '../src/lib/api/errors';
import { GENERIC_ERROR_MESSAGE, messageForError } from '../src/lib/api/messages';

describe('messageForError', () => {
  it.each([...API_ERROR_CODES, ...CLIENT_ERROR_CODES])(
    'tem mensagem em pt-BR para %s, sem vazar detalhes tecnicos',
    (code) => {
      const message = messageForError(new ApiError({ code, status: 400 }));
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/undefined|null|stack|SQL|prisma|\bat \w+/i);
      expect(message).not.toBe(code);
    },
  );

  it('maps the consent codes to dedicated pt-BR messages', () => {
    expect(messageForError(new ApiError({ code: 'CONSENT_REQUIRED', status: 400 }))).toBe(
      'Para criar a conta é necessário autorizar o tratamento dos dados do perfil.',
    );
    expect(messageForError(new ApiError({ code: 'CONSENT_INVALID', status: 400 }))).toBe(
      'O texto da política foi atualizado. Recarregue a página e tente novamente.',
    );
  });

  it('usa a resposta generica para credenciais, sem distinguir e-mail de senha', () => {
    const message = messageForError(new ApiError({ code: 'INVALID_CREDENTIALS', status: 401 }));
    expect(message).toBe('E-mail ou senha incorretos.');
  });

  it('mostra o codigo de suporte apenas em falhas do servidor', () => {
    const server = messageForError(
      new ApiError({ code: 'INTERNAL_ERROR', status: 500, requestId: 'abc-12345678' }),
    );
    expect(server).toContain('abc-12345678');
    const client = messageForError(
      new ApiError({ code: 'INVALID_CREDENTIALS', status: 401, requestId: 'abc-12345678' }),
    );
    expect(client).not.toContain('abc-12345678');
  });

  it('informa o tempo de espera em 429 com Retry-After', () => {
    const message = messageForError(
      new ApiError({ code: 'RATE_LIMITED', status: 429, retryAfterSeconds: 300 }),
    );
    expect(message).toContain('cerca de 5 minutos');
  });

  it('erro desconhecido recebe mensagem generica (nunca o texto do erro)', () => {
    expect(messageForError(new Error('connection to 10.0.0.5 refused'))).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });
});
