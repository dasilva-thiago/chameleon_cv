import { importPreviewQuerySchema, importPreviewRequestSchema } from '@chameleon/contracts';
import express, { type Request, type RequestHandler } from 'express';
import { HttpError } from '../../http/errors';
import { parseDto } from './errors';

/**
 * Untrusted import input (ADR-0013). Two shapes, both for `POST /api/profile/imports/preview`:
 *  - `application/json`: `{ format, text, mode }` (paste);
 *  - `text/yaml` | `application/yaml` | `application/x-yaml` | `text/plain`: the body IS the text (upload).
 * Size is capped by `UPLOAD_MAX_BYTES` (413). The text must be valid UTF-8 (415 otherwise) and free of NUL (400).
 */

const RAW_TYPES = ['text/yaml', 'application/yaml', 'application/x-yaml', 'text/plain'];
const JSON_ENVELOPE_FACTOR = 2; // JSON escaping can double a text; the exact byte check is done on the decoded text

export interface ImportInput {
  text: string;
  format: 'auto' | 'yaml' | 'json';
  mode: 'strict' | 'lenient';
}

/** Body parsers for the preview route (the global JSON parser skips this route: see `LARGE_BODY_ROUTES`). */
export function importBodyParsers(uploadMaxBytes: number): RequestHandler[] {
  return [
    express.json({ limit: uploadMaxBytes * JSON_ENVELOPE_FACTOR + 4096, strict: true }),
    express.raw({ type: RAW_TYPES, limit: uploadMaxBytes }),
  ];
}

const unsupported = (message: string): HttpError =>
  new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', message);

function assertUtf8Charset(req: Request): void {
  const header = req.headers['content-type'] ?? '';
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(header)?.[1];
  if (charset !== undefined && !/^utf-?8$/i.test(charset)) {
    throw unsupported('Use texto em UTF-8.');
  }
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw unsupported('O arquivo precisa ser texto UTF-8 valido.');
  }
}

export function readImportInput(req: Request, uploadMaxBytes: number): ImportInput {
  const type = req.is(['application/json', ...RAW_TYPES]);
  if (type === false || type === null) {
    throw unsupported('Envie application/json, text/yaml ou text/plain.');
  }
  assertUtf8Charset(req);

  let input: ImportInput;
  if (type === 'application/json') {
    const body = parseDto(importPreviewRequestSchema, req.body as unknown);
    input = { text: body.text, format: body.format, mode: body.mode };
  } else {
    const query = parseDto(importPreviewQuerySchema, req.query);
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    input = {
      text: decodeUtf8(raw),
      format: type === 'text/plain' ? 'auto' : 'yaml',
      mode: query.mode,
    };
  }
  if (input.text.length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dados invalidos.', {
      details: [{ path: 'text', message: 'O texto esta vazio.' }],
    });
  }
  if (Buffer.byteLength(input.text, 'utf8') > uploadMaxBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Corpo da requisicao grande demais.');
  }
  if (input.text.includes('\u0000')) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Dados invalidos.', {
      details: [{ path: 'text', message: 'O texto nao pode conter o caractere NUL.' }],
    });
  }
  return input;
}

/**
 * Routes whose body can be bigger than the global JSON limit (`JSON_BODY_LIMIT_BYTES`, 100 KiB) and that declare
 * their own parser with `UPLOAD_MAX_BYTES`: the import preview, and the whole-document / section saves (a full
 * profile can pass 100 KiB). Matched by exact METHOD + path; every other route keeps the global limit.
 */
const LARGE_BODY_ROUTES: readonly RegExp[] = [
  /^POST \/profile\/imports\/preview$/,
  /^PUT \/profile$/,
  /^PUT \/profile\/sections\/[a-z_]+$/,
];

/** True when `METHOD path` (router-relative, case/slash-insensitive like Express routing) is a large-body route. */
export function isLargeBodyRoute(method: string, path: string): boolean {
  const normalized = path.replace(/\/+$/, '').toLowerCase();
  const key = `${method.toUpperCase()} ${normalized}`;
  return LARGE_BODY_ROUTES.some((pattern) => pattern.test(key));
}

/** JSON parser with the upload limit, for the large-body routes that are not the import preview. */
export function largeJsonBody(uploadMaxBytes: number): RequestHandler {
  return express.json({ limit: uploadMaxBytes, strict: true });
}
