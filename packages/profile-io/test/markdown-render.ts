import {
  isMdExemptPath,
  listSchemaPaths,
  profileDocumentSchema,
  type FieldPath,
} from '@chameleon/contracts';

/**
 * TEST-ONLY renderer: writes a canonical profile document as a FILLED annotated Markdown form that
 * follows the template's line grammar (`- **Label:** value <!-- path: ... -->`). It is generic over
 * the contract path list, so a field the parser cannot read back shows up as a round-trip diff.
 */

type Json = Record<string, unknown>;

export interface RenderOptions {
  /** Emit `## Xxx - registro N` headings between top-level records (default true). */
  recordHeadings?: boolean;
  /** Emit a `### Item N` heading between child records such as experience items (default true). */
  childHeadings?: boolean;
  /** Line ending (default LF). */
  eol?: '\n' | '\r\n';
  /** Prepend a UTF-8 BOM. */
  bom?: boolean;
}

const LEAVES: FieldPath[] = listSchemaPaths(profileDocumentSchema).leaves.filter(
  (leaf) => !isMdExemptPath(leaf.path) && leaf.path !== 'schema_version',
);

const isJson = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const MARKERS: Record<string, string> = {
  not_applicable: '(não se aplica)',
  declined: '(prefiro não informar)',
  not_assessed: '(ainda não avaliei)',
  needs_confirmation: '(confirmar depois)',
};

function valueAt(record: Json, rel: string): unknown {
  let cursor: unknown = record;
  for (const key of rel.split('.')) {
    if (!isJson(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function stateAt(owner: Json, rel: string, block: boolean): string | undefined {
  const container = block
    ? owner.field_states
    : isJson(owner.meta)
      ? owner.meta.field_states
      : undefined;
  return isJson(container) && typeof container[rel] === 'string' ? container[rel] : undefined;
}

function leafLine(leaf: FieldPath, rel: string, owner: Json, block: boolean): string[] {
  const value = valueAt(owner, rel);
  const state = stateAt(owner, rel, block);
  const marker = state ? MARKERS[state] : undefined;
  const hasValue =
    value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
  if (!hasValue && !marker) return [];
  const label = `**${rel.split('.').pop() ?? rel}:**`;
  const annotation = `<!-- path: ${leaf.path} -->`;

  if (!hasValue) return [`- ${label} ${marker} ${annotation}`];
  const suffix = marker && state === 'needs_confirmation' ? ` ${marker}` : '';

  if (Array.isArray(value)) {
    return [
      `- ${label} ${annotation}`,
      ...value.map((item) => `  - ${String(item)}`),
      ...(suffix ? [`  ${suffix.trim()}`] : []),
    ];
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const [first = '', ...rest] = text.split('\n');
  return [
    `- ${label} ${first}${rest.length === 0 ? suffix : ''} ${annotation}`,
    ...rest.map((line, index) =>
      line === '' ? '' : `  ${line}${index === rest.length - 1 ? suffix : ''}`,
    ),
  ];
}

const own = (leaf: FieldPath, prefix: string): string | null =>
  leaf.path.startsWith(`${prefix}.`) ? leaf.path.slice(prefix.length + 1) : null;

function renderRecord(
  record: Json,
  prefix: string,
  options: Required<Pick<RenderOptions, 'childHeadings'>>,
  out: string[],
): void {
  // own fields: leaves under this prefix that do not descend into a child array
  for (const leaf of LEAVES) {
    const rel = own(leaf, prefix);
    if (rel === null || rel.includes('[]')) continue;
    out.push(...leafLine(leaf, rel, record, false));
  }
  // child arrays (one level): items, collaborators
  const childPrefixes = new Set<string>();
  for (const leaf of LEAVES) {
    const rel = own(leaf, prefix);
    if (rel === null) continue;
    const at = rel.indexOf('[]');
    if (at >= 0) childPrefixes.add(`${prefix}.${rel.slice(0, at + 2)}`);
  }
  for (const childPrefix of childPrefixes) {
    const key = childPrefix.slice(prefix.length + 1, -2);
    const children = record[key];
    if (!Array.isArray(children)) continue;
    children.forEach((child, index) => {
      if (!isJson(child)) return;
      if (options.childHeadings) out.push('', `### Item ${index + 1}`, '');
      for (const leaf of LEAVES) {
        const rel = own(leaf, childPrefix);
        if (rel === null) continue;
        out.push(...leafLine(leaf, rel, child, false));
      }
    });
  }
}

export function renderProfileMarkdown(document: Json, options: RenderOptions = {}): string {
  const recordHeadings = options.recordHeadings ?? true;
  const childHeadings = options.childHeadings ?? true;
  const out: string[] = [
    '# Modelo universal de perfil profissional',
    '',
    `**Versão do modelo:** ${String(document.schema_version)} <!-- path: schema_version -->`,
  ];
  if (typeof document.locale === 'string') {
    out.push(`**Idioma do perfil:** ${document.locale} <!-- path: locale -->`);
  }
  out.push('', '> Texto de instrução do formulário que deve ser ignorado pelo importador.', '');

  const profile = isJson(document.profile) ? document.profile : {};

  // singleton blocks: leaves with a path of the form profile.<block>.<field>
  const blocks = new Set<string>();
  const collections = new Map<string, string>();
  for (const leaf of LEAVES) {
    if (!leaf.path.startsWith('profile.')) continue;
    const parts = leaf.path.split('.');
    const second = parts[1]!;
    if (second.endsWith('[]')) collections.set(`profile.${second}`, second.slice(0, -2));
    else if (second === 'usage_rules')
      collections.set('profile.usage_rules.restrictions[]', 'restrictions');
    else blocks.add(second);
  }
  for (const block of blocks) {
    const owner = profile[block];
    if (!isJson(owner)) continue;
    const lines: string[] = [];
    for (const leaf of LEAVES) {
      const rel = own(leaf, `profile.${block}`);
      if (rel === null) continue;
      lines.push(...leafLine(leaf, rel, owner, true));
    }
    if (lines.length > 0) out.push(`## Bloco ${block}`, '', ...lines, '');
  }

  for (const [prefix, key] of collections) {
    const holder = prefix.startsWith('profile.usage_rules') ? profile.usage_rules : profile;
    const records = isJson(holder) ? holder[key] : undefined;
    if (!Array.isArray(records)) continue;
    records.forEach((record, index) => {
      if (!isJson(record)) return;
      if (recordHeadings) out.push(`## ${key} - registro ${index + 1}`, '');
      renderRecord(record, prefix, { childHeadings }, out);
      out.push('');
    });
  }

  const eol = options.eol ?? '\n';
  return `${options.bom ? '﻿' : ''}${out.join(eol)}${eol}`;
}

// ---------------------------------------------------------------------------------------------
// Expected document

const LEAF_PATHS: ReadonlySet<string> = new Set(LEAVES.map((leaf) => leaf.path));
const IMPORTER_OWNED_META = new Set([
  'status',
  'declared_status',
  'source',
  'source_detail',
  'source_excerpt',
]);

function filterStates(states: unknown, owner: string): Json | undefined {
  if (!isJson(states)) return undefined;
  const kept: Json = {};
  for (const [field, state] of Object.entries(states)) {
    // "not_provided" has no marker and container targets (e.g. `metric`) have no annotated leaf
    if (state !== 'not_provided' && LEAF_PATHS.has(`${owner}.${field}`)) kept[field] = state;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * What a document looks like after a trip through the Markdown form: importer-owned meta fields
 * (status, source, ...) are not in the form, states without a marker or an annotated leaf are lost,
 * and empty containers are indistinguishable from absence.
 */
export function expectedAfterMarkdown(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => expectedAfterMarkdown(item, isJson(item) ? `${path}[]` : path))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (isJson(value)) {
    const out: Json = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'field_states') {
        const states = filterStates(child, path);
        if (states) out[key] = states;
      } else if (key === 'meta' && isJson(child)) {
        const meta: Json = {};
        for (const [metaKey, metaValue] of Object.entries(child)) {
          if (IMPORTER_OWNED_META.has(metaKey)) continue;
          if (metaKey === 'field_states') {
            const states = filterStates(metaValue, path);
            if (states) meta[metaKey] = states;
          } else {
            const kept = expectedAfterMarkdown(metaValue, `${path}.meta.${metaKey}`);
            if (kept !== undefined) meta[metaKey] = kept;
          }
        }
        if (Object.keys(meta).length > 0) out[key] = meta;
      } else {
        const kept = expectedAfterMarkdown(child, path ? `${path}.${key}` : key);
        if (kept !== undefined) out[key] = kept;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return value === null ? undefined : value;
}
