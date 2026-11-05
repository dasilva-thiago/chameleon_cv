/**
 * Tokenizacao e comparacao de termos para o matcher deterministico. Funcoes puras.
 * Os termos viram tokens minusculos, sem acento; `.`, `+` e `#` ficam DENTRO do token (node.js, c++, c#).
 */

/** Sinonimos/variacoes comuns de tecnologia que contam como o mesmo termo. */
const CANONICAL: Readonly<Record<string, string>> = {
  'node.js': 'node',
  nodejs: 'node',
  'react.js': 'react',
  reactjs: 'react',
  'vue.js': 'vue',
  vuejs: 'vue',
  'next.js': 'next',
  nextjs: 'next',
  postgres: 'postgresql',
  k8s: 'kubernetes',
  js: 'javascript',
  ts: 'typescript',
  golang: 'go',
  'c-sharp': 'c#',
};

export function foldDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Tokens normalizados (minusculos, sem acento, sinonimos unificados). */
export function tokenize(text: string): string[] {
  return foldDiacritics(text)
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token !== '')
    .map((token) => CANONICAL[token] ?? token);
}

/** Texto pronto para busca de frases inteiras: tokens separados por um espaco, com espacos nas pontas. */
export function haystackOf(text: string): string {
  return ` ${tokenize(text).join(' ')} `;
}

/** Frase (ja em tokens) encontrada como palavras inteiras no `haystack`. */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const tokens = tokenize(phrase);
  if (tokens.length === 0) return false;
  return haystack.includes(` ${tokens.join(' ')} `);
}

/**
 * Termos de 1 a 2 letras ("R", "C", "Go") sao ambiguos em texto corrido: so valem com a mesma caixa
 * e como palavra isolada no texto original.
 */
export function containsShortTerm(original: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}+#.])${escaped}(?![\\p{L}\\p{N}+#])`, 'u').test(original);
}

/** `true` se o termo do perfil aparece no texto de um requisito. */
export function termInText(original: string, haystack: string, term: string): boolean {
  const trimmed = term.trim();
  if (trimmed === '') return false;
  return trimmed.length <= 2
    ? containsShortTerm(original, trimmed)
    : containsPhrase(haystack, trimmed);
}
