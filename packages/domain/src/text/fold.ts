/**
 * Text comparison helpers shared by the checks. "Folded" text is lowercase, without accents, with every run of
 * whitespace (and markdown emphasis) collapsed: the checks look for a phrase or a term in the professional base
 * regardless of case, accents and line breaks, but never across different words.
 */

const MARKDOWN_NOISE = /[*_`>]+/g;
const DASHES = /[‐-―−]/g;
const QUOTES = /[‘’‚‛′]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;

export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(DASHES, '-')
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(MARKDOWN_NOISE, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `needle` appears in `haystack` as whole words (both folded). Empty needles never match. */
export function containsTerm(haystackFolded: string, needle: string): boolean {
  const term = fold(needle);
  if (term === '') return false;
  let from = 0;
  for (;;) {
    const at = haystackFolded.indexOf(term, from);
    if (at === -1) return false;
    const before = at === 0 ? '' : haystackFolded.charAt(at - 1);
    const after = haystackFolded.charAt(at + term.length);
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

/**
 * True when a quoted phrase appears in the folded haystack. Quotes copied by a model often join fragments with an
 * ellipsis; each fragment then has to be found on its own (short connective fragments are ignored).
 */
export function containsQuote(haystackFolded: string, quote: string): boolean {
  const fragments = quote
    .split(/\.\.\.|…/)
    .map((part) => fold(part).replace(/^[\s"'.,;:-]+|[\s"'.,;:-]+$/g, ''))
    .filter((part) => part.length >= 4);
  if (fragments.length === 0) return false;
  return fragments.every((part) => haystackFolded.includes(part));
}

function isWordChar(char: string): boolean {
  return char !== '' && /[a-z0-9#+]/.test(char);
}

// eslint-disable-next-line no-control-regex -- strip control characters from model text
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line, no control characters, at most `max` characters (cut at a word when possible, with an ellipsis). */
export function tidy(value: string, max: number): string {
  const text = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
