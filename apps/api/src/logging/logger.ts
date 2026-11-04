import { pino, type DestinationStream, type Logger } from 'pino';
import type { AppConfig } from '../config';

/**
 * Caminhos (e curingas de um nivel) removidos dos logs. Corpos de requisicao nunca sao
 * logados; esta lista e a segunda linha de defesa (docs/architecture.md secao 5).
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'email',
  'phone',
  'rawText',
  'snapshot',
  'content',
  '*.password',
  '*.token',
  '*.email',
  '*.phone',
  '*.rawText',
  '*.snapshot',
  '*.content',
  '*.apiKey',
];

export function createLogger(
  config: Pick<AppConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.LOG_LEVEL,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    base: { service: 'chameleon-api' },
  };
  return destination ? pino(options, destination) : pino(options);
}
