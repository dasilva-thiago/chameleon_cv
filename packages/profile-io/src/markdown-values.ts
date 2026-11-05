import type { FieldState, ImportWarningCode } from '@chameleon/contracts';

/**
 * Value interpretation for the annotated Markdown template (ADR-0013, phase 2b).
 *
 * Pure functions that turn the free text a person typed after a field label into a contract value:
 * placeholders and "not provided" sentinels become ABSENT (never a negative fact), explicit state
 * markers become `field_states`, multi-choice answers map to the contract enums, lists become arrays.
 *
 * Security: every function is linear in the input size (no nested quantifiers, no backtracking
 * regexes on untrusted text) and nothing here echoes user content into messages: callers receive
 * structured notes and decide what to put in the report (paths and positions only).
 */

/** Contract leaf description (a subset of `FieldPath` from `@chameleon/contracts`). */
export interface LeafInfo {
  type: string;
  list: boolean;
  enumValues?: string[];
}

/** The text of a field answer: the first line (after the label) plus raw continuation lines. */
export interface RawAnswer {
  first: string;
  rest: readonly string[];
}

export type Note =
  | { type: 'warn'; code: ImportWarningCode; severity: 'info' | 'warning'; message: string }
  | { type: 'unmapped'; value: string; reason: string }
  /** The answer listed every template option without choosing one (treated as unanswered). */
  | { type: 'options-listed' };

export type Interpreted =
  | { kind: 'absent'; notes: Note[] }
  | { kind: 'value'; value: unknown; state?: FieldState; notes: Note[] }
  | { kind: 'state'; state: FieldState; notes: Note[] };

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Lowercase, accent-free, whitespace-collapsed form used to compare phrases. */
export function foldText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Removes up to three layers of wrapping backticks (the template shows answers as `[Preencher]`). */
export function stripBackticks(value: string): string {
  let current = value.trim();
  for (let layer = 0; layer < 3; layer += 1) {
    if (
      current.length >= 2 &&
      current.startsWith('`') &&
      current.endsWith('`') &&
      !current.slice(1, -1).includes('`')
    ) {
      current = current.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return current;
}

/** Splits into `[A-Za-z0-9_]+` runs (linear scan; used to find enum values inside glossed answers). */
function wordTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  for (let index = 0; index <= value.length; index += 1) {
    const code = index < value.length ? value.charCodeAt(index) : 0;
    const isWord =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 95;
    if (isWord) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      tokens.push(value.slice(start, index));
      start = -1;
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Placeholders, sentinels and explicit state markers

const FILLER_CHARS: ReadonlySet<string> = new Set([
  '-',
  '_',
  '—',
  '–',
  '.',
  '…',
  '*',
  '~',
  ' ',
  ',',
  ';',
]);

const PLACEHOLDER_WORDS = [
  'preencher',
  'preencha',
  'a preencher',
  'fill',
  'to fill',
  'inserir',
  'informar',
  'escolha',
  'select',
  'todo',
  'tbd',
];

/** Instruction text some template lines carry where a value is expected. */
const PLACEHOLDER_PHRASES: ReadonlySet<string> = new Set([
  'mesmos valores acima',
  'same values as above',
]);

/** `true` for empty answers and template placeholders such as `[Preencher]`, `_`, `-`, `...`. */
export function isPlaceholder(raw: string): boolean {
  const text = stripBackticks(raw);
  if (text === '') return true;
  let filler = true;
  for (const ch of text) {
    if (!FILLER_CHARS.has(ch)) {
      filler = false;
      break;
    }
  }
  if (filler) return true;
  if (text.startsWith('[') && text.endsWith(']') && text.length <= 80) {
    const inner = foldText(text.slice(1, -1));
    return inner === '' || PLACEHOLDER_WORDS.some((word) => inner.startsWith(word));
  }
  return PLACEHOLDER_PHRASES.has(foldText(text));
}

/**
 * Texts that mean "no information". They must never become values (the 1.0.0 form told people to
 * write "Nao informado", which would leak into resumes).
 */
const SENTINELS: ReadonlySet<string> = new Set([
  'nao informado',
  'nao informada',
  'nao informados',
  'nao informadas',
  'nao fornecido',
  'nao fornecida',
  'nao declarado',
  'nao declarada',
  'nao consta',
  'sem informacao',
  'sem informacoes',
  'sem dados',
  'desconhecido',
  'desconhecida',
  'n/i',
  'n/a',
  'n/d',
  'not provided',
  'not informed',
  'not specified',
  'not available',
  'unknown',
  'tbd',
  'tba',
]);

export function isSentinel(raw: string): boolean {
  let text = foldText(stripBackticks(raw));
  // emphasis markers around the phrase (`**Não informado**`, `_n/a_`)
  while (text.length >= 2 && /^[*_]/.test(text) && /[*_]$/.test(text))
    text = text.slice(1, -1).trim();
  while (text.endsWith('.')) text = text.slice(0, -1).trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
    text = text.slice(1, -1).trim();
  return SENTINELS.has(text);
}

/** Explicit state markers (fixed phrases, accent- and case-insensitive; Portuguese and English). */
const STATE_PHRASES: ReadonlyMap<string, FieldState> = new Map<string, FieldState>([
  ['nao se aplica', 'not_applicable'],
  ['not applicable', 'not_applicable'],
  ['prefiro nao informar', 'declined'],
  ['prefer not to say', 'declined'],
  ['prefer not to answer', 'declined'],
  ['ainda nao avaliei', 'not_assessed'],
  ['not assessed yet', 'not_assessed'],
  ['confirmar depois', 'needs_confirmation'],
  ['confirm later', 'needs_confirmation'],
]);

interface StateSplit {
  state: FieldState;
  /** What was typed next to the marker (empty when the marker is the whole answer). */
  remainder: string;
}

/**
 * Finds an explicit state marker: the whole answer (with or without parentheses), a parenthesised
 * marker at the very end, or a parenthesised marker at the very start. Markers in the middle of a
 * sentence are ordinary text.
 */
export function splitStateMarker(raw: string): StateSplit | null {
  const text = stripBackticks(raw);
  if (text === '') return null;
  const whole = STATE_PHRASES.get(
    foldText(text.startsWith('(') && text.endsWith(')') ? text.slice(1, -1) : text),
  );
  if (whole) return { state: whole, remainder: '' };
  if (text.endsWith(')')) {
    const open = text.lastIndexOf('(');
    if (open > 0) {
      const state = STATE_PHRASES.get(foldText(text.slice(open + 1, -1)));
      if (state) return { state, remainder: text.slice(0, open).trim() };
    }
  }
  if (text.startsWith('(')) {
    const close = text.indexOf(')');
    if (close > 0) {
      const state = STATE_PHRASES.get(foldText(text.slice(1, close)));
      if (state) return { state, remainder: text.slice(close + 1).trim() };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Multi-choice answers

/**
 * Portuguese glosses printed next to the English enum values in the template, keyed by the enum's
 * value set. They let `sim`/`parcialmente`/`nao` map to the contract enum WITHOUT loss. Matching is
 * exact on the whole (folded) answer.
 */
const SYNONYMS_BY_ENUM: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'not_public|partial|public': {
    sim: 'public',
    parcialmente: 'partial',
    parcial: 'partial',
    nao: 'not_public',
  },
  'allowed|not_allowed|restricted': {
    sim: 'allowed',
    'com restricao': 'restricted',
    restrito: 'restricted',
    nao: 'not_allowed',
  },
  'allowed|never|requires_approval': {
    sim: 'allowed',
    parcialmente: 'requires_approval',
    'com aprovacao': 'requires_approval',
    'parcialmente/com aprovacao': 'requires_approval',
    'depende da vaga': 'requires_approval',
    nao: 'never',
  },
  'depends|no|yes': { sim: 'yes', nao: 'no', depende: 'depends' },
  'allowed|ask_first|not_allowed': {
    sim: 'allowed',
    nao: 'not_allowed',
    'perguntar antes': 'ask_first',
  },
  'conditional|private|public': {
    publico: 'public',
    privado: 'private',
    condicional: 'conditional',
  },
};

interface EnumLookup {
  canonical: Map<string, string>;
  synonyms: Readonly<Record<string, string>>;
}

const lookupCache = new WeakMap<readonly string[], EnumLookup>();

function enumLookup(values: readonly string[]): EnumLookup {
  const cached = lookupCache.get(values);
  if (cached) return cached;
  const canonical = new Map<string, string>();
  for (const value of values) canonical.set(value.toLowerCase(), value);
  const lookup: EnumLookup = {
    canonical,
    synonyms: SYNONYMS_BY_ENUM[[...values].sort().join('|')] ?? {},
  };
  lookupCache.set(values, lookup);
  return lookup;
}

type EnumResolution = { kind: 'one'; value: string } | { kind: 'many' } | { kind: 'none' };

function resolveEnum(raw: string, values: readonly string[]): EnumResolution {
  const lookup = enumLookup(values);
  let cleaned = stripBackticks(raw);
  while (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1).trim();
  const direct = lookup.canonical.get(cleaned.toLowerCase());
  if (direct) return { kind: 'one', value: direct };
  const synonym = lookup.synonyms[foldText(cleaned)];
  if (synonym) return { kind: 'one', value: synonym };
  const found = new Set<string>();
  for (const token of wordTokens(cleaned)) {
    const value = lookup.canonical.get(token.toLowerCase());
    if (value) found.add(value);
  }
  if (found.size === 1) return { kind: 'one', value: [...found][0]! };
  if (found.size > 1) return { kind: 'many' };
  return { kind: 'none' };
}

// ---------------------------------------------------------------------------------------------
// Scalars

const BOOLEAN_WORDS: ReadonlyMap<string, boolean> = new Map([
  ['true', true],
  ['sim', true],
  ['yes', true],
  ['verdadeiro', true],
  ['false', false],
  ['nao', false],
  ['no', false],
  ['falso', false],
]);

type BooleanResolution = { kind: 'one'; value: boolean } | { kind: 'many' } | { kind: 'none' };

function resolveBoolean(raw: string): BooleanResolution {
  let cleaned = foldText(stripBackticks(raw));
  while (cleaned.endsWith('.')) cleaned = cleaned.slice(0, -1).trim();
  const exact = BOOLEAN_WORDS.get(cleaned);
  if (exact !== undefined) return { kind: 'one', value: exact };
  const found = new Set<boolean>();
  for (const token of wordTokens(cleaned)) {
    const value = BOOLEAN_WORDS.get(token);
    if (value !== undefined) found.add(value);
  }
  // "`true` ou `false`": every option listed (a gloss like "true (sim)" resolved above or has one value).
  if (found.size > 1) return { kind: 'many' };
  if (found.size === 1 && wordTokens(cleaned).length <= 3 && cleaned.includes('(')) {
    return { kind: 'one', value: [...found][0]! };
  }
  return { kind: 'none' };
}

/** Plain numbers; a lone separator followed by exactly three digits is ambiguous ("1.500") and rejected. */
export function parseNumber(raw: string): number | null {
  const text = stripBackticks(raw).replace(/\s+/g, '');
  if (text === '' || text.length > 40) return null;
  let digits = 0;
  let dots = 0;
  let commas = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') digits += 1;
    else if (ch === '.') dots += 1;
    else if (ch === ',') commas += 1;
    else return null;
  }
  if (digits === 0 || text.startsWith('.') || text.startsWith(',')) return null;
  if (text.endsWith('.') || text.endsWith(',')) return null;
  if (dots === 0 && commas === 0) return Number(text);
  if (dots > 0 && commas > 0) {
    const decimalAt = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','));
    const thousandsSep = text[decimalAt] === ',' ? '.' : ',';
    const integer = text.slice(0, decimalAt);
    const groups = integer.split(thousandsSep);
    if (
      groups.some(
        (group, index) => group.includes(text[decimalAt]!) || (index > 0 && group.length !== 3),
      )
    ) {
      return null;
    }
    return Number(`${groups.join('')}.${text.slice(decimalAt + 1)}`);
  }
  const separator = dots > 0 ? '.' : ',';
  if (dots + commas > 1) return null;
  const at = text.indexOf(separator);
  const decimals = text.length - at - 1;
  if (decimals === 3) return null;
  return Number(`${text.slice(0, at)}.${text.slice(at + 1)}`);
}

const PRESENT_ALIASES: ReadonlySet<string> = new Set(['present', 'atual', 'presente', 'current']);

// ---------------------------------------------------------------------------------------------
// Lists

interface Chunk {
  text: string;
  /** Nested bullets are atomic items (they may contain commas); inline text is split on `;` or `,`. */
  atomic: boolean;
  indent: number;
}

const BULLET = /^(?:[-*+]|\d{1,9}[.)])\s+/;

function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

function listChunks(answer: RawAnswer): Chunk[] {
  const chunks: Chunk[] = [];
  if (answer.first.trim() !== '')
    chunks.push({ text: answer.first.trim(), atomic: false, indent: -1 });
  for (const line of answer.rest) {
    const text = line.trim();
    if (text === '') continue;
    const indent = indentOf(line);
    const marker = BULLET.exec(text);
    if (marker) {
      chunks.push({ text: text.slice(marker[0].length).trim(), atomic: true, indent });
      continue;
    }
    const previous = chunks[chunks.length - 1];
    if (previous?.atomic && indent > previous.indent) previous.text += ` ${text}`;
    else chunks.push({ text, atomic: false, indent });
  }
  return chunks;
}

/**
 * Items of a list answer. Inline answers are separated by `;` when it appears, otherwise by `,`
 * (so an item that contains a comma can be written with `;` between items, or as a nested bullet).
 */
function listItems(chunks: readonly Chunk[]): string[] {
  const items: string[] = [];
  for (const chunk of chunks) {
    if (chunk.atomic) {
      items.push(chunk.text);
    } else {
      const separator = chunk.text.includes(';') ? ';' : ',';
      for (const part of chunk.text.split(separator)) items.push(part);
    }
  }
  return items.map((item) => stripBackticks(item)).filter((item) => !isPlaceholder(item));
}

// ---------------------------------------------------------------------------------------------
// Entry point

const note = {
  warn: (
    code: ImportWarningCode,
    message: string,
    severity: 'info' | 'warning' = 'warning',
  ): Note => ({
    type: 'warn',
    code,
    severity,
    message,
  }),
};

function joinAnswer(answer: RawAnswer): string {
  return [answer.first, ...answer.rest.map((line) => line.trim())].join('\n').trim();
}

function interpretScalar(text: string, leaf: LeafInfo, notes: Note[]): Interpreted {
  const enumValues = leaf.enumValues;
  switch (leaf.type) {
    case 'boolean': {
      const result = resolveBoolean(text);
      if (result.kind === 'one') return { kind: 'value', value: result.value, notes };
      if (result.kind === 'many') {
        notes.push({ type: 'options-listed' });
      } else {
        notes.push(
          note.warn(
            'INVALID_VALUE_DROPPED',
            'Resposta nao reconhecida como sim/nao (true/false); valor descartado.',
          ),
        );
        notes.push({ type: 'unmapped', value: text, reason: 'Resposta booleana nao reconhecida.' });
      }
      return { kind: 'absent', notes };
    }
    case 'number': {
      const value = parseNumber(text);
      if (value !== null && Number.isFinite(value)) return { kind: 'value', value, notes };
      notes.push(
        note.warn(
          'INVALID_VALUE_DROPPED',
          'Numero nao reconhecido (use digitos, com "." ou "," como separador decimal); valor descartado.',
        ),
      );
      notes.push({ type: 'unmapped', value: text, reason: 'Numero nao reconhecido.' });
      return { kind: 'absent', notes };
    }
    case 'enum': {
      const result = resolveEnum(text, enumValues ?? []);
      if (result.kind === 'one') return { kind: 'value', value: result.value, notes };
      if (result.kind === 'many') {
        notes.push({ type: 'options-listed' });
      } else {
        notes.push(
          note.warn('INVALID_ENUM_VALUE_DROPPED', 'Valor fora das opcoes do contrato; descartado.'),
        );
        notes.push({
          type: 'unmapped',
          value: text,
          reason: 'Valor fora das opcoes aceitas pelo campo.',
        });
      }
      return { kind: 'absent', notes };
    }
    case 'union': {
      // end dates: a partial date or the literal "present"
      const folded = foldText(stripBackticks(text));
      if (PRESENT_ALIASES.has(folded)) return { kind: 'value', value: 'present', notes };
      return { kind: 'value', value: stripBackticks(text), notes };
    }
    default:
      return { kind: 'value', value: stripBackticks(text), notes };
  }
}

function interpretList(answer: RawAnswer, leaf: LeafInfo, notes: Note[]): Interpreted {
  const chunks = listChunks(answer);
  const items = listItems(chunks).filter((item) => {
    if (!isSentinel(item)) return true;
    notes.push(
      note.warn(
        'EMPTY_STRING_NORMALIZED',
        'Texto "nao informado" em item de lista tratado como ausente.',
        'info',
      ),
    );
    return false;
  });
  if (items.length === 0) return { kind: 'absent', notes };

  const enumValues = leaf.enumValues;
  if (!enumValues) return { kind: 'value', value: items, notes };

  const chosen: string[] = [];
  let dropped = 0;
  for (const item of items) {
    const result = resolveEnum(item, enumValues);
    if (result.kind === 'one') {
      if (!chosen.includes(result.value)) chosen.push(result.value);
    } else {
      dropped += 1;
      notes.push({
        type: 'unmapped',
        value: item,
        reason: 'Item fora das opcoes aceitas pelo campo.',
      });
    }
  }
  // The template prints every option inline, backticked and in contract order: that is "nothing
  // chosen". Options typed as separate bullets, or without backticks, are a deliberate choice.
  const printedAll =
    chosen.length === enumValues.length &&
    dropped === 0 &&
    chosen.every((value, index) => value === enumValues[index]) &&
    chunks.every((chunk) => !chunk.atomic && chunk.text.includes('`'));
  if (printedAll) {
    notes.push({ type: 'options-listed' });
    return { kind: 'absent', notes };
  }
  if (dropped > 0) {
    notes.push(
      note.warn(
        'INVALID_ENUM_VALUE_DROPPED',
        `${dropped} item(ns) fora das opcoes do contrato descartado(s).`,
      ),
    );
  }
  if (chosen.length === 0) return { kind: 'absent', notes };
  return { kind: 'value', value: chosen, notes };
}

/** Moves a marker that sits ALONE on the last line of a multi-line list answer out of the list. */
function takeTrailingListMarker(
  answer: RawAnswer,
): { answer: RawAnswer; state: FieldState } | null {
  let last = answer.rest.length - 1;
  while (last >= 0 && answer.rest[last]!.trim() === '') last -= 1;
  if (last < 0) return null;
  const marker = splitStateMarker(answer.rest[last]!.trim());
  if (marker?.remainder !== '') return null;
  return { answer: { first: answer.first, rest: answer.rest.slice(0, last) }, state: marker.state };
}

/**
 * Interprets one answer. Order of precedence: explicit state marker, placeholder, "not provided"
 * sentinel, then the typed conversion (boolean, number, enum, list, text).
 */
export function interpretAnswer(answer: RawAnswer, leaf: LeafInfo): Interpreted {
  const notes: Note[] = [];
  let working = answer;
  let marker: StateSplit | null = null;

  if (leaf.list && answer.rest.some((line) => line.trim() !== '')) {
    const trailing = takeTrailingListMarker(answer);
    if (trailing) {
      working = trailing.answer;
      marker = { state: trailing.state, remainder: 'list' };
    }
  }
  const text = joinAnswer(working);
  if (marker === null) {
    if (isPlaceholder(text)) return { kind: 'absent', notes };
    marker = splitStateMarker(text);
    if (marker && marker.remainder !== '') {
      working = { first: marker.remainder, rest: [] };
    }
  }

  if (marker) {
    const hasRemainder = marker.remainder !== '' && !isPlaceholder(joinAnswer(working));
    if (!hasRemainder) return { kind: 'state', state: marker.state, notes };
    if (marker.state !== 'needs_confirmation') {
      notes.push(
        note.warn(
          'INVALID_VALUE_DROPPED',
          'Valor ignorado: ha um marcador de estado explicito que exclui valor (nao se aplica / prefiro nao informar / ainda nao avaliei).',
        ),
      );
      return { kind: 'state', state: marker.state, notes };
    }
    const remainderText = joinAnswer(working);
    const inner: Interpreted = leaf.list
      ? interpretList(working, leaf, notes)
      : isSentinel(remainderText)
        ? { kind: 'absent', notes }
        : interpretScalar(remainderText, leaf, notes);
    if (inner.kind === 'value') {
      return { kind: 'value', value: inner.value, state: 'needs_confirmation', notes };
    }
    return { kind: 'state', state: 'needs_confirmation', notes };
  }

  if (!leaf.list && isSentinel(text)) {
    notes.push(
      note.warn(
        'EMPTY_STRING_NORMALIZED',
        'Texto "nao informado" tratado como ausente (nao e um valor).',
        'info',
      ),
    );
    return { kind: 'absent', notes };
  }
  if (leaf.list) return interpretList(working, leaf, notes);
  return interpretScalar(text, leaf, notes);
}
