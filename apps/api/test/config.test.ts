import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const VALID = {
  DATABASE_URL: 'postgresql://chameleon@127.0.0.1:54329/chameleon_dev',
  APP_ORIGIN: 'http://localhost:5173',
};

const PROD = { ...VALID, NODE_ENV: 'production', APP_ORIGIN: 'https://cv.example.test' };

describe('loadConfig', () => {
  it('aplica defaults compativeis com .env.example', () => {
    const config = loadConfig(VALID);
    expect(config).toMatchObject({
      API_PORT: 3000,
      SIGNUP_MODE: 'invite',
      AI_PROVIDER: 'auto',
      AI_DAILY_REQUESTS_TOTAL: 120,
      AI_DAILY_TOKEN_LIMIT_PER_USER: 200_000,
      PDF_BROWSER: 'bundled',
      LOG_LEVEL: 'info',
    });
  });

  it('trata variaveis vazias como ausentes', () => {
    const config = loadConfig({
      ...VALID,
      AI_PROVIDER_ORDER: '',
    });
    expect(config.AI_PROVIDER_ORDER).toBeUndefined();
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
      loadConfig({ ...PROD, APP_ORIGIN: 'https://cv.example.test', TRUST_PROXY: '1' }).APP_ORIGIN,
    ).toBe('https://cv.example.test');
  });

  it('production with TRUST_PROXY=0 is rejected unless TRUST_PROXY_ACK_DIRECT=true documents a direct deployment', () => {
    expect(() => loadConfig(PROD)).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...PROD, TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
    expect(loadConfig({ ...PROD, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...PROD, TRUST_PROXY_ACK_DIRECT: 'true' }).TRUST_PROXY_ACK_DIRECT).toBe(
      true,
    );
    // The opt-out is meaningless (and contradictory) together with a trusted proxy count.
    expect(() => loadConfig({ ...PROD, TRUST_PROXY: '1', TRUST_PROXY_ACK_DIRECT: 'true' })).toThrow(
      /TRUST_PROXY_ACK_DIRECT/,
    );
    // Development and test keep the default of 0 without any opt-out.
    expect(loadConfig(VALID).TRUST_PROXY).toBe(0);
    expect(loadConfig({ ...VALID, NODE_ENV: 'test' }).TRUST_PROXY_ACK_DIRECT).toBe(false);
  });

  it('PROFILE_POLICY_VERSIONS: defaults to the version shown by the web app; accepts a list; rejects bad values', () => {
    expect(loadConfig(VALID).PROFILE_POLICY_VERSIONS).toEqual(['2026-11.1']);
    expect(
      loadConfig({ ...VALID, PROFILE_POLICY_VERSIONS: ' 2026-11.1 , 2027-01.0 ' })
        .PROFILE_POLICY_VERSIONS,
    ).toEqual(['2026-11.1', '2027-01.0']);
    for (const bad of ['', ' , ', 'has space', 'a;b', 'x'.repeat(65)]) {
      expect(() => loadConfig({ ...VALID, PROFILE_POLICY_VERSIONS: bad }), bad).toThrow(
        /PROFILE_POLICY_VERSIONS/,
      );
    }
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
