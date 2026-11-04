/** Normalizacao minima de termos, usada para chaves de competencia (dedupe) no contrato e no dominio. */
export function normalizeTerm(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** `true` quando o valor nao carrega informacao (null, "", lista vazia, objeto sem conteudo). */
export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.every(isBlankValue);
  if (typeof value === 'object') return Object.values(value).every(isBlankValue);
  return false;
}
