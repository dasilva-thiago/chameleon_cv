import type { TestDb } from './workspace';

export interface PgFailure {
  code?: string;
  constraint?: string;
  message: string;
}

/** Literal SQL seguro para valores que vem do proprio catalogo/banco (uuid, ctid, texto). */
export const lit = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * Executa `statements` como UMA transacao implicita (protocolo simples: varios comandos numa string
 * rodam em uma unica transacao e voltam atras no primeiro erro) que SEMPRE termina em erro: se
 * nenhum statement falhar, o bloco final levanta `PROBE_NOT_REJECTED` e desfaz tudo, entao o banco
 * da suite nunca muda. Devolve a falha do banco, ou `null` se o ultimo statement NAO foi rejeitado.
 */
export async function probe(testDb: TestDb, statements: string[]): Promise<PgFailure | null> {
  const script = `${statements.join(';\n')};\nDO $probe$ BEGIN RAISE EXCEPTION 'PROBE_NOT_REJECTED' USING ERRCODE = 'P0001'; END $probe$`;
  try {
    await testDb.sql(script);
  } catch (error) {
    const failure = error as { code?: string; constraint?: string; message?: string };
    if (failure.message?.includes('PROBE_NOT_REJECTED')) return null;
    return {
      ...(failure.code ? { code: failure.code } : {}),
      ...(failure.constraint ? { constraint: failure.constraint } : {}),
      message: failure.message ?? String(error),
    };
  }
  throw new Error('probe: o bloco final deveria ter falhado');
}
