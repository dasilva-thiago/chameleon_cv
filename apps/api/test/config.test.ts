import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const VALID = {
  DATABASE_URL: 'postgresql://chameleon@127.0.0.1:54329/chameleon_dev',
  APP_ORIGIN: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('aplica defaults compativeis com .env.example', () => {
    const config = loadConfig(VALID);
    expect(config).toMatchObject({
      API_PORT: 3000,
      SIGNUP_MODE: 'invite',
      UPLOAD_MAX_BYTES: 2 * 1024 * 1024,
      AI_PROVIDER: 'deterministic',
      PDF_BROWSER: 'bundled',
      LOG_LEVEL: 'info',
    });
  });

  it('trata variaveis vazias como ausentes', () => {
    const config = loadConfig({
      ...VALID,
      AI_MODEL: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
    });
    expect(config.AI_MODEL).toBeUndefined();
    expect(config.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('rejeita valores invalidos sem vazar o valor na mensagem', () => {
    const secret = 'valor-secreto-nao-pode-aparecer';
    try {
      loadConfig({ ...VALID, SIGNUP_MODE: secret, API_PORT: 'abc' });
      expect.unreachable('deveria lancar ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain('SIGNUP_MODE');
      expect(message).toContain('API_PORT');
      expect(message).not.toContain(secret);
    }
  });

  it('exige DATABASE_URL e APP_ORIGIN', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it('normaliza APP_ORIGIN para a origem e aplica defaults de TRUST_PROXY e limite de corpo', () => {
    const config = loadConfig({ ...VALID, APP_ORIGIN: 'http://localhost:5173/' });
    expect(config.APP_ORIGIN).toBe('http://localhost:5173');
    expect(config.TRUST_PROXY).toBe(0);
    expect(config.JSON_BODY_LIMIT_BYTES).toBe(100 * 1024);
  });

  it('producao exige https (cookies Secure com prefixo __Host-)', () => {
    expect(() => loadConfig({ ...VALID, NODE_ENV: 'production' })).toThrow(/APP_ORIGIN/);
    expect(
      loadConfig({ ...VALID, NODE_ENV: 'production', APP_ORIGIN: 'https://cv.example.test' })
        .APP_ORIGIN,
    ).toBe('https://cv.example.test');
  });

  it('http so e aceito em loopback (desenvolvimento)', () => {
    expect(() => loadConfig({ ...VALID, APP_ORIGIN: 'http://cv.example.test' })).toThrow(
      /APP_ORIGIN/,
    );
    expect(loadConfig({ ...VALID, APP_ORIGIN: 'http://127.0.0.1:5173' }).APP_ORIGIN).toBe(
      'http://127.0.0.1:5173',
    );
  });

  it('SIGNUP_MODE: invite e closed funcionam; open ainda nao esta implementado', () => {
    expect(loadConfig({ ...VALID, SIGNUP_MODE: 'closed' }).SIGNUP_MODE).toBe('closed');
    expect(() => loadConfig({ ...VALID, SIGNUP_MODE: 'open' })).toThrow(/SIGNUP_MODE/);
  });
});
