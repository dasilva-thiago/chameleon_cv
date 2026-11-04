import type { ApiErrorCode, ApiErrorDetail } from '@chameleon/contracts';

/** Falhas que nascem no cliente (rede, tempo esgotado, resposta fora do contrato). */
export const CLIENT_ERROR_CODES = ['NETWORK', 'TIMEOUT', 'ABORTED', 'UNEXPECTED_RESPONSE'] as const;
export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number];

export type ApiErrorKind = ApiErrorCode | ClientErrorCode;

export interface ApiErrorInit {
  code: ApiErrorKind;
  /** Status HTTP; 0 quando nao houve resposta. */
  status: number;
  requestId?: string | undefined;
  details?: readonly ApiErrorDetail[] | undefined;
  /** Segundos sugeridos pelo cabecalho `Retry-After` (429). */
  retryAfterSeconds?: number | undefined;
}

/**
 * Erro tipado do cliente de API. A mensagem aqui e tecnica e curta (apenas o codigo); o texto
 * exibido ao usuario vem de `messageForError` (nunca da mensagem do servidor nem de detalhes).
 */
export class ApiError extends Error {
  readonly code: ApiErrorKind;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly details: readonly ApiErrorDetail[];
  readonly retryAfterSeconds: number | undefined;

  constructor(init: ApiErrorInit) {
    super(init.code);
    this.name = 'ApiError';
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export function isApiError(error: unknown, code?: ApiErrorKind): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
