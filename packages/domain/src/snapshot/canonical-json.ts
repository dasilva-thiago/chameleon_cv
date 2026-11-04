/**
 * JSON canonico conforme RFC 8785 (JCS), puro e determinista.
 *
 * - objetos: chaves ordenadas por unidades de codigo UTF-16 (a ordenacao padrao de `Array.sort()`),
 *   sem espacos; membros com valor `undefined` sao omitidos (como em `JSON.stringify`);
 * - numeros: serializacao ECMAScript (`String(n)`), que e a exigida pela RFC; `-0` vira `0`;
 *   `NaN`/`Infinity` sao erro;
 * - strings: escape minimo do JSON (`JSON.stringify`); string com surrogate solitario e erro
 *   (nao e Unicode valido, portanto nao tem forma canonica);
 * - qualquer outro tipo (Date, BigInt, funcao, Map...) e erro: o chamador converte antes.
 */

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export class CanonicalJsonError extends TypeError {
  override readonly name = 'CanonicalJsonError';
}

function stringify(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Numero nao finito em ${path || '(raiz)'}.`);
      }
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      if (LONE_SURROGATE.test(value)) {
        throw new CanonicalJsonError(`String com surrogate solitario em ${path || '(raiz)'}.`);
      }
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((item, index) => {
          if (item === undefined) {
            throw new CanonicalJsonError(`undefined em lista (${path}[${index}]).`);
          }
          return stringify(item, `${path}[${index}]`);
        });
        return `[${items.join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalJsonError(`Objeto nao JSON em ${path || '(raiz)'}.`);
      }
      const record = value as Record<string, unknown>;
      const members: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const member = record[key];
        if (member === undefined) continue;
        if (LONE_SURROGATE.test(key)) {
          throw new CanonicalJsonError(`Chave com surrogate solitario em ${path || '(raiz)'}.`);
        }
        members.push(`${JSON.stringify(key)}:${stringify(member, path ? `${path}.${key}` : key)}`);
      }
      return `{${members.join(',')}}`;
    }
    default:
      throw new CanonicalJsonError(`Tipo ${typeof value} nao e JSON em ${path || '(raiz)'}.`);
  }
}

/** Serializa `value` em JSON canonico (RFC 8785). */
export function canonicalJson(value: unknown): string {
  return stringify(value, '');
}
