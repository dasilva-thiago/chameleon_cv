import {
  isFactKind,
  listRecords,
  type FactStatus,
  type ProfileDocument,
  type RecordKind,
  type ResumeUse,
  type Visibility,
} from '@chameleon/contracts';
import {
  EXPERIENCE_ITEM_KIND_LABELS,
  PROJECT_ITEM_KIND_LABELS,
  RECORD_KIND_LABELS,
} from './labels';

export type Json = Record<string, unknown>;

export const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface IndexedRecord {
  kind: RecordKind;
  id: string;
  value: Json;
  /** Id do registro pai (itens de experiencia/projeto, colaboradores). */
  parentId: string | null;
}

/** Indice somente leitura dos registros com id do documento (ids em minusculas). */
export interface ProfileIndex {
  byId: ReadonlyMap<string, IndexedRecord>;
  all: readonly IndexedRecord[];
  ofKind(kind: RecordKind): IndexedRecord[];
}

export const EMPTY_INDEX: ProfileIndex = {
  byId: new Map(),
  all: [],
  ofKind: () => [],
};

export function buildIndex(document: ProfileDocument | null): ProfileIndex {
  if (document === null) return EMPTY_INDEX;
  const parents = new Map<string, string>();
  const entries = listRecords(document).filter((entry) => entry.id !== null);
  for (const entry of entries) {
    const parentId = entry.id?.toLowerCase();
    for (const key of ['items', 'collaborators'] as const) {
      const children = entry.value[key];
      if (parentId === undefined || !Array.isArray(children)) continue;
      for (const child of children) {
        if (isJson(child) && typeof child.id === 'string') {
          parents.set(child.id.toLowerCase(), parentId);
        }
      }
    }
  }
  const all: IndexedRecord[] = entries.map((entry) => {
    const id = (entry.id ?? '').toLowerCase();
    return { kind: entry.kind, id, value: entry.value, parentId: parents.get(id) ?? null };
  });
  const byId = new Map(all.map((record) => [record.id, record]));
  return { byId, all, ofKind: (kind) => all.filter((record) => record.kind === kind) };
}

export function metaOf(record: Json): Json {
  return isJson(record.meta) ? record.meta : {};
}

/** Sem `meta` o fato conta como "precisa de revisao" (o mais restritivo, ADR-0005/0006). */
export function statusOf(record: Json): FactStatus {
  const status = metaOf(record).status;
  return status === 'confirmed' ||
    status === 'conflicting' ||
    status === 'archived' ||
    status === 'needs_review'
    ? status
    : 'needs_review';
}

export function visibilityOf(record: Json): Visibility | undefined {
  const value = metaOf(record).visibility;
  return value === 'public' || value === 'private' || value === 'conditional' ? value : undefined;
}

export function resumeUseOf(record: Json): ResumeUse | undefined {
  const value = metaOf(record).resume_use;
  return value === 'allowed' || value === 'requires_approval' || value === 'never'
    ? value
    : undefined;
}

export function isFact(kind: RecordKind): boolean {
  return isFactKind(kind);
}

export function collectionOf(document: ProfileDocument | null, key: string): Json[] {
  const profile = document?.profile as Json | undefined;
  const value = profile?.[key];
  return Array.isArray(value) ? value.filter(isJson) : [];
}

export function blockOf(document: ProfileDocument | null, key: string): Json | null {
  const profile = document?.profile as Json | undefined;
  const value = profile?.[key];
  return isJson(value) ? value : null;
}

export function childrenOf(record: Json, key: 'items' | 'collaborators'): Json[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isJson) : [];
}

export function idOf(record: Json): string | undefined {
  return typeof record.id === 'string' ? record.id : undefined;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const joinParts = (parts: (string | undefined)[], separator = ' · '): string | undefined => {
  const filled = parts.filter((part): part is string => part !== undefined);
  return filled.length > 0 ? filled.join(separator) : undefined;
};

function labelOf(labels: Record<string, string>, value: unknown): string | undefined {
  return typeof value === 'string' ? labels[value] : undefined;
}

function periodOf(record: Json, startKey: string, endKey: string): string | undefined {
  const start = str(record[startKey]);
  const end = str(record[endKey]);
  if (start === undefined && end === undefined) return undefined;
  const endLabel = end === 'present' ? 'atual' : end;
  return `${start ?? '?'} – ${endLabel ?? '?'}`;
}

function truncate(value: string, max = 90): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Titulo e subtitulo de um registro para listas. Usa so campos do proprio registro e cai em um
 * texto neutro ("sem titulo") quando nada foi preenchido.
 */
export function describeRecord(
  kind: RecordKind,
  record: Json,
  index?: ProfileIndex,
): { title: string; subtitle: string | undefined } {
  const fallback = `${RECORD_KIND_LABELS[kind]} sem título`;
  switch (kind) {
    case 'experience':
      return {
        title:
          joinParts(
            [
              str(record.display_title) ?? str(record.official_title),
              str(record.organization_name),
            ],
            ' — ',
          ) ?? fallback,
        subtitle: periodOf(record, 'start_date', 'end_date'),
      };
    case 'experience_item':
      return {
        title: truncate(str(record.text) ?? fallback),
        subtitle: labelOf(EXPERIENCE_ITEM_KIND_LABELS, record.kind),
      };
    case 'project_item':
      return {
        title: truncate(str(record.text) ?? fallback),
        subtitle: labelOf(PROJECT_ITEM_KIND_LABELS, record.kind),
      };
    case 'project':
      return {
        title: str(record.name) ?? str(record.one_line_description) ?? fallback,
        subtitle: periodOf(record, 'start_date', 'end_date'),
      };
    case 'education':
      return {
        title:
          joinParts([str(record.course_name), str(record.institution)], ' — ') ??
          str(record.qualification_awarded) ??
          fallback,
        subtitle: periodOf(record, 'start_date', 'completion_date'),
      };
    case 'course':
      return {
        title: joinParts([str(record.name), str(record.provider)], ' — ') ?? fallback,
        subtitle: periodOf(record, 'start_date', 'completion_date'),
      };
    case 'skill':
      return { title: str(record.name) ?? fallback, subtitle: undefined };
    case 'skill_usage': {
      const skill =
        typeof record.skill_id === 'string'
          ? index?.byId.get(record.skill_id.toLowerCase())?.value
          : undefined;
      return {
        title: (skill !== undefined ? str(skill.name) : undefined) ?? 'Competência',
        subtitle: undefined,
      };
    }
    case 'language':
      return { title: str(record.language) ?? fallback, subtitle: undefined };
    case 'certification':
      return {
        title: joinParts([str(record.name), str(record.issuer)], ' — ') ?? fallback,
        subtitle: str(record.issue_date),
      };
    case 'award':
      return {
        title: joinParts([str(record.name), str(record.organization)], ' — ') ?? fallback,
        subtitle: str(record.date),
      };
    case 'publication':
      return { title: str(record.title) ?? fallback, subtitle: str(record.date) };
    case 'volunteering':
      return {
        title: joinParts([str(record.role), str(record.organization)], ' — ') ?? fallback,
        subtitle: periodOf(record, 'start_date', 'end_date'),
      };
    case 'contact_point':
      return {
        title: str(record.value) ?? fallback,
        subtitle: joinParts([str(record.label)]),
      };
    case 'statement':
      return { title: truncate(str(record.text) ?? fallback), subtitle: undefined };
    case 'competency_example':
      return {
        title: str(record.competency) ?? truncate(str(record.situation) ?? fallback),
        subtitle: undefined,
      };
    case 'evidence':
      return {
        title: str(record.title) ?? str(record.url_or_location) ?? fallback,
        subtitle: undefined,
      };
    case 'pending_item':
      return { title: str(record.subject) ?? fallback, subtitle: undefined };
    case 'restriction': {
      const target = isJson(record.target) ? record.target : {};
      return { title: str(target.term) ?? fallback, subtitle: undefined };
    }
    case 'collaborator':
      return { title: str(record.name_or_role) ?? fallback, subtitle: undefined };
  }
}

/** Quantos campos de topo de um bloco estao preenchidos (ignora o estado de campo e listas vazias). */
export function filledFieldCount(block: Json | null): number {
  if (block === null) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(block)) {
    if (key === 'field_states') continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (isJson(value) && Object.keys(value).length === 0) continue;
    count += 1;
  }
  return count;
}
