import { isAlias, parseDocument, visit } from 'yaml';
import { DEFAULT_PARSE_LIMITS, FORBIDDEN_KEYS, type ParseLimits } from './limits';

export type ProfileTextFormat = 'yaml' | 'json';

export type ParseErrorCode =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'SYNTAX'
  | 'DUPLICATE_KEY'
  | 'MULTIPLE_DOCUMENTS'
  | 'ALIAS_NOT_ALLOWED'
  | 'ANCHOR_NOT_ALLOWED'
  | 'TAG_NOT_ALLOWED'
  | 'MERGE_KEY_NOT_ALLOWED'
  | 'FORBIDDEN_KEY'
  | 'TOO_DEEP'
  | 'TOO_MANY_NODES'
  | 'STRING_TOO_LONG'
  | 'KEY_TOO_LONG'
  | 'NON_FINITE_NUMBER'
  | 'NOT_AN_OBJECT';

export interface ParseError {
  code: ParseErrorCode;
  message: string;
  line?: number;
}

export type ParseResult =
  | { ok: true; format: ProfileTextFormat; data: Record<string, unknown> }
  | { ok: false; format: ProfileTextFormat; errors: ParseError[] };

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** Detecta o formato pelo primeiro caractere util: `{` => JSON; caso contrario YAML. */
export function detectTextFormat(text: string): ProfileTextFormat {
  const first = stripBom(text).trimStart()[0];
  return first === '{' ? 'json' : 'yaml';
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

interface InspectState {
  nodes: number;
  errors: ParseError[];
}

/** Verifica profundidade, quantidade de nos, tamanho de strings/chaves, chaves proibidas e numeros. */
function inspectValue(
  value: unknown,
  limits: ParseLimits,
  state: InspectState,
  depth: number,
  path: string,
): void {
  if (state.errors.length >= 10) return;
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) {
    if (!state.errors.some((e) => e.code === 'TOO_MANY_NODES')) {
      state.errors.push({
        code: 'TOO_MANY_NODES',
        message: `O documento excede o limite de ${limits.maxNodes} nos.`,
      });
    }
    return;
  }
  if (depth > limits.maxDepth) {
    state.errors.push({
      code: 'TOO_DEEP',
      message: `Aninhamento acima de ${limits.maxDepth} niveis em ${path || '(raiz)'}.`,
    });
    return;
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) {
      state.errors.push({
        code: 'STRING_TOO_LONG',
        message: `Texto com mais de ${limits.maxStringLength} caracteres em ${path || '(raiz)'}.`,
      });
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      state.errors.push({
        code: 'NON_FINITE_NUMBER',
        message: `Numero nao finito (NaN/Infinity) em ${path || '(raiz)'}.`,
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      inspectValue(item, limits, state, depth + 1, `${path}[${index}]`);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        state.errors.push({
          code: 'FORBIDDEN_KEY',
          message: `Chave proibida "${key}" em ${path || '(raiz)'}.`,
        });
        continue;
      }
      if (key.length > limits.maxKeyLength) {
        state.errors.push({
          code: 'KEY_TOO_LONG',
          message: `Chave com mais de ${limits.maxKeyLength} caracteres em ${path || '(raiz)'}.`,
        });
        continue;
      }
      inspectValue(
        (value as Record<string, unknown>)[key],
        limits,
        state,
        depth + 1,
        path ? `${path}.${key}` : key,
      );
    }
  }
}

function finalize(
  format: ProfileTextFormat,
  data: unknown,
  limits: ParseLimits,
  prior: ParseError[] = [],
): ParseResult {
  if (prior.length > 0) return { ok: false, format, errors: prior };
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      format,
      errors: [{ code: 'NOT_AN_OBJECT', message: 'A raiz do documento deve ser um mapa/objeto.' }],
    };
  }
  const state: InspectState = { nodes: 0, errors: [] };
  inspectValue(data, limits, state, 0, '');
  if (state.errors.length > 0) return { ok: false, format, errors: state.errors };
  return { ok: true, format, data: data as Record<string, unknown> };
}

function parseJson(text: string, limits: ParseLimits): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      format: 'json',
      errors: [{ code: 'SYNTAX', message: `JSON invalido: ${message}` }],
    };
  }
  return finalize('json', data, limits);
}

function parseYaml(text: string, limits: ParseLimits): ParseResult {
  const errors: ParseError[] = [];
  const document = parseDocument(text, {
    schema: 'core',
    version: '1.2',
    uniqueKeys: true,
    merge: false,
    strict: true,
    prettyErrors: false,
  });

  for (const error of document.errors) {
    const code: ParseErrorCode =
      error.code === 'DUPLICATE_KEY'
        ? 'DUPLICATE_KEY'
        : error.code === 'MULTIPLE_DOCS'
          ? 'MULTIPLE_DOCUMENTS'
          : 'SYNTAX';
    errors.push({
      code,
      message: error.message.split('\n')[0] ?? error.message,
      line: error.linePos?.[0]?.line,
    });
  }
  for (const warning of document.warnings) {
    if (warning.code === 'TAG_RESOLVE_FAILED' || warning.code === 'BAD_DIRECTIVE') {
      errors.push({
        code: 'TAG_NOT_ALLOWED',
        message: warning.message.split('\n')[0] ?? warning.message,
      });
    }
  }
  if (errors.length > 0) return { ok: false, format: 'yaml', errors };

  // Proibe ancoras, aliases, chaves de mescla e tags explicitas (a arvore ja foi lida, nada foi expandido).
  let nodes = 0;
  visit(document, {
    Alias() {
      errors.push({
        code: 'ALIAS_NOT_ALLOWED',
        message: 'Aliases YAML (*nome) nao sao permitidos.',
      });
      return visit.BREAK;
    },
    Node(_key, node, path) {
      nodes += 1;
      if (nodes > limits.maxNodes) {
        errors.push({
          code: 'TOO_MANY_NODES',
          message: `O documento excede o limite de ${limits.maxNodes} nos.`,
        });
        return visit.BREAK;
      }
      if (path.length > limits.maxDepth * 2 + 2) {
        errors.push({
          code: 'TOO_DEEP',
          message: `Aninhamento acima de ${limits.maxDepth} niveis.`,
        });
        return visit.BREAK;
      }
      if (!isAlias(node)) {
        if ('anchor' in node && node.anchor) {
          errors.push({
            code: 'ANCHOR_NOT_ALLOWED',
            message: 'Ancoras YAML (&nome) nao sao permitidas.',
          });
          return visit.BREAK;
        }
        if ('tag' in node && node.tag) {
          errors.push({
            code: 'TAG_NOT_ALLOWED',
            message: `Tags YAML explicitas (${node.tag}) nao sao permitidas.`,
          });
          return visit.BREAK;
        }
      }
      return undefined;
    },
    Pair(_key, pair) {
      const key: unknown = pair.key;
      if (key && typeof key === 'object' && 'value' in key && key.value === '<<') {
        errors.push({
          code: 'MERGE_KEY_NOT_ALLOWED',
          message: 'Chaves de mescla YAML (<<) nao sao permitidas.',
        });
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (errors.length > 0) return { ok: false, format: 'yaml', errors };

  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      format: 'yaml',
      errors: [{ code: 'SYNTAX', message: `YAML invalido: ${message}` }],
    };
  }
  return finalize('yaml', data, limits);
}

/**
 * Le o texto de um perfil (YAML ou JSON) com protecao contra entradas maliciosas. Nao valida o
 * contrato: apenas devolve dados puros (objetos/arrays/escalares) ou os erros de parse.
 */
export function parseProfileText(
  text: string,
  options: { format?: ProfileTextFormat | 'auto'; limits?: Partial<ParseLimits> } = {},
): ParseResult {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...options.limits };
  const format =
    options.format && options.format !== 'auto' ? options.format : detectTextFormat(text);
  if (byteLength(text) > limits.maxBytes) {
    return {
      ok: false,
      format,
      errors: [
        { code: 'TOO_LARGE', message: `O arquivo excede o limite de ${limits.maxBytes} bytes.` },
      ],
    };
  }
  const clean = stripBom(text);
  if (clean.trim() === '') {
    return { ok: false, format, errors: [{ code: 'EMPTY', message: 'O arquivo esta vazio.' }] };
  }
  try {
    return format === 'json' ? parseJson(clean, limits) : parseYaml(clean, limits);
  } catch (error) {
    // RangeError de pilha em entradas profundamente aninhadas etc.
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      format,
      errors: [{ code: 'SYNTAX', message: `Falha ao ler o documento: ${message}` }],
    };
  }
}
