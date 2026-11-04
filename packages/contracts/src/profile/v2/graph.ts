import { FACT_KINDS, type RecordKind } from '../../common/enums';

/**
 * Grafo de registros e referencias do documento v2. Funcoes puras e DEFENSIVAS (aceitam
 * dados ainda nao validados): sao usadas pelo `superRefine` de integridade, pelo importador
 * (reescrita de ids) e pelos testes.
 */

export type Path = (string | number)[];
type Json = Record<string, unknown>;

export interface RecordEntry {
  kind: RecordKind;
  id: string | null;
  /** Caminho a partir da raiz do documento (ex.: ['profile','experiences',0,'items',1]). */
  path: Path;
  value: Json;
}

export interface ReferenceEntry {
  /** Caminho do valor (string) que contem o id referenciado. */
  path: Path;
  id: string;
  /** Tipos de registro que podem ser alvo desta referencia. */
  targets: readonly RecordKind[];
  /** Registro (ou bloco) que contem a referencia. */
  owner: { kind: RecordKind | 'resume_preferences'; path: Path };
}

/** Colecoes de nivel superior de `profile` e o tipo de registro de cada uma. */
export const TOP_LEVEL_COLLECTIONS = [
  { key: 'contact_points', kind: 'contact_point' },
  { key: 'statements', kind: 'statement' },
  { key: 'competency_examples', kind: 'competency_example' },
  { key: 'experiences', kind: 'experience' },
  { key: 'projects', kind: 'project' },
  { key: 'education', kind: 'education' },
  { key: 'courses', kind: 'course' },
  { key: 'skills', kind: 'skill' },
  { key: 'skill_usages', kind: 'skill_usage' },
  { key: 'languages', kind: 'language' },
  { key: 'certifications', kind: 'certification' },
  { key: 'awards', kind: 'award' },
  { key: 'publications', kind: 'publication' },
  { key: 'volunteering', kind: 'volunteering' },
  { key: 'evidence', kind: 'evidence' },
  { key: 'pending_items', kind: 'pending_item' },
] as const satisfies readonly { key: string; kind: RecordKind }[];

const NESTED_COLLECTIONS: Partial<
  Record<RecordKind, readonly { key: string; kind: RecordKind }[]>
> = {
  experience: [{ key: 'items', kind: 'experience_item' }],
  project: [
    { key: 'items', kind: 'project_item' },
    { key: 'collaborators', kind: 'collaborator' },
  ],
};

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const FACT_KIND_SET: ReadonlySet<RecordKind> = new Set<RecordKind>(FACT_KINDS);
export const isFactKind = (kind: RecordKind): boolean => FACT_KIND_SET.has(kind);

/** Alvos validos de pendencias e restricoes: fatos, contatos e evidencias. */
export const TARGETABLE_KINDS: readonly RecordKind[] = [...FACT_KINDS, 'contact_point', 'evidence'];

function collect(items: unknown, kind: RecordKind, basePath: Path, out: RecordEntry[]): void {
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    if (!isObject(item)) return;
    const path = [...basePath, index];
    out.push({ kind, id: typeof item.id === 'string' ? item.id : null, path, value: item });
    for (const child of NESTED_COLLECTIONS[kind] ?? []) {
      collect(item[child.key], child.kind, [...path, child.key], out);
    }
  });
}

/** Lista todos os registros com `id` do documento, em ordem de documento. */
export function listRecords(document: unknown): RecordEntry[] {
  const out: RecordEntry[] = [];
  if (!isObject(document) || !isObject(document.profile)) return out;
  const profile = document.profile;
  for (const collection of TOP_LEVEL_COLLECTIONS) {
    collect(profile[collection.key], collection.kind, ['profile', collection.key], out);
  }
  const usageRules = profile.usage_rules;
  if (isObject(usageRules)) {
    collect(
      usageRules.restrictions,
      'restriction',
      ['profile', 'usage_rules', 'restrictions'],
      out,
    );
  }
  return out;
}

const SKILL_USAGE_REFERENCES: readonly [string, RecordKind][] = [
  ['skill_id', 'skill'],
  ['experience_id', 'experience'],
  ['project_id', 'project'],
  ['education_id', 'education'],
  ['course_id', 'course'],
  ['certification_id', 'certification'],
  ['volunteering_id', 'volunteering'],
];

/** Lista toda referencia por id existente no documento. */
export function listReferences(document: unknown): ReferenceEntry[] {
  const out: ReferenceEntry[] = [];

  const pushOne = (
    owner: ReferenceEntry['owner'],
    container: Json,
    field: string,
    targets: readonly RecordKind[],
  ): void => {
    const value = container[field];
    if (typeof value === 'string') {
      out.push({ path: [...owner.path, field], id: value, targets, owner });
    }
  };
  const pushMany = (
    owner: ReferenceEntry['owner'],
    container: Json,
    field: string,
    targets: readonly RecordKind[],
    basePath: Path = owner.path,
  ): void => {
    const value = container[field];
    if (!Array.isArray(value)) return;
    value.forEach((id, index) => {
      if (typeof id === 'string')
        out.push({ path: [...basePath, field, index], id, targets, owner });
    });
  };

  for (const record of listRecords(document)) {
    const owner = { kind: record.kind, path: record.path };
    const value = record.value;

    if (isFactKind(record.kind) && isObject(value.meta)) {
      pushMany(owner, value.meta, 'evidence_ids', ['evidence'], [...record.path, 'meta']);
    }
    switch (record.kind) {
      case 'evidence':
        pushMany(owner, value, 'supports', FACT_KINDS);
        break;
      case 'competency_example':
        pushMany(owner, value, 'related_skill_ids', ['skill']);
        break;
      case 'project':
        pushOne(owner, value, 'related_experience_id', ['experience']);
        pushOne(owner, value, 'related_education_id', ['education']);
        break;
      case 'skill_usage':
        for (const [field, target] of SKILL_USAGE_REFERENCES)
          pushOne(owner, value, field, [target]);
        break;
      case 'language':
        pushOne(owner, value, 'certification_id', ['certification']);
        break;
      case 'pending_item':
      case 'restriction':
        if (isObject(value.target)) {
          pushOne(
            { kind: record.kind, path: [...record.path, 'target'] },
            value.target,
            'record_id',
            TARGETABLE_KINDS,
          );
        }
        break;
      default:
        break;
    }
  }

  if (isObject(document) && isObject(document.profile)) {
    const prefs = document.profile.resume_preferences;
    if (isObject(prefs)) {
      const owner = {
        kind: 'resume_preferences' as const,
        path: ['profile', 'resume_preferences'],
      };
      pushMany(owner, prefs, 'older_experience_ids', ['experience']);
      pushMany(owner, prefs, 'highlight_record_ids', ['experience', 'project']);
    }
  }
  return out;
}

/** Clone profundo de dados JSON-compativeis (sem depender de `structuredClone`). */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item as unknown)) as T;
  if (isObject(value)) {
    const copy: Json = {};
    for (const [key, child] of Object.entries(value)) {
      // defineProperty: uma chave "__proto__" vinda de JSON vira propriedade propria, nunca muda o prototipo
      Object.defineProperty(copy, key, {
        value: cloneJson(child),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy as T;
  }
  return value;
}

function setAt(root: unknown, path: Path, value: unknown): void {
  let cursor: unknown = root;
  for (const segment of path.slice(0, -1)) {
    cursor = (cursor as Record<string | number, unknown>)[segment];
  }
  const last = path[path.length - 1];
  if (last !== undefined && cursor && typeof cursor === 'object') {
    (cursor as Record<string | number, unknown>)[last] = value;
  }
}

/**
 * Devolve uma COPIA do documento com todo id de registro (e toda referencia a ele) reescrito
 * por `mapper`. Ids ausentes nao sao criados aqui (ver `assignIds` em profile-io).
 * Referencias para ids inexistentes sao mantidas como estao (a validacao as reporta).
 */
export function remapIds<T>(document: T, mapper: (id: string, kind: RecordKind) => string): T {
  const copy = cloneJson(document);
  const kindById = new Map<string, RecordKind>();
  for (const record of listRecords(copy)) {
    if (record.id !== null && !kindById.has(record.id)) kindById.set(record.id, record.kind);
  }
  const mapped = new Map<string, string>();
  const mapOnce = (id: string, kind: RecordKind): string => {
    const known = mapped.get(id);
    if (known !== undefined) return known;
    const next = mapper(id, kind);
    mapped.set(id, next);
    return next;
  };
  for (const record of listRecords(copy)) {
    if (record.id !== null) setAt(copy, [...record.path, 'id'], mapOnce(record.id, record.kind));
  }
  for (const reference of listReferences(copy)) {
    const kind = kindById.get(reference.id);
    if (kind !== undefined) setAt(copy, reference.path, mapOnce(reference.id, kind));
  }
  return copy;
}
