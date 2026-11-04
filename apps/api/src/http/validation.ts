import type { ApiErrorDetail } from '@chameleon/contracts';
import type { z } from 'zod';
import { HttpError } from './errors';

/**
 * Valida `data` com o schema do contrato. Em caso de falha devolve 400 com os caminhos e os
 * motivos (nunca o valor enviado: pode ser senha, token ou e-mail).
 */
export function parseWithSchema<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const details: ApiErrorDetail[] = result.error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw new HttpError(400, 'VALIDATION_ERROR', 'Dados invalidos.', { details });
}
