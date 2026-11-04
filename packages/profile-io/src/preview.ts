import {
  canonicalizeProfileDocument,
  isBlankValue,
  listRecords,
  type ImportReport,
  type ProfileDocument,
  type RecordKind,
} from '@chameleon/contracts';

/**
 * Pre-visualizacao de importacao (ADR-0013): o que seria CRIADO, ALTERADO ou DESCARTADO.
 * E uma funcao pura: nunca persiste nada. Sem `existing`, todo registro e "create".
 */
export type PreviewAction = 'create' | 'update' | 'unchanged';

export interface PreviewRecord {
  kind: RecordKind;
  id: string;
  /** Caminho no documento importado (ja com ids definitivos). */
  path: string;
  /** Rotulo seguro (tipo + posicao); nunca contem valores do registro. */
  label: string;
  action: PreviewAction;
  /** Para `update`: campos de primeiro nivel que mudam (sem `meta.status`). */
  changed_fields: string[];
  declared_status: string | null;
}

export interface CollectionPreview {
  incoming: number;
  create: number;
  update: number;
  unchanged: number;
}

export interface ImportPreview {
  source_schema_version: string | null;
  target_schema_version: string;
  totals: {
    records: number;
    create: number;
    update: number;
    unchanged: number;
    discarded: number;
    needs_review: number;
  };
  /** Contagem por colecao (ex.: `experiences`, `experiences.items`). */
  collections: Record<string, CollectionPreview>;
  /** Campos preenchidos nos blocos singleton (identity, positioning, ...). */
  singletons: Record<string, { fields_set: number }>;
  records: PreviewRecord[];
  /** Registros descartados na normalizacao/migracao (ex.: modelo vazio do 1.0.0). */
  discarded: { path: string; reason: string }[];
  warnings_by_code: Record<string, number>;
  unmapped_count: number;
  /** Ids existentes no perfil atual que o arquivo nao menciona (permanecem no modo merge). */
  untouched_existing: number;
}

const SINGLETONS = [
  'identity',
  'positioning',
  'availability_preferences',
  'career_preferences',
  'resume_preferences',
  'additional_professional_context',
  'usage_rules',
  'review',
] as const;

const NESTED_KEYS = new Set(['items', 'collaborators']);

type Json = Record<string, unknown>;

/**
 * Rotulo SEGURO do registro na pre-visualizacao: tipo + posicao no arquivo (ex.: `experience #2`).
 * Nunca usa o conteudo do registro: campos privados (nome de empregador privado, motivo de saida,
 * notas) nao podem vazar para telas, logs ou relatorios (ADR-0014). O `id` identifica o registro.
 */
function safeLabel(kind: RecordKind, path: readonly (string | number)[]): string {
  const index = [...path]
    .reverse()
    .find((segment): segment is number => typeof segment === 'number');
  return index === undefined ? kind : `${kind} #${index + 1}`;
}

function genericPath(path: readonly (string | number)[]): string {
  return path
    .filter((segment): segment is string => typeof segment === 'string' && segment !== 'profile')
    .join('.');
}

function formatPath(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (acc, segment) =>
      typeof segment === 'number' ? `${acc}[${segment}]` : acc ? `${acc}.${segment}` : segment,
    '',
  );
}

/** Comparavel: sem filhos aninhados, sem `meta.status/declared_status`, chaves ordenadas. */
function comparable(value: Json): Json {
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (NESTED_KEYS.has(key)) continue;
    if (key === 'meta' && child && typeof child === 'object') {
      const { status: _s, declared_status: _d, ...rest } = child as Json;
      out.meta = rest;
    } else {
      out[key] = child;
    }
  }
  return out;
}

const stable = (value: unknown): string => JSON.stringify(canonicalizeProfileDocument(value));

export function buildImportPreview(
  incoming: ProfileDocument,
  report: ImportReport,
  existing?: ProfileDocument | null,
): ImportPreview {
  const existingById = new Map<string, Json>();
  for (const entry of existing ? listRecords(existing) : []) {
    if (entry.id !== null) existingById.set(entry.id, entry.value);
  }

  const records: PreviewRecord[] = [];
  const collections: Record<string, CollectionPreview> = {};
  const seenIds = new Set<string>();
  let needsReview = 0;

  for (const entry of listRecords(incoming)) {
    const id = entry.id ?? '';
    seenIds.add(id);
    const prior = existingById.get(id);
    let action: PreviewAction = 'create';
    let changed: string[] = [];
    if (prior) {
      const a = comparable(entry.value);
      const b = comparable(prior);
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      changed = [...keys].filter((key) => stable(a[key] ?? null) !== stable(b[key] ?? null)).sort();
      action = changed.length === 0 ? 'unchanged' : 'update';
    }
    const meta = entry.value.meta as Json | undefined;
    if (meta?.status === 'needs_review') needsReview += 1;
    records.push({
      kind: entry.kind,
      id,
      path: formatPath(entry.path),
      label: safeLabel(entry.kind, entry.path),
      action,
      changed_fields: changed,
      declared_status: typeof meta?.declared_status === 'string' ? meta.declared_status : null,
    });
    const key = genericPath(entry.path.slice(0, -1));
    const bucket = (collections[key] ??= { incoming: 0, create: 0, update: 0, unchanged: 0 });
    bucket.incoming += 1;
    bucket[action] += 1;
  }

  const singletons: Record<string, { fields_set: number }> = {};
  const profile = incoming.profile as Json;
  for (const name of SINGLETONS) {
    const block = profile[name];
    if (block && typeof block === 'object') {
      const set = Object.entries(block as Json).filter(
        ([key, value]) => key !== 'field_states' && !isBlankValue(value),
      ).length;
      if (set > 0) singletons[name] = { fields_set: set };
    }
  }

  const discardCodes = new Set(['EMPTY_RECORD_DROPPED']);
  const discarded = report.warnings
    .filter((warning) => discardCodes.has(warning.code))
    .map((warning) => ({ path: warning.path ?? '', reason: warning.message }));

  const warningsByCode: Record<string, number> = {};
  for (const warning of report.warnings) {
    warningsByCode[warning.code] = (warningsByCode[warning.code] ?? 0) + 1;
  }

  const create = records.filter((r) => r.action === 'create').length;
  const update = records.filter((r) => r.action === 'update').length;
  const unchanged = records.filter((r) => r.action === 'unchanged').length;

  return {
    source_schema_version: report.source_schema_version,
    target_schema_version: report.target_schema_version,
    totals: {
      records: records.length,
      create,
      update,
      unchanged,
      discarded: discarded.length,
      needs_review: needsReview,
    },
    collections,
    singletons,
    records,
    discarded,
    warnings_by_code: warningsByCode,
    unmapped_count: report.unmapped.length,
    untouched_existing: [...existingById.keys()].filter((id) => !seenIds.has(id)).length,
  };
}
