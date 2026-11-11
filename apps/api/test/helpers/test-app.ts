import { Writable } from 'node:stream';
import type { Db } from '@chameleon/db';
import type { Express } from 'express';
import { type AppDeps, createApp } from '../../src/app';
import { type AppConfig, loadConfig } from '../../src/config';
import { createLogger } from '../../src/logging';

export const SECURE_ORIGIN = 'https://cv.example.test';
export const DEV_ORIGIN = 'http://localhost:5173';

/** Config de teste. Padrao: origem https (cookies `__Host-` + Secure), como em producao. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://chameleon@127.0.0.1:54329/chameleon_dev',
    APP_ORIGIN: SECURE_ORIGIN,
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

/** Captura as linhas de log (JSON) para procurar canarios. */
export class LogCapture {
  private readonly chunks: string[] = [];
  readonly stream = new Writable({
    write: (chunk: Buffer | string, _encoding, callback) => {
      this.chunks.push(chunk.toString());
      callback();
    },
  });

  text(): string {
    return this.chunks.join('');
  }

  lines(): Record<string, unknown>[] {
    return this.text()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  clear(): void {
    this.chunks.length = 0;
  }
}

export interface TestApp {
  app: Express;
  config: AppConfig;
  logs: LogCapture;
}

/**
 * App completo com log capturado (nivel debug). Limites de taxa altos por padrao, para que fluxos
 * de teste nao se atrapalhem; os testes de 429 passam `rateLimits` proprios.
 */
export function buildTestApp(
  db: Db,
  options: {
    config?: AppConfig;
    now?: () => Date;
    rateLimits?: AppDeps['rateLimits'];
    sessionPolicy?: AppDeps['sessionPolicy'];
    modules?: AppDeps['modules'];
    ai?: AppDeps['ai'];
  } = {},
): TestApp {
  const config = options.config ?? testConfig();
  const logs = new LogCapture();
  const logger = createLogger({ LOG_LEVEL: 'debug' }, logs.stream);
  const huge = { windowMs: 60_000, max: 100_000 };
  const app = createApp({
    config,
    logger,
    db,
    ...(options.now ? { now: options.now } : {}),
    rateLimits: {
      loginPerIpEmail: huge,
      loginPerIp: huge,
      invitePerIp: huge,
      // Off by default so flows that fail several logins on one e-mail do not sleep.
      loginAccountDelay: { windowMs: 60_000, freeAttempts: 0, baseDelayMs: 0, maxDelayMs: 0 },
      ...options.rateLimits,
    },
    ...(options.sessionPolicy ? { sessionPolicy: options.sessionPolicy } : {}),
    ...(options.modules ? { modules: options.modules } : {}),
    ...(options.ai ? { ai: options.ai } : {}),
  });
  return { app, config, logs };
}
