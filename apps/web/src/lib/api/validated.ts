import { ApiError } from './errors';

/** Valida a requisicao com o schema do contrato antes de enviar (falha local = VALIDATION_ERROR). */
export function validated<T>(
  schema: { safeParse(data: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError({ code: 'VALIDATION_ERROR', status: 0 });
  return result.data;
}
