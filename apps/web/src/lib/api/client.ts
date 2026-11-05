import { apiErrorBodySchema } from '@chameleon/contracts';
import { CSRF_HEADER, readCsrfToken } from './csrf';
import { ApiError } from './errors';

/** Contrato minimo de um schema Zod (evita depender de `zod` diretamente no bundle da web). */
export interface ResponseSchema<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false };
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions<T> {
  body?: unknown;
  /** Valida a resposta de sucesso contra o contrato publicado. */
  schema: ResponseSchema<T>;
  signal?: AbortSignal | undefined;
}

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Injetavel para testes; por padrao usa `globalThis.fetch` resolvido a cada chamada. */
  fetchImpl?: typeof fetch;
  /** Rota GET usada para o servidor emitir o cookie CSRF quando ele ainda nao existe. */
  csrfBootstrapPath?: string;
  readCsrf?: () => string | undefined;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

function tryParseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Arquivo recebido de uma rota de download (exportacao). */
export interface DownloadedFile {
  blob: Blob;
  /** Nome sugerido pelo servidor (sanitizado); `undefined` quando o cabecalho esta ausente ou estranho. */
  filename: string | undefined;
  contentType: string;
}

export interface ApiClient {
  get<T>(path: string, options: Omit<RequestOptions<T>, 'body'>): Promise<T>;
  post<T>(path: string, options: RequestOptions<T>): Promise<T>;
  put<T>(path: string, options: RequestOptions<T>): Promise<T>;
  patch<T>(path: string, options: RequestOptions<T>): Promise<T>;
  delete<T>(path: string, options: Omit<RequestOptions<T>, 'body'>): Promise<T>;
  /** GET autenticado que devolve o corpo como arquivo (nao como JSON). */
  download(path: string, options?: { signal?: AbortSignal | undefined }): Promise<DownloadedFile>;
}

/** Aceita apenas nomes simples (letras, digitos, ponto, hifen, sublinhado): o servidor so emite esses. */
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function filenameFromDisposition(header: string | null): string | undefined {
  if (header === null) return undefined;
  const match = /filename="?([^";]+)"?/i.exec(header);
  const candidate = match?.[1]?.trim();
  return candidate !== undefined && SAFE_FILENAME.test(candidate) ? candidate : undefined;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bootstrapPath = options.csrfBootstrapPath ?? '/api/auth/me';
  const readCsrf = options.readCsrf ?? (() => readCsrfToken());
  const doFetch = (input: string, init: RequestInit): Promise<Response> =>
    (options.fetchImpl ?? globalThis.fetch)(input, init);

  async function send(
    method: HttpMethod,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    accept = 'application/json',
  ): Promise<Response> {
    const headers = new Headers({ Accept: accept });
    const init: RequestInit = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    if (method !== 'GET') {
      const token = readCsrf();
      if (token !== undefined) headers.set(CSRF_HEADER, token);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });
    init.signal = controller.signal;

    try {
      return await doFetch(`${baseUrl}${path}`, init);
    } catch {
      if (timedOut) throw new ApiError({ code: 'TIMEOUT', status: 0 });
      if (signal?.aborted) throw new ApiError({ code: 'ABORTED', status: 0 });
      throw new ApiError({ code: 'NETWORK', status: 0 });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  async function toApiError(response: Response): Promise<ApiError> {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
    const text = await response.text().catch(() => '');
    const parsed = apiErrorBodySchema.safeParse(tryParseJson(text));
    if (parsed.success) {
      const { code, requestId, details } = parsed.data.error;
      return new ApiError({
        code,
        status: response.status,
        requestId,
        details,
        retryAfterSeconds,
      });
    }
    // Corpo fora do contrato (proxy, balanceador): classifica apenas pelo status.
    const requestId = response.headers.get('X-Request-Id') ?? undefined;
    if (response.status === 429) {
      return new ApiError({ code: 'RATE_LIMITED', status: 429, requestId, retryAfterSeconds });
    }
    if (response.status >= 500) {
      return new ApiError({ code: 'INTERNAL_ERROR', status: response.status, requestId });
    }
    return new ApiError({ code: 'UNEXPECTED_RESPONSE', status: response.status, requestId });
  }

  /** Faz o servidor emitir o cookie CSRF (qualquer GET /api/* o emite, inclusive um 401). */
  async function ensureCsrfToken(signal: AbortSignal | undefined): Promise<void> {
    if (readCsrf() !== undefined) return;
    try {
      await (await send('GET', bootstrapPath, undefined, signal)).text();
    } catch {
      // A requisicao principal reportara a falha de rede, se persistir.
    }
  }

  async function request<T>(
    method: HttpMethod,
    path: string,
    { body, schema, signal }: RequestOptions<T>,
  ): Promise<T> {
    const mutating = method !== 'GET';
    if (mutating) await ensureCsrfToken(signal);

    let response = await send(method, path, body, signal);
    if (!response.ok && mutating && response.status === 403) {
      // Cookie CSRF ausente ou rotacionado: obtem um novo e repete uma unica vez.
      const error = await toApiError(response.clone());
      if (error.code === 'CSRF_TOKEN') {
        await ensureCsrfToken(signal);
        response = await send(method, path, body, signal);
      }
    }
    if (!response.ok) throw await toApiError(response);

    const text = await response.text().catch(() => '');
    const parsed = schema.safeParse(tryParseJson(text));
    if (!parsed.success) {
      throw new ApiError({
        code: 'UNEXPECTED_RESPONSE',
        status: response.status,
        requestId: response.headers.get('X-Request-Id') ?? undefined,
      });
    }
    return parsed.data;
  }

  async function download(
    path: string,
    { signal }: { signal?: AbortSignal | undefined } = {},
  ): Promise<DownloadedFile> {
    const response = await send('GET', path, undefined, signal, '*/*');
    if (!response.ok) throw await toApiError(response);
    const blob = await response.blob().catch(() => undefined);
    if (blob === undefined) {
      throw new ApiError({ code: 'UNEXPECTED_RESPONSE', status: response.status });
    }
    return {
      blob,
      filename: filenameFromDisposition(response.headers.get('Content-Disposition')),
      contentType: response.headers.get('Content-Type') ?? blob.type,
    };
  }

  return {
    get: (path, opts) => request('GET', path, opts),
    post: (path, opts) => request('POST', path, opts),
    put: (path, opts) => request('PUT', path, opts),
    patch: (path, opts) => request('PATCH', path, opts),
    delete: (path, opts) => request('DELETE', path, opts),
    download,
  };
}
