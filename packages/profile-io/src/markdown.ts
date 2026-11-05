import {
  listSchemaPaths,
  isMdExemptPath,
  PROFILE_SCHEMA_VERSION,
  profileDocumentSchema,
  RECORD_DISCRIMINATORS,
  TOP_LEVEL_COLLECTIONS,
  type FieldPath,
  type FieldState,
  type ImportWarning,
  type ImportWarningCode,
  type RecordKind,
  type UnmappedEntry,
} from '@chameleon/contracts';
import { DEFAULT_PARSE_LIMITS, type ParseLimits } from './limits';
import { interpretAnswer, isPlaceholder, type RawAnswer } from './markdown-values';
import type { ParseError } from './parse';

/**
 * Parser for the FILLED annotated Markdown profile template (ADR-0013, phase 2b).
 *
 * Deterministic and line based: every field line of `templates/profile/*.v2.md` ends with an HTML
 * comment `<!-- path: profile.experiences[].official_title -->` and the parser trusts ONLY those
 * anchors. Free Markdown is not supported: whatever is not recognised is reported, never guessed.
 *
 * Threat model (the text is untrusted):
 * - paths are accepted only from the contract path list (and never from the technical `meta.*`
 *   paths the importer owns); anything else is reported in `unmapped` and NOT applied;
 * - values stay inert text (HTML such as `<script>` is data; only `<!-- -->` comments are removed);
 * - warnings and errors carry paths and line numbers, never the content of the file;
 * - all scanning is linear (indexOf/charCode loops, no nested quantifiers) and bounded by the same
 *   `ParseLimits` as YAML/JSON (bytes, nodes, string length); reports are capped.
 */

export interface MarkdownParseOptions {
  limits?: Partial<ParseLimits>;
}

export interface MarkdownParseStats {
  /** Annotations found in the file (known and unknown). */
  annotations: number;
  /** Annotations that matched a contract path. */
  recognized: number;
  /** Values or explicit states that were applied to the output. */
  applied: number;
}

export type MarkdownParseResult =
  | {
      ok: true;
      format: 'markdown';
      data: Record<string, unknown>;
      warnings: ImportWarning[];
      unmapped: UnmappedEntry[];
      stats: MarkdownParseStats;
    }
  | { ok: false; format: 'markdown'; errors: ParseError[] };

type Json = Record<string, unknown>;

const REPORT_CAP_PER_CODE = 100;
const UNMAPPED_CAP = 200;
const UNMAPPED_VALUE_CAP = 2_000;
const ERROR_CAP = 10;

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
const byteLength = (text: string): number => new TextEncoder().encode(text).length;
const at = (line: number): string => `markdown:line:${line}`;

// ---------------------------------------------------------------------------------------------
// Lexing: comments, annotations, headings, entries

interface ScannedLine {
  no: number;
  /** The line without HTML comments (indentation preserved). */
  text: string;
  /** Raw path strings of `<!-- path: ... -->` comments on this line, in order. */
  annotations: string[];
}

const ANNOTATION_KEY = 'path:';

function annotationOf(inner: string): string | null {
  const trimmed = inner.trim();
  if (trimmed.length < ANNOTATION_KEY.length) return null;
  if (trimmed.slice(0, ANNOTATION_KEY.length).toLowerCase() !== ANNOTATION_KEY) return null;
  return trimmed.slice(ANNOTATION_KEY.length).trim();
}

/**
 * Removes HTML comments (also multi-line ones) and collects annotations. A comment that is never
 * closed hides the rest of the file; `unterminatedAt` tells the caller where it started.
 */
function scanLines(lines: readonly string[]): {
  scanned: ScannedLine[];
  unterminatedAt: number | null;
  /** Lines that carry an annotation but sit inside a multi-line comment (so they were ignored). */
  hiddenAnnotations: number[];
} {
  const scanned: ScannedLine[] = [];
  const hiddenAnnotations: number[] = [];
  let commentStart: number | null = null;
  lines.forEach((line, index) => {
    const no = index + 1;
    if (commentStart !== null && line.includes('<!--') && line.includes('path:')) {
      hiddenAnnotations.push(no);
    }
    const parts: string[] = [];
    const annotations: string[] = [];
    let cursor = 0;
    while (cursor < line.length) {
      if (commentStart !== null) {
        const close = line.indexOf('-->', cursor);
        if (close < 0) {
          cursor = line.length;
          break;
        }
        commentStart = null;
        cursor = close + 3;
        continue;
      }
      const open = line.indexOf('<!--', cursor);
      if (open < 0) {
        parts.push(line.slice(cursor));
        break;
      }
      parts.push(line.slice(open === cursor ? cursor : cursor, open));
      const close = line.indexOf('-->', open + 4);
      if (close < 0) {
        commentStart = no;
        break;
      }
      const annotation = annotationOf(line.slice(open + 4, close));
      if (annotation !== null) annotations.push(annotation);
      cursor = close + 3;
    }
    scanned.push({ no, text: parts.join(''), annotations });
  });
  return { scanned, unterminatedAt: commentStart, hiddenAnnotations };
}

const BULLET = /^(?:[-*+]|\d{1,9}[.)])\s+/;
const HEADING_PREFIX = /^#{1,6}\s+/;
const CHECKBOX = /^\[[ xX]\]\s+/;

function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

function matchingParen(text: string): number {
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charCodeAt(index);
    if (ch === 40) depth += 1;
    else if (ch === 41) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

interface LabelSplit {
  bullet: boolean;
  /** Bold label text (without the `**`), when the line starts with one. */
  label: string | null;
  /** True when the label is followed by `:` (so the line is "field-like"). */
  labelled: boolean;
  /** Text after the label (the first line of the answer). */
  answer: string;
  /** True for headings (`#`). */
  heading: boolean;
}

/**
 * Separates the field label from the answer on the first line of an entry. Supported label styles:
 * `**Label:** answer`, `**Label?** answer` / `**Label (lista)** answer` and
 * `**Label** (long hint): answer`. A line without a bold label is all answer.
 */
function splitLabel(line: string): LabelSplit {
  let body = line.trim();
  while (body.startsWith('>')) body = body.slice(1).trimStart();
  const headingMatch = HEADING_PREFIX.exec(body);
  const heading = headingMatch !== null;
  if (headingMatch) body = body.slice(headingMatch[0].length);
  let bullet = false;
  const bulletMatch = BULLET.exec(body);
  if (bulletMatch) {
    bullet = true;
    body = body.slice(bulletMatch[0].length);
    const checkbox = CHECKBOX.exec(body);
    if (checkbox) body = body.slice(checkbox[0].length);
  }
  if (!body.startsWith('**'))
    return { bullet, label: null, labelled: false, answer: body.trim(), heading };
  const close = body.indexOf('**', 2);
  if (close < 0) return { bullet, label: null, labelled: false, answer: body.trim(), heading };
  const label = body.slice(2, close);
  const rest = body.slice(close + 2);
  if (label.trimEnd().endsWith(':'))
    return { bullet, label, labelled: true, answer: rest.trim(), heading };
  const trimmed = rest.trimStart();
  if (trimmed.startsWith(':')) {
    return { bullet, label, labelled: true, answer: trimmed.slice(1).trim(), heading };
  }
  if (trimmed.startsWith('(')) {
    const end = matchingParen(trimmed);
    if (end > 0) {
      const after = trimmed.slice(end + 1).trimStart();
      if (after.startsWith(':')) {
        return { bullet, label, labelled: true, answer: after.slice(1).trim(), heading };
      }
    }
  }
  return { bullet, label, labelled: false, answer: rest.trim(), heading };
}

/** `## Experiencia - registro 2`: the template's record headings close all open records. */
function isRecordHeading(text: string): boolean {
  const folded = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  for (const word of ['registro', 'record']) {
    let from = 0;
    for (;;) {
      const found = folded.indexOf(word, from);
      if (found < 0) break;
      let cursor = found + word.length;
      while (cursor < folded.length && folded[cursor] === ' ') cursor += 1;
      const code = folded.charCodeAt(cursor);
      if (cursor > found + word.length && code >= 48 && code <= 57) return true;
      from = found + word.length;
    }
  }
  return false;
}

type Event =
  | { type: 'heading'; line: number; recordHeading: boolean }
  | {
      type: 'entry';
      line: number;
      lines: string[];
      annotations: string[];
      /** An unannotated plain-text line directly after a bullet field line (no blank line between). */
      lazyAfterField: boolean;
    };

/**
 * Groups lines into headings and entries. An entry is a non-indented, non-blank line plus the
 * indented lines (and blank lines between them) that follow; a line that carries its own annotation
 * always starts a new entry, whatever its indentation.
 */
function toEvents(scanned: readonly ScannedLine[]): Event[] {
  const events: Event[] = [];
  let current: Extract<Event, { type: 'entry' }> | null = null;
  let pendingBlanks: string[] = [];
  let previousFieldBulletEndsAt = -1;

  const flush = (): void => {
    if (current) {
      events.push(current);
      const split = splitLabel(current.lines[0] ?? '');
      if (current.annotations.length > 0 && (split.bullet || split.labelled)) {
        previousFieldBulletEndsAt = current.line + current.lines.length - 1;
      }
    }
    current = null;
    pendingBlanks = [];
  };

  for (const line of scanned) {
    const trimmed = line.text.trim();
    if (trimmed === '') {
      if (current && line.annotations.length === 0) pendingBlanks.push('');
      else if (line.annotations.length > 0) {
        flush();
        current = {
          type: 'entry',
          line: line.no,
          lines: [''],
          annotations: line.annotations,
          lazyAfterField: false,
        };
      }
      continue;
    }
    const indent = indentOf(line.text);
    const isHeading = indent < 4 && HEADING_PREFIX.test(trimmed + ' ') && trimmed.startsWith('#');
    if (isHeading && line.annotations.length === 0) {
      flush();
      const text = trimmed.replace(HEADING_PREFIX, '');
      events.push({ type: 'heading', line: line.no, recordHeading: isRecordHeading(text) });
      continue;
    }
    const startsEntry = indent < 2 || line.annotations.length > 0 || current === null;
    if (current && !startsEntry) {
      for (const blank of pendingBlanks) current.lines.push(blank);
      current.lines.push(line.text);
      pendingBlanks = [];
      continue;
    }
    const blanksBefore = pendingBlanks.length;
    flush();
    const contiguous = previousFieldBulletEndsAt === line.no - 1 && blanksBefore === 0;
    const label = splitLabel(line.text);
    current = {
      type: 'entry',
      line: line.no,
      lines: [line.text],
      annotations: line.annotations,
      lazyAfterField:
        contiguous &&
        line.annotations.length === 0 &&
        !label.bullet &&
        !label.heading &&
        !label.labelled &&
        !trimmed.startsWith('|') &&
        !trimmed.startsWith('>') &&
        !/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed),
    };
  }
  flush();
  return events;
}

// ---------------------------------------------------------------------------------------------
// Contract path plans

interface PathPlan {
  path: string;
  leaf: FieldPath;
  segments: string[];
  /** Indexes of segments ending in `[]` (0, 1 or 2 levels). */
  arrays: number[];
  prefix1: string | null;
  prefix2: string | null;
  /** Field path under the level-1 record (no child array). */
  rel1: string;
  /** Field path under the level-2 (child) record. */
  rel2: string;
  state: { owner: 'record' | 'block' | 'none'; field: string };
  kind1: RecordKind | null;
  kind2: RecordKind | null;
}

const NESTED_KIND_BY_PREFIX: Readonly<Record<string, RecordKind>> = {
  'profile.experiences[].items[]': 'experience_item',
  'profile.projects[].items[]': 'project_item',
  'profile.projects[].collaborators[]': 'collaborator',
  'profile.usage_rules.restrictions[]': 'restriction',
};

const KIND_BY_PREFIX: ReadonlyMap<string, RecordKind> = new Map<string, RecordKind>([
  ...TOP_LEVEL_COLLECTIONS.map((c) => [`profile.${c.key}[]`, c.kind] as const),
  ...Object.entries(NESTED_KIND_BY_PREFIX),
]);

const OWN_KEYS: ReadonlySet<string> = new Set(['id', 'meta', 'field_states']);

let plansCache: Map<string, PathPlan> | null = null;

function buildPlans(): Map<string, PathPlan> {
  if (plansCache) return plansCache;
  const leaves = listSchemaPaths(profileDocumentSchema).leaves;
  const allPaths = new Set(leaves.map((leaf) => leaf.path));
  const plans = new Map<string, PathPlan>();
  for (const leaf of leaves) {
    if (isMdExemptPath(leaf.path)) continue;
    const segments = leaf.path.split('.');
    const arrays: number[] = [];
    segments.forEach((segment, index) => {
      if (segment.endsWith('[]')) arrays.push(index);
    });
    const first = arrays[0];
    const second = arrays[1];
    const prefix1 = first === undefined ? null : segments.slice(0, first + 1).join('.');
    const prefix2 = second === undefined ? null : segments.slice(0, second + 1).join('.');
    const rel1 = first === undefined ? '' : segments.slice(first + 1).join('.');
    const rel2 = second === undefined ? '' : segments.slice(second + 1).join('.');

    let state: PathPlan['state'] = { owner: 'none', field: '' };
    const ownerPrefix = prefix2 ?? prefix1;
    const rel = prefix2 ? rel2 : rel1;
    if (ownerPrefix) {
      if (
        allPaths.has(`${ownerPrefix}.meta.field_states`) &&
        rel !== 'id' &&
        !rel.startsWith('meta.')
      ) {
        state = { owner: 'record', field: rel };
      }
    } else if (segments[0] === 'profile' && segments.length >= 3) {
      const block = segments.slice(0, 2).join('.');
      if (allPaths.has(`${block}.field_states`)) {
        state = { owner: 'block', field: segments.slice(2).join('.') };
      }
    }
    plans.set(leaf.path, {
      path: leaf.path,
      leaf,
      segments,
      arrays,
      prefix1,
      prefix2,
      rel1,
      rel2,
      state,
      kind1: prefix1 ? (KIND_BY_PREFIX.get(prefix1) ?? null) : null,
      kind2: prefix2 ? (KIND_BY_PREFIX.get(prefix2) ?? null) : null,
    });
  }
  plansCache = plans;
  return plans;
}

// ---------------------------------------------------------------------------------------------
// Report with caps

class Reporter {
  readonly warnings: ImportWarning[] = [];
  readonly unmapped: UnmappedEntry[] = [];
  private readonly perCode = new Map<ImportWarningCode, number>();
  private unmappedOverflow = 0;

  warn(
    code: ImportWarningCode,
    path: string | null,
    message: string,
    severity: 'info' | 'warning' = 'warning',
  ): void {
    const count = (this.perCode.get(code) ?? 0) + 1;
    this.perCode.set(code, count);
    if (count <= REPORT_CAP_PER_CODE) this.warnings.push({ code, severity, path, message });
  }

  addUnmapped(path: string, value: unknown, reason: string): void {
    if (this.unmapped.length >= UNMAPPED_CAP) {
      this.unmappedOverflow += 1;
      return;
    }
    const safe =
      typeof value === 'string' && value.length > UNMAPPED_VALUE_CAP
        ? value.slice(0, UNMAPPED_VALUE_CAP)
        : value;
    this.unmapped.push({ path, value: safe, reason });
  }

  finish(): void {
    for (const [code, count] of this.perCode) {
      if (count > REPORT_CAP_PER_CODE) {
        this.warnings.push({
          code,
          severity: 'info',
          path: null,
          message: `Mais ${count - REPORT_CAP_PER_CODE} ocorrencia(s) deste aviso nao foram listadas.`,
        });
      }
    }
    if (this.unmappedOverflow > 0) {
      this.warnings.push({
        code: 'UNKNOWN_KEY_UNMAPPED',
        severity: 'info',
        path: null,
        message: `Mais ${this.unmappedOverflow} entrada(s) nao mapeada(s) nao foram preservadas no relatorio.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Assembly

interface ChildState {
  data: Json;
  seen: Set<string>;
  epoch: number;
  /** Index in the parent's array once attached (records appear in the output only with content). */
  index: number | null;
}

interface RecordState {
  data: Json;
  seen: Set<string>;
  children: Map<string, ChildState>;
  index: number | null;
}

interface State {
  root: Json;
  open: Map<string, RecordState>;
  last: Map<string, RecordState>;
  epoch: number;
  lastPrefix: string | null;
  appliedSingles: Set<string>;
  schemaVersion: string | null;
  schemaVersionSeen: boolean;
  nodes: number;
  stats: MarkdownParseStats;
}

const isJson = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function ensureObject(parent: Json, key: string): Json {
  const existing = parent[key];
  if (isJson(existing)) return existing;
  const created: Json = {};
  parent[key] = created;
  return created;
}

function ensureArray(parent: Json, key: string): unknown[] {
  const existing = parent[key];
  if (Array.isArray(existing)) return existing;
  const created: unknown[] = [];
  parent[key] = created;
  return created;
}

const arrayKey = (segment: string): string => segment.slice(0, -2);

/** The array for the `[]` segment at `arrayIndex`, creating intermediate objects (only on attach). */
function containerOf(root: Json, segments: readonly string[], arrayIndex: number): unknown[] {
  let cursor = root;
  for (let index = 0; index < arrayIndex; index += 1)
    cursor = ensureObject(cursor, segments[index]!);
  return ensureArray(cursor, arrayKey(segments[arrayIndex]!));
}

/** Current length of that array without creating anything (prospective index of the next record). */
function peekLength(root: Json, segments: readonly string[], arrayIndex: number): number {
  let cursor: unknown = root;
  for (let index = 0; index < arrayIndex; index += 1) {
    if (!isJson(cursor)) return 0;
    cursor = cursor[segments[index]!];
  }
  if (!isJson(cursor)) return 0;
  const array = cursor[arrayKey(segments[arrayIndex]!)];
  return Array.isArray(array) ? array.length : 0;
}

function setRel(target: Json, rel: string, value: unknown): void {
  const keys = rel.split('.');
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1)
    cursor = ensureObject(cursor, keys[index]!);
  cursor[keys[keys.length - 1]!] = value;
}

/** A field that counts as record content (id, meta, field_states and discriminators do not). */
const isContentField = (kind: RecordKind | null, rel: string): boolean => {
  if (OWN_KEYS.has(rel.split('.')[0] ?? '')) return false;
  const discriminators: readonly string[] =
    (kind && (RECORD_DISCRIMINATORS as Partial<Record<RecordKind, readonly string[]>>)[kind]) ?? [];
  return !discriminators.includes(rel);
};

const itemCount = (value: unknown): number => (Array.isArray(value) ? value.length : 1);

interface Resolved {
  /** Destination path with record indexes, e.g. `profile.experiences[0].start_date`. */
  path: string;
  markSeen: () => void;
  canApply: () => boolean;
  apply: (value: unknown) => void;
  applyState: (state: FieldState) => boolean;
}

/**
 * Finds (or opens) the record an annotation belongs to. Records are delimited by: headings that
 * name a record ("... registro N"), a field already annotated in the open record (the block was
 * repeated), an `id` field when the open record already has fields, and - for child records such as
 * experience items - any heading. A record only appears in the output once it has content.
 */
function resolveTarget(
  plan: PathPlan,
  state: State,
  reporter: Reporter,
  line: number,
  countNode: () => boolean,
): Resolved | null {
  // Singleton fields (blocks and root): the first value wins.
  if (plan.arrays.length === 0) {
    const key = plan.path;
    return {
      path: key,
      markSeen: () => undefined,
      canApply: () => !state.appliedSingles.has(key),
      apply: (value) => {
        state.appliedSingles.add(key);
        setRel(state.root, plan.path, value);
      },
      applyState: (stateValue) => {
        const stateKey = `${key}#state`;
        if (state.appliedSingles.has(stateKey)) return false;
        state.appliedSingles.add(stateKey);
        let block = state.root;
        for (const segment of plan.segments.slice(0, 2)) block = ensureObject(block, segment);
        ensureObject(block, 'field_states')[plan.state.field] = stateValue;
        return true;
      },
    };
  }

  const prefix1 = plan.prefix1!;
  const first = plan.arrays[0]!;

  let record = state.open.get(prefix1);
  const ownRel = plan.arrays.length === 1 ? plan.rel1 : null;
  if (record && ownRel !== null) {
    if (record.seen.has(ownRel) || (ownRel === 'id' && record.seen.size > 0)) record = undefined;
  }
  const isStudyPlan = ownRel?.startsWith('study_plan.') ?? false;
  let reused = record !== undefined;
  if (!record && isStudyPlan) {
    // Section 8.3 ("study plan") comes after 8.1/8.2: attach to the last skill record that has none.
    const previous = state.last.get(prefix1);
    if (previous && ![...previous.seen].some((key) => key.startsWith('study_plan.'))) {
      record = previous;
      state.open.set(prefix1, previous);
      reused = true;
    }
  }
  if (!record) {
    if (!countNode()) return null;
    record = { data: {}, seen: new Set(), children: new Map(), index: null };
    state.open.set(prefix1, record);
    state.last.set(prefix1, record);
  }
  const rec = record;

  const parentIndex = (): number => rec.index ?? peekLength(state.root, plan.segments, first);
  const attachParent = (): void => {
    if (rec.index !== null) return;
    const container = containerOf(state.root, plan.segments, first);
    rec.index = container.length;
    container.push(rec.data);
  };
  const withIndex = (segments: string[], at: number, index: number): void => {
    segments[at] = `${arrayKey(segments[at]!)}[${index}]`;
  };

  if (isStudyPlan && reused && rec.index !== null && state.lastPrefix !== prefix1) {
    const segments = plan.segments.slice(0, first + 1);
    withIndex(segments, first, parentIndex());
    reporter.warn(
      'RECORD_RELOCATED',
      segments.join('.'),
      `Campos de plano de estudo (linha ${line}) foram associados ao ultimo registro de competencia anterior; confira se e a competencia correta.`,
      'info',
    );
  }

  if (plan.arrays.length === 1) {
    const segments = [...plan.segments];
    withIndex(segments, first, parentIndex());
    return {
      path: segments.join('.'),
      markSeen: () => {
        rec.seen.add(plan.rel1);
      },
      canApply: () => true,
      apply: (value) => {
        if (isContentField(plan.kind1, plan.rel1)) attachParent();
        setRel(rec.data, plan.rel1, value);
      },
      applyState: (stateValue) => {
        ensureObject(ensureObject(rec.data, 'meta'), 'field_states')[plan.state.field] = stateValue;
        return true;
      },
    };
  }

  // Level-2 (child) records: experience items, project items, collaborators.
  const second = plan.arrays[1]!;
  const prefix2 = plan.prefix2!;
  let child = rec.children.get(prefix2);
  if (child) {
    const repeated = child.seen.has(plan.rel2) || (plan.rel2 === 'id' && child.seen.size > 0);
    if (child.epoch !== state.epoch || repeated) child = undefined;
  }
  if (!child) {
    if (!countNode()) return null;
    child = { data: {}, seen: new Set(), epoch: state.epoch, index: null };
    rec.children.set(prefix2, child);
  }
  const kid = child;
  const childArrayKey = arrayKey(plan.segments[second]!);
  const childHolder = (): Json => {
    let cursor = rec.data;
    for (let index = first + 1; index < second; index += 1)
      cursor = ensureObject(cursor, plan.segments[index]!);
    return cursor;
  };
  const childIndex = (): number => {
    if (kid.index !== null) return kid.index;
    let cursor: unknown = rec.data;
    for (let index = first + 1; index < second; index += 1) {
      if (!isJson(cursor)) return 0;
      cursor = cursor[plan.segments[index]!];
    }
    const array = isJson(cursor) ? cursor[childArrayKey] : undefined;
    return Array.isArray(array) ? array.length : 0;
  };
  const segments = [...plan.segments];
  withIndex(segments, first, parentIndex());
  withIndex(segments, second, childIndex());
  return {
    path: segments.join('.'),
    markSeen: () => {
      kid.seen.add(plan.rel2);
    },
    canApply: () => true,
    apply: (value) => {
      if (kid.index === null && isContentField(plan.kind2, plan.rel2)) {
        attachParent();
        const array = ensureArray(childHolder(), childArrayKey);
        kid.index = array.length;
        array.push(kid.data);
      }
      setRel(kid.data, plan.rel2, value);
    },
    applyState: (stateValue) => {
      ensureObject(ensureObject(kid.data, 'meta'), 'field_states')[plan.state.field] = stateValue;
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Entry point

/**
 * Parses a filled annotated Markdown profile into the v2.1.0 interchange object (the same shape the
 * YAML/JSON import consumes, before migration/normalisation/validation). Never throws.
 *
 * Output rules: absent/placeholder/"not provided" answers produce NO key (never a negative fact);
 * records appear only when they hold content; explicit markers become `field_states`; unknown or
 * technical paths are reported and not applied.
 */
export function parseProfileMarkdown(
  text: string,
  options: MarkdownParseOptions = {},
): MarkdownParseResult {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...options.limits };
  const fail = (...errors: ParseError[]): MarkdownParseResult => ({
    ok: false,
    format: 'markdown',
    errors,
  });

  if (byteLength(text) > limits.maxBytes) {
    return fail({
      code: 'TOO_LARGE',
      message: `O arquivo excede o limite de ${limits.maxBytes} bytes.`,
    });
  }
  const clean = stripBom(text);
  if (clean.trim() === '') return fail({ code: 'EMPTY', message: 'O arquivo esta vazio.' });

  try {
    return parseClean(clean, limits, fail);
  } catch (error) {
    // never echo the message (it could carry content); the class name is enough for triage
    const kind = error instanceof Error ? error.constructor.name : 'erro';
    return fail({ code: 'SYNTAX', message: `Falha ao ler o Markdown (${kind}).` });
  }
}

function parseClean(
  clean: string,
  limits: ParseLimits,
  fail: (...errors: ParseError[]) => MarkdownParseResult,
): MarkdownParseResult {
  const plans = buildPlans();
  const reporter = new Reporter();
  const errors: ParseError[] = [];
  const state: State = {
    root: {},
    open: new Map(),
    last: new Map(),
    epoch: 0,
    lastPrefix: null,
    appliedSingles: new Set(),
    schemaVersion: null,
    schemaVersionSeen: false,
    nodes: 0,
    stats: { annotations: 0, recognized: 0, applied: 0 },
  };

  const { scanned, unterminatedAt, hiddenAnnotations } = scanLines(clean.split(/\r\n|\r|\n/));
  for (const line of hiddenAnnotations) {
    reporter.warn(
      'UNKNOWN_KEY_UNMAPPED',
      at(line),
      'Linha com anotacao dentro de um comentario HTML de varias linhas: ignorada.',
      'info',
    );
  }
  if (unterminatedAt !== null) {
    reporter.warn(
      'UNKNOWN_KEY_UNMAPPED',
      at(unterminatedAt),
      'Comentario HTML nao fechado: o restante do arquivo foi ignorado a partir desta linha.',
    );
  }

  const pushError = (error: ParseError): void => {
    if (errors.length < ERROR_CAP) errors.push(error);
  };
  let nodeLimitHit = false;
  const countNode = (n = 1): boolean => {
    state.nodes += n;
    if (state.nodes > limits.maxNodes) {
      if (!nodeLimitHit) {
        pushError({
          code: 'TOO_MANY_NODES',
          message: `O documento excede o limite de ${limits.maxNodes} nos.`,
        });
      }
      nodeLimitHit = true;
      return false;
    }
    return true;
  };

  let optionsListed = 0;

  const events = toEvents(scanned);
  // Sections (heading epochs) that contain at least one annotated field: only there is an
  // unannotated "- **Label:** value" line a likely user-added field rather than template prose.
  const formEpochs = new Set<number>();
  let scanEpoch = 0;
  for (const event of events) {
    if (event.type === 'heading') scanEpoch += 1;
    else if (event.annotations.length > 0) formEpochs.add(scanEpoch);
  }

  for (const event of events) {
    if (nodeLimitHit) break;

    if (event.type === 'heading') {
      state.epoch += 1;
      if (event.recordHeading) state.open.clear();
      continue;
    }
    if (event.annotations.length === 0) {
      reportUnannotated(event, reporter, formEpochs.has(state.epoch));
      continue;
    }

    state.stats.annotations += event.annotations.length;
    if (event.annotations.length > 1) {
      reporter.warn(
        'DUPLICATE_FIELD_IGNORED',
        at(event.line),
        `${event.annotations.length - 1} anotacao(oes) adicional(is) na mesma linha ignorada(s); somente a primeira foi usada.`,
      );
    }
    const annotation = event.annotations[0]!;
    const plan = annotation.length <= limits.maxKeyLength * 2 ? plans.get(annotation) : undefined;
    const answer: RawAnswer = {
      first: splitLabel(event.lines[0] ?? '').answer,
      rest: event.lines.slice(1),
    };

    // limits: no line above the string limit, and no scalar answer above it either
    const restLength = answer.rest.reduce((sum, line) => sum + line.length, 0);
    const tooLong =
      answer.first.length > limits.maxStringLength ||
      answer.rest.some((line) => line.length > limits.maxStringLength) ||
      (!plan?.leaf.list && answer.first.length + restLength > limits.maxStringLength);
    if (tooLong) {
      pushError({
        code: 'STRING_TOO_LONG',
        message: `Texto com mais de ${limits.maxStringLength} caracteres na linha ${event.line}.`,
        line: event.line,
      });
      continue;
    }

    if (annotation === 'schema_version') {
      state.stats.recognized += 1;
      handleSchemaVersion(answer, state, reporter, event.line);
      continue;
    }

    if (!plan) {
      reporter.warn(
        'UNKNOWN_KEY_UNMAPPED',
        at(event.line),
        'Anotacao com caminho desconhecido ou nao permitido no Markdown; o campo nao foi aplicado.',
      );
      reporter.addUnmapped(
        at(event.line),
        { annotation: annotation.slice(0, limits.maxKeyLength), value: answer.first },
        'Anotacao fora da lista de caminhos permitidos do contrato.',
      );
      continue;
    }
    state.stats.recognized += 1;

    const resolved = resolveTarget(plan, state, reporter, event.line, countNode);
    if (!resolved) continue;
    resolved.markSeen();
    state.lastPrefix = plan.prefix1 ?? plan.path;

    const interpreted = interpretAnswer(answer, plan.leaf);
    for (const note of interpreted.notes) {
      if (note.type === 'options-listed') {
        optionsListed += 1;
      } else if (note.type === 'warn') {
        reporter.warn(
          note.code,
          resolved.path,
          `${note.message} (linha ${event.line})`,
          note.severity,
        );
      } else {
        reporter.addUnmapped(resolved.path, note.value, note.reason);
      }
    }
    if (interpreted.kind === 'absent') continue;

    if (interpreted.kind === 'value') {
      if (!resolved.canApply()) {
        reporter.warn(
          'DUPLICATE_FIELD_IGNORED',
          resolved.path,
          `Campo repetido (linha ${event.line}); o primeiro valor foi mantido.`,
        );
        continue;
      }
      if (!countNode() || !countNode(itemCount(interpreted.value) - 1)) break;
      resolved.apply(interpreted.value);
      state.stats.applied += 1;
    }

    const fieldState = interpreted.state;
    if (fieldState) {
      if (plan.state.owner === 'none') {
        reporter.warn(
          'INVALID_VALUE_DROPPED',
          resolved.path,
          `Marcador de estado explicito nao e suportado neste tipo de campo; ignorado (linha ${event.line}).`,
        );
      } else if (!countNode()) {
        break;
      } else if (resolved.applyState(fieldState)) {
        state.stats.applied += 1;
      } else {
        reporter.warn(
          'DUPLICATE_FIELD_IGNORED',
          resolved.path,
          `Estado repetido (linha ${event.line}); o primeiro foi mantido.`,
        );
      }
    }
  }

  if (errors.length > 0) return fail(...errors);

  if (state.stats.recognized === 0) {
    return fail({
      code: 'NO_ANNOTATIONS',
      message:
        state.stats.annotations === 0
          ? 'O Markdown nao contem anotacoes "<!-- path: ... -->": somente o modelo anotado (templates/profile) pode ser importado.'
          : 'Nenhuma anotacao "<!-- path: ... -->" corresponde a um campo do contrato 2.1.0.',
    });
  }

  if (optionsListed > 0) {
    reporter.warn(
      'EMPTY_STRING_NORMALIZED',
      null,
      `${optionsListed} campo(s) com todas as opcoes listadas e nenhuma escolha foram tratado(s) como nao informado(s).`,
      'info',
    );
  }
  reporter.finish();

  const data: Json = {
    schema_version: state.schemaVersion ?? PROFILE_SCHEMA_VERSION,
    ...state.root,
  };
  if (data.profile === undefined) data.profile = {};
  return {
    ok: true,
    format: 'markdown',
    data,
    warnings: reporter.warnings,
    unmapped: reporter.unmapped,
    stats: state.stats,
  };
}

function reportUnannotated(
  event: Extract<Event, { type: 'entry' }>,
  reporter: Reporter,
  inFormSection: boolean,
): void {
  const split = splitLabel(event.lines[0] ?? '');
  const continuation = event.lines.slice(1);
  if (event.lazyAfterField) {
    reporter.warn(
      'UNKNOWN_KEY_UNMAPPED',
      at(event.line),
      'Texto logo abaixo de um campo, sem recuo e sem anotacao: nao foi associado a nenhum campo (recue as linhas de continuacao com 2 espacos).',
    );
    reporter.addUnmapped(
      at(event.line),
      event.lines.join('\n').trim(),
      'Texto sem anotacao apos um campo.',
    );
    return;
  }
  if (
    inFormSection &&
    split.bullet &&
    split.labelled &&
    !isPlaceholder([split.answer, ...continuation].join('\n'))
  ) {
    reporter.warn(
      'UNKNOWN_KEY_UNMAPPED',
      at(event.line),
      'Linha com formato de campo ("- **Rotulo:** valor") sem anotacao "<!-- path: ... -->"; nao foi importada.',
    );
    reporter.addUnmapped(
      at(event.line),
      { label: split.label, value: [split.answer, ...continuation].join('\n').trim() },
      'Campo sem anotacao.',
    );
  }
}

const SEMVER_SHAPE = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

function handleSchemaVersion(
  answer: RawAnswer,
  state: State,
  reporter: Reporter,
  line: number,
): void {
  if (state.schemaVersionSeen) {
    reporter.warn(
      'DUPLICATE_FIELD_IGNORED',
      'schema_version',
      `schema_version repetido (linha ${line}); o primeiro foi mantido.`,
    );
    return;
  }
  state.schemaVersionSeen = true;
  const value = answer.first.replace(/`/g, '').trim();
  if (isPlaceholder(value)) {
    reporter.warn(
      'DEFAULTS_APPLIED',
      'schema_version',
      `schema_version em branco: assumida a versao corrente ${PROFILE_SCHEMA_VERSION}.`,
      'info',
    );
  } else if (SEMVER_SHAPE.test(value)) {
    // validated later by detectSchemaVersion (future/unsupported versions are refused there)
    state.schemaVersion = value;
  } else {
    reporter.warn(
      'INVALID_VALUE_DROPPED',
      'schema_version',
      `schema_version nao reconhecida (linha ${line}); assumida a versao corrente ${PROFILE_SCHEMA_VERSION}.`,
    );
  }
}
