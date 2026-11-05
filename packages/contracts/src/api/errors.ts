import { z } from 'zod';

/**
 * Corpo de erro padrao da API (apps/api/src/http/errors.ts). Mensagens sao seguras para o
 * cliente e nunca carregam stack, SQL, valores informados ou dados de outros donos.
 */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'CSRF_ORIGIN',
  'CSRF_TOKEN',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'INVITE_INVALID',
  'SIGNUP_CLOSED',
  'WEAK_PASSWORD',
  'CONSENT_REQUIRED',
  'CONSENT_INVALID',
  'RATE_LIMITED',
  'NOT_FOUND',
  // Perfil (S2.1a)
  'CONSENT_REQUIRED_FOR_PROFILE',
  'IMPORT_INVALID',
  'IMPORT_PREVIEW_EXPIRED',
  'IMPORT_NOT_APPLICABLE',
  'ID_CONFLICT',
  'DUPLICATE_SKILL',
  'CONCURRENT_MODIFICATION',
  'RECORD_IN_USE',
  // Analise de vagas (P2)
  'PROFILE_REQUIRED',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);

/** Detalhe de validacao: caminho do campo e motivo (sem eco do valor enviado). */
export const apiErrorDetailSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});
export type ApiErrorDetail = z.infer<typeof apiErrorDetailSchema>;

export const apiErrorBodySchema = z.strictObject({
  error: z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.array(apiErrorDetailSchema).optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
