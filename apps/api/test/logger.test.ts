import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging';

function capture(): { lines: () => Record<string, unknown>[]; stream: { write(s: string): void } } {
  const chunks: string[] = [];
  return {
    stream: { write: (s: string) => void chunks.push(s) },
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('redige cookies, authorization, e-mail, telefone e conteudo livre', () => {
    const sink = capture();
    const logger = createLogger({ LOG_LEVEL: 'info' }, sink.stream);
    logger.info(
      {
        req: { headers: { cookie: 'sid=SEGREDO', authorization: 'Bearer SEGREDO' } },
        user: { email: 'pessoa@example.test', phone: '+00 000', rawText: 'SEGREDO' },
        password: 'SEGREDO',
      },
      'evento',
    );
    const serialized = JSON.stringify(sink.lines());
    expect(serialized).not.toContain('SEGREDO');
    expect(serialized).not.toContain('pessoa@example.test');
    expect(serialized).toContain('[REDACTED]');
  });

  it('respeita o nivel configurado', () => {
    const sink = capture();
    const logger = createLogger({ LOG_LEVEL: 'warn' }, sink.stream);
    logger.info('ignorado');
    logger.warn('visivel');
    expect(sink.lines()).toHaveLength(1);
  });
});
