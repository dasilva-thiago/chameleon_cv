import { randomUUID } from 'node:crypto';
import type { ApiErrorBody, ApiErrorCode, ApiErrorDetail } from '@chameleon/contracts';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { Logger } from 'pino';

/** Erro de aplicacao com codigo estavel e status HTTP. A mensagem e segura para o cliente. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: readonly ApiErrorDetail[] | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    extra: {
      details?: readonly ApiErrorDetail[];
      headers?: Readonly<Record<string, string>>;
    } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = extra.details;
    this.headers = extra.headers;
  }
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns `req.correlationId`, ALWAYS generated server-side (it is written to logs and to
 * `AuditEvent.correlationId`, so a client must not be able to choose it), and returns it in the
 * `X-Request-Id` response header. An inbound `X-Request-Id` is kept apart as `req.clientRequestId`
 * (charset/length limited) and only ever appears in logs, for client-side tracing.
 */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.clientRequestId =
    incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : undefined;
  const id = randomUUID();
  req.correlationId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

export function errorBody(
  req: Request,
  code: ApiErrorCode,
  message: string,
  details?: readonly ApiErrorDetail[],
): ApiErrorBody {
  return {
    error: {
      code,
      message,
      requestId: req.correlationId,
      ...(details && details.length > 0 ? { details: [...details] } : {}),
    },
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody(req, 'NOT_FOUND', 'Recurso nao encontrado.'));
};

interface HttpLikeError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

/** Traduz erros do body-parser/Express (JSON malformado, corpo grande, charset) sem expor o texto. */
function fromParserError(err: unknown): HttpError | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const { status, statusCode, type } = err as HttpLikeError;
  const code = typeof status === 'number' ? status : statusCode;
  if (typeof code !== 'number' || code < 400 || code >= 500) return undefined;
  switch (type) {
    case 'entity.parse.failed':
      return new HttpError(400, 'INVALID_JSON', 'Corpo JSON invalido.');
    case 'entity.too.large':
      return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisicao grande demais.');
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Codificacao nao suportada.');
    default:
      return new HttpError(400, 'VALIDATION_ERROR', 'Requisicao invalida.');
  }
}

/**
 * Campos de um erro seguros para log: tipo, codigo e quadros de pilha. A MENSAGEM e omitida de
 * proposito (pode conter trechos do corpo ou valores de consulta, ex.: erros do Prisma/JSON).
 */
export function safeErrorFields(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { errorType: typeof err };
  const code = (err as { code?: unknown }).code;
  const frames = (err.stack ?? '')
    .split('\n')
    .filter((line) => line.startsWith('    at '))
    .slice(0, 12);
  return {
    errorType: err.name,
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    stackFrames: frames,
  };
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  // O parametro `_next` e exigido pela assinatura de 4 argumentos do Express.
  return (err: unknown, req, res, _next) => {
    if (res.headersSent) {
      return;
    }
    const known = err instanceof HttpError ? err : fromParserError(err);
    if (known) {
      for (const [name, value] of Object.entries(known.headers ?? {})) res.setHeader(name, value);
      res.status(known.status).json(errorBody(req, known.code, known.message, known.details));
      return;
    }
    // Erros inesperados: registrar sem mensagem/valores e sem expor detalhes ao cliente.
    logger.error({ ...safeErrorFields(err), requestId: req.correlationId }, 'unhandled error');
    res.status(500).json(errorBody(req, 'INTERNAL_ERROR', 'Erro interno.'));
  };
}
